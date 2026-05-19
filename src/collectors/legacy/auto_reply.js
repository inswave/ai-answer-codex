/**
 * 3단계: 기술문의 자동 답변 초안 생성기
 * 사용법: node scripts/auto_reply.js "고객사: OO, 문의: 내용"
 * 예시: node scripts/auto_reply.js "신한은행에서 gridView 엑셀 다운로드 시 느낌표 발생"
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// === 분류 카테고리 패턴 (classify_data.js와 동일) ===
const CATEGORY_PATTERNS = [
  { name: 'GridView', pattern: /gridview|gridView|그리드뷰|그리드|grid\b/i },
  { name: '엑셀', pattern: /엑셀|excel|xlsx|xls/i },
  { name: '입력 컴포넌트', pattern: /\binput\b|inputbox|selectbox|autocomplete|calendar|textarea|checkbox|radio|trigger|combobox/i },
  { name: '데이터', pattern: /datalist|dataList|datamap|dataMap|submission|서브미션|datacollection/i },
  { name: '레이아웃/화면', pattern: /popup|팝업|tab\b|tabcontrol|generator|tree\b|트리|다국어|layout/i },
  { name: '엔진/설정', pattern: /config\.xml|websquare\.xml|엔진|engine|버전|version|studio|설치|install|sp[345]\b|업그레이드/i },
  { name: '하이브리드/모바일', pattern: /w-?gear|wgear|hybrid|하이브리드|mobile|모바일|cordova/i },
  { name: '보안', pattern: /취약점|보안|security|xss|인증|sso|세션|session/i },
  { name: '외부연계', pattern: /chart|차트|editor|에디터|activex|플러그인|plugin|지도|map\b/i },
  { name: '라이선스', pattern: /라이[선센]스|license/i },
  { name: 'W-Pack/빌드', pattern: /w-?pack|wpack|gcc|난독화|빌드|build/i },
  { name: 'W-Browser', pattern: /w-?browser|wbrowser/i },
];

// === 카테고리 자동 감지 ===
function detectCategory(query) {
  for (const { name, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(query)) return name;
  }
  return '기타';
}

// === 데이터 로드 ===
function loadAllData() {
  const all = [];

  const qna = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtech', 'qna_data.json'), 'utf-8'));
  for (const item of qna) {
    const answers = (item.comments || []).map(c => c.content || '').filter(c => c.length > 10);
    if (answers.length === 0) continue;
    all.push({
      source: 'W-Tech QNA',
      title: item.title || '',
      question: item.question || '',
      answer: answers.join('\n'),
      date: item.date || '',
      status: item.status || '',
      views: parseInt(item.views) || 0,
    });
  }

  const email = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'email', 'email_technical_qna.json'), 'utf-8'));
  for (const item of email) {
    const parts = (item.content || '').split(/\n\s*A:\s*/);
    const a = parts.slice(1).join('\n');
    if (!a || a.length < 30) continue;
    all.push({
      source: 'Gmail',
      title: item.subject || '',
      question: parts[0]?.replace(/^Q:\s*/, '') || '',
      answer: a,
      date: item.date || '',
      status: '',
      views: 0,
    });
  }

  const faq = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtech', 'faq_data.json'), 'utf-8'));
  for (const item of faq) {
    all.push({
      source: 'FAQ',
      title: item.title || '',
      question: item.title || '',
      answer: item.answer || '',
      date: '',
      status: '',
      views: 0,
    });
  }

  const confFiles = [
    ['confluence_inside_data.json'], ['confluence_db_data.json'],
    ['confluence_uxdb_data.json'],
  ];
  for (const [file] of confFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'confluence', file), 'utf-8'));
    for (const item of data) {
      if (!item.content || item.content.length < 50) continue;
      all.push({
        source: 'Confluence',
        title: item.title || '',
        question: '',
        answer: item.content.substring(0, 2000),
        date: item.lastModified || '',
        status: '',
        views: 0,
      });
    }
  }

  return all;
}

// === 유사도 스코어링 ===
function score(item, keywords) {
  let s = 0;
  const titleLower = item.title.toLowerCase();
  const questionLower = item.question.toLowerCase();
  const answerLower = item.answer.toLowerCase();

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (titleLower.includes(kwLower)) s += 10;
    if (questionLower.includes(kwLower)) s += 5;
    if (answerLower.includes(kwLower)) s += 3;
  }

  if (item.answer.length > 100) s += 2;
  if (item.status === '해결') s += 3;
  if (item.source === 'FAQ') s += 8;
  if (item.source === 'Confluence') s += 3;

  return s;
}

// === 답변 초안 생성 ===
function generateDraft(query, topResults, category) {
  let draft = '';

  draft += `${'═'.repeat(70)}\n`;
  draft += `  기술문의 자동 답변 초안\n`;
  draft += `${'═'.repeat(70)}\n\n`;

  draft += `📋 문의 내용: ${query}\n`;
  draft += `📂 감지된 카테고리: ${category}\n`;
  draft += `📊 유사 사례: ${topResults.length}건 발견\n\n`;

  // 답변 초안
  draft += `${'─'.repeat(70)}\n`;
  draft += `  [답변 초안]\n`;
  draft += `${'─'.repeat(70)}\n\n`;

  draft += `안녕하세요. 인스웨이브 기술지원팀입니다.\n`;
  draft += `문의하신 내용에 대해 답변드립니다.\n\n`;

  if (topResults.length > 0) {
    const best = topResults[0];
    // 가장 관련성 높은 답변 핵심 추출
    const answerLines = best.answer.split('\n').filter(l => l.trim().length > 0);
    const keyAnswer = answerLines.slice(0, 20).join('\n');

    draft += `[관련 사례 기반 답변]\n`;
    draft += `${keyAnswer}\n\n`;

    if (topResults.length > 1) {
      draft += `\n추가 참고 사항:\n`;
      for (let i = 1; i < Math.min(topResults.length, 4); i++) {
        const r = topResults[i];
        const summary = r.answer.split('\n').filter(l => l.trim().length > 0).slice(0, 5).join('\n  ');
        draft += `\n${i}. ${r.title}\n  ${summary}\n`;
      }
    }
  }

  draft += `\n감사합니다.\n`;
  draft += `인스웨이브 기술지원팀 드림\n\n`;

  // 참고 사례 상세
  draft += `${'─'.repeat(70)}\n`;
  draft += `  [참고 사례 상세]\n`;
  draft += `${'─'.repeat(70)}\n`;

  for (let i = 0; i < topResults.length; i++) {
    const r = topResults[i];
    draft += `\n[사례 ${i + 1}] ${r.title}\n`;
    draft += `  소스: ${r.source} | 날짜: ${r.date} | 점수: ${r.matchScore}\n`;
    if (r.question) {
      draft += `  질문: ${r.question.substring(0, 300)}\n`;
    }
    draft += `  답변: ${r.answer.substring(0, 800)}\n`;
    draft += `  ${'·'.repeat(50)}\n`;
  }

  return draft;
}

// === 메인 ===
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node scripts/auto_reply.js "문의 내용"');
    console.log('');
    console.log('예시:');
    console.log('  node scripts/auto_reply.js "gridView 엑셀 다운로드 시 느낌표 발생"');
    console.log('  node scripts/auto_reply.js "config.xml advancedExcelUploadPopupURL 설정 안됨"');
    console.log('  node scripts/auto_reply.js "웹스퀘어 SP4에서 SP5 마이그레이션 가이드"');
    console.log('  node scripts/auto_reply.js "하이브리드앱에서 카메라 연동 방법"');
    process.exit(0);
  }

  const query = args[0];
  const maxResults = parseInt(args[1]) || 5;

  console.log('데이터 로딩 중...\n');
  const allData = loadAllData();

  // 카테고리 감지
  const category = detectCategory(query);

  // 키워드 추출
  const keywords = query.split(/\s+/).filter(k => k.length > 1);

  // 검색 & 스코어링
  const results = allData
    .map(item => ({ ...item, matchScore: score(item, keywords) }))
    .filter(item => item.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, maxResults);

  // 초안 생성
  const draft = generateDraft(query, results, category);
  console.log(draft);
}

main();
