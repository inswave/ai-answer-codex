const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const README_PATH = path.join(ROOT, 'README.md');

// 데이터 소스 정의 (표시 순서, 설명)
const SOURCE_INFO = {
  'wtech/faq_data.json': { name: 'W-Tech FAQ', desc: 'W-Tech 자주 찾는 질문' },
  'wtech/qna_data.json': { name: 'W-Tech QNA (기술문의)', desc: 'W-Tech 기술문의 게시판 Q&A' },
  'confluence/confluence_db_data.json': { name: 'Confluence 기술지식DB', desc: '웹스퀘어 기술지식DB' },
  'confluence/confluence_uxdb_data.json': { name: 'Confluence UX지식DB', desc: 'UX지식DB' },
  'api/ws5_api_guide.json': { name: 'WebSquare API 가이드', desc: '컴포넌트별 API 상세 문서 (HTML 변환)' },
  'release_notes/ai_release_note_fulltext.txt': { name: 'AI 릴리즈 노트', desc: 'WebSquare AI 릴리즈 노트 (전문 텍스트)' },
  'release_notes/sp5_release_note_fulltext.txt': { name: 'SP5 릴리즈 노트', desc: 'WebSquare SP5 릴리즈 노트 (전문 텍스트)' },
  'email/email_technical_qna.json': { name: 'Gmail 기술문의/답변', desc: '이메일 기술 Q&A (개인정보 제거)' },
};

function getFileInfo(relPath) {
  const fullPath = path.join(DATA_DIR, relPath);
  if (!fs.existsSync(fullPath)) return null;

  const stat = fs.statSync(fullPath);
  const sizeKB = (stat.size / 1024).toFixed(0);
  let count = '-';

  if (relPath.endsWith('.json')) {
    try {
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      if (Array.isArray(data)) count = data.length.toLocaleString() + '건';
    } catch (e) {}
  } else {
    count = sizeKB + 'KB';
  }

  return { count, sizeKB: sizeKB + 'KB' };
}

// 폴더 트리 생성
function buildFolderTree() {
  const lines = [];
  const dirs = fs.readdirSync(DATA_DIR).filter(d =>
    fs.statSync(path.join(DATA_DIR, d)).isDirectory()
  ).sort();

  dirs.forEach((dir, di) => {
    const isLastDir = di === dirs.length - 1;
    const dirPrefix = isLastDir ? '└── ' : '├── ';
    const files = fs.readdirSync(path.join(DATA_DIR, dir)).sort();

    const fileDescs = files.map(file => {
      const relPath = dir + '/' + file;
      const info = getFileInfo(relPath);
      const meta = SOURCE_INFO[relPath];
      const desc = meta ? meta.name : file;
      const countStr = info ? ` (${info.count})` : '';
      return { file, desc: desc + countStr };
    });

    lines.push(`${dirPrefix}${dir}/`);
    fileDescs.forEach((fd, fi) => {
      const filePrefix = isLastDir ? '    ' : '│   ';
      const connector = fi === fileDescs.length - 1 ? '└── ' : '├── ';
      lines.push(`${filePrefix}${connector}${fd.file}  # ${fd.desc}`);
    });
  });

  return lines.join('\n');
}

// 데이터 소스 테이블 생성
function buildDataTable() {
  const rows = [];
  for (const [relPath, meta] of Object.entries(SOURCE_INFO)) {
    const info = getFileInfo(relPath);
    if (!info) continue;
    rows.push(`| ${meta.name} | ${info.count} | \`data/${relPath}\` | ${meta.desc} |`);
  }
  return rows.join('\n');
}

// 스크립트 목록 생성
function buildScriptList() {
  const scriptsDir = path.join(ROOT, 'scripts');
  const scripts = fs.readdirSync(scriptsDir)
    .filter(f => f.endsWith('.js'))
    .sort();

  return scripts.map(s => `    ├── ${s}`).join('\n');
}

// README 생성
const now = new Date().toISOString().split('T')[0];

const readme = `# WebSquare 기술지원 데이터

WebSquare 기술지원 챗봇을 위한 데이터 수집 및 관리 프로젝트

> 마지막 업데이트: ${now}

## 데이터 소스

| 소스 | 건수 | 파일 | 설명 |
|------|------|------|------|
${buildDataTable()}

## 폴더 구조

\`\`\`
data/
${buildFolderTree()}
\`\`\`

## 크롤링 실행

\`\`\`bash
# 1. W-Tech FAQ (로그인 불필요)
node scripts/faq_full_crawl.js

# 2. W-Tech QNA 기술문의 (W-Tech 로그인 필요, 라이선스 요청글 자동 스킵)
node scripts/qna_crawl_v2.js

# 3. Confluence (로그인 필요 — 브라우저에서 구글 SSO 로그인 후 자동 진행)
node scripts/confluence_crawl.js
node scripts/confluence_uxdb_crawl.js

# 4. API 가이드 HTML → JSON 변환 (로컬 파일)
node scripts/convert_api_html.js

# 5. README 자동 업데이트
node scripts/update_readme.js
\`\`\`

## 데이터 형식

### FAQ / Confluence
\`\`\`json
{
  "title": "페이지 제목",
  "content": "본문 텍스트",
  "url": "원본 링크"
}
\`\`\`

### QNA (기술문의)
\`\`\`json
{
  "num": "10879",
  "status": "검토중",
  "product": "WebSquare5",
  "title": "질문 제목",
  "date": "2026-03-16",
  "author": "작성자",
  "question": "질문 본문",
  "commentCount": 1,
  "comments": [{ "author": "답변자", "content": "답변 내용" }]
}
\`\`\`

### API 가이드
\`\`\`json
{
  "component": "WebSquare.uiplugin.gridView",
  "title": "WebSquare API Guide - WebSquare.uiplugin.gridView",
  "content": "API 텍스트 (속성, 메서드, 이벤트 상세)"
}
\`\`\`

### Gmail 기술문의
\`\`\`json
{
  "subject": "기술 문의 제목",
  "date": "2026-03-16",
  "content": "기술 Q&A 내용 (개인정보 제거)"
}
\`\`\`
`;

fs.writeFileSync(README_PATH, readme, 'utf-8');
console.log('README.md 업데이트 완료!');
console.log('파일: ' + README_PATH);

