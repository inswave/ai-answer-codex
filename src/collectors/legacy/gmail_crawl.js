const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  gmail: '',
  gmail_app_pw: '',
  dataPath: path.join(__dirname, '..', 'data', 'email', 'email_technical_qna.json'),
  tempPath: path.join(__dirname, '..', 'data', 'email', 'crawl_progress.json'),
  excludeKeywords: ['라이선스 발급', '라이선스키 전달', '데모라이선스 전달'],
};

const imapConfig = {
  imap: {
    user: CONFIG.gmail,
    password: CONFIG.gmail_app_pw,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 30000,
    connTimeout: 30000,
  },
};

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removePersonalInfo(text) {
  text = text.replace(/(\d{2,3}[-.)]\s*\d{3,4}[-.)]\s*)\d{4}/g, '$1****');
  text = text.replace(/\d{6}[-]\d{7}/g, '******-*******');
  return text;
}

function isTechnicalEmail(subject, body) {
  const text = `${subject} ${body}`.toLowerCase();
  for (const kw of CONFIG.excludeKeywords) {
    if (text.includes(kw.toLowerCase())) return false;
  }
  const p = [
    /기술\s*문의/, /기술\s*지원/, /핫픽스/, /hotfix/i, /웹스퀘어/, /websquare/i,
    /gridview/i, /w-?pack/i, /w-?browser/i, /w-?gear/i, /config\.xml/,
    /websquare\.xml/, /엔진/, /패치/, /오류/, /에러/, /버그/, /취약점/, /보안/,
    /수정/, /개선/, /컴포넌트/, /엑셀/, /excel/i, /그리드/, /grid/i,
    /jsp/, /jar/, /servlet/, /upload/i, /download/i,
    /답변\s*드/, /문의/, /확인.*부탁/, /전달.*드/,
  ];
  return p.some(r => r.test(text));
}

function formatAsQnA(messages) {
  if (!messages.length) return null;
  messages.sort((a, b) => new Date(a.date) - new Date(b.date));
  const first = messages[0];
  const subject = (first.subject || '').replace(/^(re:|fwd?:|fw:)\s*/gi, '').trim() || '(제목 없음)';
  const allText = messages.map(m => `${m.subject || ''} ${m.body || ''}`).join(' ');
  if (!isTechnicalEmail(subject, allText)) return null;

  let content;
  if (messages.length === 1) {
    content = removePersonalInfo(messages[0].body || '');
  } else {
    const q = removePersonalInfo(messages[0].body || '');
    const answers = messages.slice(1).map(m => removePersonalInfo(m.body || '')).filter(b => b.length > 10);
    content = answers.length ? `Q: ${q}\n\nA: ${answers.join('\n\n---\n\n')}` : q;
  }
  if (content.length < 20) return null;

  return {
    subject,
    date: first.date ? new Date(first.date).toISOString().split('T')[0] : '',
    threadId: first.gmThreadId || first.messageId || '',
    messageCount: messages.length,
    content,
  };
}

// === Phase 1: UID만 검색 (빠름) ===
async function searchUIDs(connection) {
  const searches = [
    'to:g_ts@inswave.com after:2024/01/01',
    'subject:기술문의 after:2024/01/01',
    'subject:(핫픽스 OR hotfix) after:2024/01/01',
    'subject:(웹스퀘어 OR WebSquare) after:2024/01/01',
    'subject:(취약점 OR 보안) after:2024/01/01',
    'subject:(gridView OR config.xml) after:2024/01/01',
    'subject:(W-Pack OR WBrowser OR W-Gear) after:2024/01/01',
  ];

  const allUIDs = new Set();

  for (const q of searches) {
    console.log(`검색: ${q}`);
    try {
      // UID만 검색 (본문 다운로드 안 함)
      const results = await new Promise((resolve, reject) => {
        connection.imap.search([['X-GM-RAW', q]], (err, uids) => {
          if (err) reject(err);
          else resolve(uids || []);
        });
      });
      console.log(`  → ${results.length}건`);
      results.forEach(uid => allUIDs.add(uid));
      console.log(`  누적: ${allUIDs.size}건`);
    } catch (err) {
      console.error(`  → 실패: ${err.message}`);
    }
  }

  return Array.from(allUIDs).sort((a, b) => a - b);
}

// === Phase 2: 배치로 본문 다운로드 ===
async function fetchBatch(connection, uids) {
  const BATCH = 30;
  const allParsed = [];

  for (let i = 0; i < uids.length; i += BATCH) {
    const batch = uids.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const totalBatches = Math.ceil(uids.length / BATCH);
    process.stdout.write(`\r  배치 ${batchNum}/${totalBatches} (${Math.min(i + BATCH, uids.length)}/${uids.length}건) 파싱: ${allParsed.length}건`);

    try {
      // imap 직접 fetch 사용 (UID 배열 그대로 전달)
      const fetched = await new Promise((resolve, reject) => {
        const messages = [];
        const f = connection.imap.fetch(batch, {
          bodies: [''],
          struct: true,
          extensions: ['X-GM-THRID'],
        });
        f.on('message', (msg, seqno) => {
          const msgData = { parts: [], attributes: null };
          msg.on('body', (stream, info) => {
            let buffer = '';
            stream.on('data', chunk => buffer += chunk.toString('utf8'));
            stream.on('end', () => {
              msgData.parts.push({ which: info.which, body: buffer });
            });
          });
          msg.on('attributes', attrs => { msgData.attributes = attrs; });
          msg.on('end', () => messages.push(msgData));
        });
        f.on('error', reject);
        f.on('end', () => resolve(messages));
      });

      for (const msg of fetched) {
        try {
          const rawBody = msg.parts?.find(p => p.which === '')?.body;
          if (!rawBody) continue;

          const mail = await simpleParser(rawBody);
          const gmThreadId = msg.attributes?.['x-gm-thrid']?.toString() || '';

          allParsed.push({
            messageId: mail.messageId?.replace(/[<>]/g, '') || '',
            gmThreadId,
            subject: mail.subject || '',
            from: mail.from?.text || '',
            to: mail.to?.text || '',
            date: mail.date,
            body: mail.text || htmlToText(mail.html || '') || '',
          });
        } catch {}
      }
    } catch (err) {
      console.error(`\n  배치 ${batchNum} 실패: ${err.message}`);
    }

    // 중간 저장
    if (batchNum % 20 === 0) {
      fs.writeFileSync(CONFIG.tempPath, JSON.stringify(allParsed, null, 2), 'utf-8');
      console.log(`\n  중간 저장: ${allParsed.length}건`);
    }
  }

  console.log(`\n\n파싱 완료: ${allParsed.length}건`);
  return allParsed;
}

async function main() {
  console.log('=== Gmail 기술문의 크롤링 시작 ===\n');

  let existingData = [];
  try {
    existingData = JSON.parse(fs.readFileSync(CONFIG.dataPath, 'utf-8'));
    console.log(`기존 데이터: ${existingData.length}건\n`);
  } catch { console.log('기존 데이터 없음\n'); }

  const existingSubjects = new Set(existingData.map(e => `${e.subject}|${e.date}`));

  // 연결
  console.log('Gmail IMAP 연결 중...');
  const connection = await imapSimple.connect(imapConfig);
  console.log('연결 성공!\n');

  // 메일함 열기
  const boxes = await connection.getBoxes();
  let allMailBox = 'INBOX';
  const gmailBoxes = boxes['[Gmail]']?.children || boxes['[Google Mail]']?.children || {};
  for (const [name, box] of Object.entries(gmailBoxes)) {
    if ((box.attribs || []).includes('\\All')) { allMailBox = `[Gmail]/${name}`; break; }
  }
  console.log(`메일함: ${allMailBox}\n`);
  await connection.openBox(allMailBox);

  // Phase 1: UID 검색 (빠름)
  console.log('=== Phase 1: UID 검색 ===\n');
  const uids = await searchUIDs(connection);
  console.log(`\n총 고유 UID: ${uids.length}건\n`);

  if (uids.length === 0) {
    console.log('검색 결과 없음. 종료.');
    connection.end();
    return;
  }

  // Phase 2: 본문 다운로드
  console.log('=== Phase 2: 본문 다운로드 ===\n');
  const allMessages = await fetchBatch(connection, uids);

  // 스레드 그룹핑
  console.log('\n스레드 그룹핑 중...');
  const threadMap = new Map();
  for (const msg of allMessages) {
    const key = msg.gmThreadId || (msg.subject || '').replace(/^(re:|fwd?:|fw:)\s*/gi, '').trim().toLowerCase();
    if (!threadMap.has(key)) threadMap.set(key, []);
    threadMap.get(key).push(msg);
  }
  console.log(`스레드: ${threadMap.size}개\n`);

  // Q&A 변환
  console.log('Q&A 변환 중...');
  const newEntries = [];
  for (const [, messages] of threadMap) {
    const qna = formatAsQnA(messages);
    if (!qna) continue;
    const key = `${qna.subject}|${qna.date}`;
    if (existingSubjects.has(key)) continue;
    existingSubjects.add(key);
    newEntries.push(qna);
  }

  // 병합 & 저장
  const merged = [...existingData, ...newEntries].sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.writeFileSync(CONFIG.dataPath, JSON.stringify(merged, null, 2), 'utf-8');

  // 임시 파일 정리
  try { fs.unlinkSync(CONFIG.tempPath); } catch {}

  console.log(`\n=== 완료 ===`);
  console.log(`기존: ${existingData.length}건`);
  console.log(`추가: ${newEntries.length}건`);
  console.log(`총합: ${merged.length}건`);
  console.log(`저장: ${CONFIG.dataPath}`);

  connection.end();
}

main().catch(err => {
  console.error('크롤링 실패:', err);
  process.exit(1);
});
