/**
 * 2단계: 카테고리별 요약 다이제스트 생성
 * 각 카테고리에서 대표 Q&A를 추출하여 요약본 생성
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DIGEST_DIR = path.join(DATA_DIR, 'digest');
const CLASSIFIED_PATH = path.join(DATA_DIR, 'classified_data.json');

// === 전체 데이터 로드 (소스별 인덱싱) ===
function loadSourceData() {
  const index = {};

  // W-Tech QNA
  const qna = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtech', 'qna_data.json'), 'utf-8'));
  for (const item of qna) {
    const answers = (item.comments || []).map(c => c.content || '').filter(c => c.length > 10);
    index[`wtech_qna|${item.num}`] = {
      title: item.title || '',
      question: item.question || '',
      answer: answers.join('\n---\n'),
      date: item.date || '',
      status: item.status || '',
      views: parseInt(item.views) || 0,
    };
  }

  // Gmail
  const email = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'email', 'email_technical_qna.json'), 'utf-8'));
  for (const item of email) {
    const parts = (item.content || '').split(/\n\s*A:\s*/);
    index[`gmail|${item.threadId}`] = {
      title: item.subject || '',
      question: parts[0]?.replace(/^Q:\s*/, '') || '',
      answer: parts.slice(1).join('\n') || '',
      date: item.date || '',
      status: '',
      views: 0,
    };
  }

  // Confluence
  const confFiles = [
    ['confluence_inside_data.json', 'confluence_inside'],
    ['confluence_db_data.json', 'confluence_db'],
    ['confluence_uxdb_data.json', 'confluence_uxdb'],
    ['confluence_pa_data.json', 'confluence_pa'],
    ['confluence_w5c_data.json', 'confluence_w5c'],
  ];
  for (const [file, source] of confFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'confluence', file), 'utf-8'));
    for (const item of data) {
      index[`${source}|${item.pageId}`] = {
        title: item.title || '',
        question: '',
        answer: (item.content || '').substring(0, 2000),
        date: item.lastModified || '',
        status: '',
        views: 0,
        url: item.url || '',
      };
    }
  }

  // FAQ
  const faq = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtech', 'faq_data.json'), 'utf-8'));
  for (const item of faq) {
    index[`wtech_faq|${item.num}`] = {
      title: item.title || '',
      question: item.title || '',
      answer: item.answer || '',
      date: '',
      status: '',
      views: 0,
    };
  }

  return index;
}

// === 대표 Q&A 선별 (카테고리별) ===
function selectRepresentatives(items, sourceData, maxItems = 30) {
  // 스코어링: 답변 길이 + 해결 상태 + 조회수 + 중복 제거
  const scored = [];
  const seenTitles = new Set();

  for (const item of items) {
    const key = `${item.source}|${item.id}`;
    const data = sourceData[key];
    if (!data) continue;
    if (!data.answer || data.answer.length < 30) continue;

    // 유사 제목 중복 제거
    const cleanTitle = data.title.replace(/^(re:|fwd?:|fw:|\[.*?\])\s*/gi, '').trim().toLowerCase();
    if (seenTitles.has(cleanTitle)) continue;
    seenTitles.add(cleanTitle);

    let s = 0;
    s += Math.min(data.answer.length / 100, 10);  // 답변 길이 (최대 10점)
    if (data.status === '해결') s += 5;
    s += Math.min(data.views / 50, 5);  // 조회수 (최대 5점)
    if (item.source === 'wtech_faq') s += 10;  // FAQ 우선
    if (item.source.startsWith('confluence')) s += 3;  // Confluence 우선

    scored.push({ ...item, data, score: s });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems);
}

// === 마크다운 다이제스트 생성 ===
function buildDigest(mainCat, subCat, representatives) {
  let md = `# ${mainCat} > ${subCat}\n\n`;
  md += `> 총 ${representatives.length}건의 대표 Q&A\n\n`;

  for (let i = 0; i < representatives.length; i++) {
    const r = representatives[i];
    const d = r.data;

    md += `## ${i + 1}. ${d.title}\n`;
    md += `- 소스: ${r.source} | 날짜: ${d.date}`;
    if (d.url) md += ` | [원본](${d.url})`;
    md += '\n\n';

    if (d.question) {
      const q = d.question.substring(0, 500).trim();
      md += `**질문:**\n${q}\n\n`;
    }

    if (d.answer) {
      const a = d.answer.substring(0, 1500).trim();
      md += `**답변:**\n${a}\n\n`;
    }

    md += '---\n\n';
  }

  return md;
}

// === 메인 ===
function main() {
  console.log('=== 카테고리별 요약 다이제스트 생성 ===\n');

  // 분류 데이터 로드
  const classified = JSON.parse(fs.readFileSync(CLASSIFIED_PATH, 'utf-8'));
  console.log(`분류 데이터: ${classified.length.toLocaleString()}건`);

  // 소스 데이터 로드
  console.log('소스 데이터 로딩...');
  const sourceData = loadSourceData();
  console.log(`소스 인덱스: ${Object.keys(sourceData).length.toLocaleString()}건\n`);

  // digest 폴더 생성
  if (!fs.existsSync(DIGEST_DIR)) fs.mkdirSync(DIGEST_DIR, { recursive: true });

  // 카테고리별 그룹핑
  const groups = {};
  for (const item of classified) {
    const key = `${item.main}|${item.sub}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  // 대분류별 통합 다이제스트도 생성
  const mainGroups = {};
  for (const item of classified) {
    if (!mainGroups[item.main]) mainGroups[item.main] = [];
    mainGroups[item.main].push(item);
  }

  let totalFiles = 0;

  // 소분류별 다이제스트
  console.log('소분류별 다이제스트 생성...\n');
  for (const [key, items] of Object.entries(groups)) {
    const [mainCat, subCat] = key.split('|');
    if (subCat === '분류불가' && items.length < 50) continue;
    if (items.length < 5) continue;

    const reps = selectRepresentatives(items, sourceData, 25);
    if (reps.length === 0) continue;

    const md = buildDigest(mainCat, subCat, reps);
    const fileName = `${mainCat}_${subCat}`.replace(/[\/\\:*?"<>|]/g, '_') + '.md';
    fs.writeFileSync(path.join(DIGEST_DIR, fileName), md, 'utf-8');
    console.log(`  ${fileName} (${reps.length}건/${items.length}건)`);
    totalFiles++;
  }

  // 대분류별 통합 다이제스트
  console.log('\n대분류별 통합 다이제스트 생성...\n');
  for (const [mainCat, items] of Object.entries(mainGroups)) {
    const reps = selectRepresentatives(items, sourceData, 40);
    if (reps.length === 0) continue;

    const md = buildDigest(mainCat, '전체', reps);
    const fileName = `_${mainCat}_전체`.replace(/[\/\\:*?"<>|]/g, '_') + '.md';
    fs.writeFileSync(path.join(DIGEST_DIR, fileName), md, 'utf-8');
    console.log(`  ${fileName} (${reps.length}건/${items.length}건)`);
    totalFiles++;
  }

  // 인덱스 파일 생성
  const indexMd = generateIndex(groups, sourceData);
  fs.writeFileSync(path.join(DIGEST_DIR, '_INDEX.md'), indexMd, 'utf-8');
  console.log(`\n  _INDEX.md (카테고리 인덱스)`);
  totalFiles++;

  console.log(`\n=== 완료: ${totalFiles}개 파일 생성 → ${DIGEST_DIR} ===`);
}

function generateIndex(groups, sourceData) {
  let md = `# 기술문의 카테고리 인덱스\n\n`;
  md += `> 이 파일을 먼저 읽고, 질문에 맞는 카테고리 파일을 열어서 답변하세요.\n\n`;

  let currentMain = '';
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  // 대분류별 정리
  const byMain = {};
  for (const [key, items] of sorted) {
    const [mainCat, subCat] = key.split('|');
    if (!byMain[mainCat]) byMain[mainCat] = [];
    byMain[mainCat].push({ subCat, count: items.length });
  }

  const mainSorted = Object.entries(byMain).sort((a, b) => {
    const totalA = a[1].reduce((s, x) => s + x.count, 0);
    const totalB = b[1].reduce((s, x) => s + x.count, 0);
    return totalB - totalA;
  });

  for (const [mainCat, subs] of mainSorted) {
    const total = subs.reduce((s, x) => s + x.count, 0);
    md += `## ${mainCat} (${total.toLocaleString()}건)\n`;
    md += `- 통합: [_${mainCat}_전체.md](_${mainCat}_전체.md)\n`;
    for (const { subCat, count } of subs.sort((a, b) => b.count - a.count)) {
      const fileName = `${mainCat}_${subCat}`.replace(/[\/\\:*?"<>|]/g, '_') + '.md';
      md += `- ${subCat}: [${fileName}](${fileName}) (${count}건)\n`;
    }
    md += '\n';
  }

  return md;
}

main();
