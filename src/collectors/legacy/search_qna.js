/**
 * 1단계: 기술문의 통합 검색 스크립트
 * 사용법: node scripts/search_qna.js "검색어" [결과수]
 * 예시: node scripts/search_qna.js "gridView 셀 병합" 10
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// === 데이터 로드 (한 번만) ===
function loadAllData() {
  const all = [];

  // W-Tech QNA
  const qna = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtech', 'qna_data.json'), 'utf-8'));
  for (const item of qna) {
    const answers = (item.comments || []).map(c => c.content || '').join('\n');
    all.push({
      source: 'W-Tech QNA',
      id: item.num,
      title: item.title || '',
      date: item.date || '',
      question: item.question || '',
      answer: answers,
      status: item.status || '',
      views: item.views || '0',
    });
  }

  // Gmail
  const email = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'email', 'email_technical_qna.json'), 'utf-8'));
  for (const item of email) {
    const parts = (item.content || '').split(/\n\s*A:\s*/);
    const q = parts[0]?.replace(/^Q:\s*/, '') || item.content || '';
    const a = parts.slice(1).join('\n') || '';
    all.push({
      source: 'Gmail',
      id: item.threadId || '',
      title: item.subject || '',
      date: item.date || '',
      question: q,
      answer: a,
      status: '',
      views: '',
    });
  }

  // Confluence
  const confFiles = [
    ['confluence_inside_data.json', 'Confluence Inside'],
    ['confluence_db_data.json', 'Confluence 기술DB'],
    ['confluence_uxdb_data.json', 'Confluence UXDB'],
    ['confluence_pa_data.json', 'Confluence PA'],
    ['confluence_w5c_data.json', 'Confluence W5C'],
  ];
  for (const [file, source] of confFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'confluence', file), 'utf-8'));
    for (const item of data) {
      all.push({
        source,
        id: item.pageId || '',
        title: item.title || '',
        date: item.lastModified || '',
        question: '',
        answer: (item.content || '').substring(0, 3000),
        status: '',
        views: '',
        url: item.url || '',
        labels: (item.labels || []).join(', '),
      });
    }
  }

  // FAQ
  const faq = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtech', 'faq_data.json'), 'utf-8'));
  for (const item of faq) {
    all.push({
      source: 'W-Tech FAQ',
      id: item.num || '',
      title: item.title || '',
      date: '',
      question: item.title || '',
      answer: item.answer || '',
      status: '',
      views: '',
    });
  }

  return all;
}

// === 검색 스코어링 ===
function score(item, keywords) {
  let s = 0;
  const titleLower = item.title.toLowerCase();
  const questionLower = item.question.toLowerCase();
  const answerLower = item.answer.toLowerCase();
  const allText = `${titleLower} ${questionLower} ${answerLower}`;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();

    // 제목 매칭 (가중치 높음)
    if (titleLower.includes(kwLower)) s += 10;

    // 질문 매칭
    if (questionLower.includes(kwLower)) s += 5;

    // 답변 매칭
    if (answerLower.includes(kwLower)) s += 3;

    // 정확한 단어 매칭 보너스
    const exactRegex = new RegExp(`\\b${kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (exactRegex.test(allText)) s += 2;
  }

  // 답변이 있는 건에 보너스
  if (item.answer.length > 50) s += 3;

  // 해결 상태 보너스
  if (item.status === '해결') s += 2;

  // FAQ는 보너스 (검증된 답변)
  if (item.source === 'W-Tech FAQ') s += 5;

  // Confluence는 보너스 (정리된 문서)
  if (item.source.startsWith('Confluence')) s += 3;

  return s;
}

// === 결과 포맷팅 ===
function formatResult(item, rank, showFull = false) {
  let result = '';
  result += `\n${'─'.repeat(70)}\n`;
  result += `[${rank}] ${item.title}\n`;
  result += `    소스: ${item.source} | 날짜: ${item.date} | ID: ${item.id}`;
  if (item.status) result += ` | 상태: ${item.status}`;
  if (item.url) result += `\n    URL: ${item.url}`;
  if (item.labels) result += `\n    태그: ${item.labels}`;
  result += '\n';

  if (item.question) {
    const q = showFull ? item.question : item.question.substring(0, 500);
    result += `\n  [질문]\n  ${q.replace(/\n/g, '\n  ')}`;
    if (!showFull && item.question.length > 500) result += '\n  ... (생략)';
    result += '\n';
  }

  if (item.answer) {
    const a = showFull ? item.answer : item.answer.substring(0, 1000);
    result += `\n  [답변]\n  ${a.replace(/\n/g, '\n  ')}`;
    if (!showFull && item.answer.length > 1000) result += '\n  ... (생략)';
    result += '\n';
  }

  return result;
}

// === 메인 ===
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node scripts/search_qna.js "검색어" [결과수] [--full]');
    console.log('예시:');
    console.log('  node scripts/search_qna.js "gridView 셀 병합"');
    console.log('  node scripts/search_qna.js "엑셀 다운로드 느낌표" 5');
    console.log('  node scripts/search_qna.js "config.xml 설정" 3 --full');
    process.exit(0);
  }

  const query = args[0];
  const maxResults = parseInt(args[1]) || 10;
  const showFull = args.includes('--full');

  console.log(`검색어: "${query}" (최대 ${maxResults}건)\n`);
  console.log('데이터 로딩 중...');

  const allData = loadAllData();
  console.log(`총 ${allData.length.toLocaleString()}건 로드 완료\n`);

  // 키워드 분리
  const keywords = query.split(/\s+/).filter(k => k.length > 0);

  // 스코어링 & 정렬
  const scored = allData
    .map(item => ({ ...item, score: score(item, keywords) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  console.log(`매칭: ${scored.length}건 (전체 중 점수 > 0)\n`);

  // 출력
  for (let i = 0; i < scored.length; i++) {
    console.log(formatResult(scored[i], i + 1, showFull));
  }

  console.log(`${'─'.repeat(70)}`);
  console.log(`\n검색 완료: "${query}" → ${scored.length}건`);
}

main();
