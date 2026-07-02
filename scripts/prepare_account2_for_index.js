#!/usr/bin/env node
/**
 * [로컬] account2 수집분 → 필터링 + 분류 → 운영 증분 인덱싱용 JSON 생성
 *
 * 흐름:
 *   gmail_qa_account2.json
 *     → 노이즈 제목 제외 (핫픽스/claude/codex/정기점검 등)
 *     → 길이 필터 (질문<5, 답변<20 제거)
 *     → (선택) 기존 gmail_qa.json 과 중복 제거
 *     → (선택) 기간 필터 (--after YYYY)
 *     → 분류기로 category/subcategory 부여
 *     → data/processed/account2_classified.json 저장
 *
 * 이 산출물 하나만 운영서버로 옮겨 "증분 인덱싱"에 사용한다.
 * (운영 merge 를 돌리지 않으므로 all_qa.json 파괴 위험 없음)
 *
 * 실행:
 *   node scripts/prepare_account2_for_index.js
 *   node scripts/prepare_account2_for_index.js --after 2023   # 2023년 이후만
 *   node scripts/prepare_account2_for_index.js --in data/raw/.gmail_qa_partial.json  # 중간분으로 미리
 */

const fs = require('fs');
const path = require('path');
const Classifier = require('../src/classifier/classifier');

const RAW_DIR = path.join(__dirname, '../data/raw');
const PROCESSED_DIR = path.join(__dirname, '../data/processed');

// 인자 파싱
const argv = process.argv.slice(2);
function argVal(flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}
const INPUT = argVal('--in') || path.join(RAW_DIR, 'gmail_qa_account2.json');
const OUTPUT = argVal('--out') || path.join(PROCESSED_DIR, 'account2_classified.json');
const AFTER_YEAR = argVal('--after'); // 예: '2023' → 2023년 이후만
const EXISTING = path.join(RAW_DIR, 'gmail_qa.json');

// report 스크립트와 동일한 노이즈 제목 패턴 (제외 대상)
const NOISE_PATTERNS = [
  /정기점검/, /보고서/, /뉴스레터/, /광고/, /휴가/, /결재/, /회의록/,
  /참석/, /설문/, /안내\s*말씀/, /공지/, /초대/, /webinar|세미나/i,
  /(핫픽스|hot\s*fix).*전달|전달.*(핫픽스|hot\s*fix)/i, /핫픽스|hot\s*fix/i,
  /claude/i, /codex/i,
  // 보고서 변형 (주간/일간/업무 보고)
  /주간\s*보고|업무\s*보고|일간\s*보고|보고\s*작성/,
  // 라이선스 발급/전달/요청류 (행정성) — '라이선스' 단독은 기술문의일 수 있어 제외 안 함. 라인선스=오타
  /(라이선스|라이센스|라인선스|license)[\s\S]{0,20}(발급|재발급|전달|요청|규정|갱신|증서|납품)/i,
  /(발급|전달|요청|갱신|증서|납품)[\s\S]{0,20}(라이선스|라이센스|라인선스)/i,
  /요청하신[\s\S]{0,20}(라이선스|라이센스|라인선스)/i,
  // 데모/개발 라이선스 만료 안내 (행정성)
  /(라이선스|라이센스|라인선스)[\s\S]{0,15}만료|만료[\s\S]{0,15}(라이선스|라이센스)/i,
  // 뉴스클리핑 / 경비·복리후생 행정 / 보고마감·업무혁신·교육안내 공지
  /뉴스\s*클리핑/,
  /법인카드|경비\s*사용|경비\s*내역|복리후생비|비용\s*정산/,
  /보고\s*마감|마감\s*안내|회차\s*보고|업무\s*혁신|제출\s*안내|교육\s*안내/,
  // 경조사 / 영업·계약 / 연락처·계정 행정 / 임원보고·조사서 / 일정공유
  /부고|빙부상|빙모상|조부상|조모상|별세|발인/,
  /유지보수\s*(사업|계약)|사업\s*연장|사전\s*안내|계약\s*연장/,
  /연락처\s*(전달|변경)|Contact\s*(Change|Notification)/i,
  /계정\s*(공유|정지|대체|생성|삭제|변경)/,
  /임원\s*보고|보고\s*보내|보고서\s*송부|조사서\s*(회신|작성)/,
  /일정\s*공유|패치\s*일정/,
  // 담당자 변경 / 회의 자료·시간 / 실적자료 (행정)
  /담당자\s*변경/,
  /회의\s*자료|회의\s*시간|회의\s*일정|월간\s*회의|주간\s*회의/,
  /실적\s*(자료|보고)|실적\s*DB/,
];

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function main() {
  const data = loadJSON(INPUT);
  if (!Array.isArray(data)) {
    console.error(`[준비] 입력 파일을 읽을 수 없습니다: ${INPUT}`);
    process.exit(1);
  }
  console.log(`[준비] 입력: ${INPUT} (${data.length}건)`);

  // 기존 1번 계정 데이터(있으면) 중복 제거용 키셋
  const existing = loadJSON(EXISTING);
  const existKeys = Array.isArray(existing)
    ? new Set(existing.map((d) => (d.question || '').substring(0, 100)))
    : null;
  if (existKeys) console.log(`[준비] 기존 gmail_qa.json ${existing.length}건과 중복 제거 적용`);
  else console.log('[준비] 기존 gmail_qa.json 없음 — 중복 제거 생략 (운영 인덱싱 시 해시로 자동 스킵됨)');

  const dropped = { noise: 0, short: 0, dup: 0, oldYear: 0, selfDup: 0 };
  const seenSelf = new Set();
  const kept = [];

  for (const d of data) {
    const q = (d.question || '').trim();
    const a = (d.answer || '').trim();

    // 노이즈 제목 제외
    if (NOISE_PATTERNS.some((p) => p.test(q))) { dropped.noise++; continue; }
    // 길이 필터
    if (q.length < 5 || a.length < 20) { dropped.short++; continue; }
    // 기간 필터
    if (AFTER_YEAR) {
      const y = (d.date || '').match(/\d{4}/)?.[0];
      if (!y || y < AFTER_YEAR) { dropped.oldYear++; continue; }
    }
    // 기존 1번 계정과 중복
    if (existKeys && existKeys.has(q.substring(0, 100))) { dropped.dup++; continue; }
    // 자기 내부 중복
    const selfKey = q.substring(0, 100);
    if (seenSelf.has(selfKey)) { dropped.selfDup++; continue; }
    seenSelf.add(selfKey);

    kept.push(d);
  }

  console.log(`[준비] 필터 결과: 유지 ${kept.length}건`);
  console.log(`        제외 — 노이즈 ${dropped.noise} / 짧음 ${dropped.short} / 기존중복 ${dropped.dup} / 자체중복 ${dropped.selfDup}${AFTER_YEAR ? ` / 기간(${AFTER_YEAR}↓) ${dropped.oldYear}` : ''}`);

  // 분류
  const classifier = new Classifier();
  const classified = kept.map((item) => {
    const r = classifier.classify(item);
    return {
      ...item,
      source: item.source || 'Gmail 기술문의(계정2)',
      category: r.category,
      categoryLabel: r.categoryLabel,
      subcategory: r.subcategory,
      subcategoryLabel: r.subcategoryLabel,
    };
  });

  // 카테고리 분포 출력
  const dist = {};
  for (const c of classified) dist[c.categoryLabel] = (dist[c.categoryLabel] || 0) + 1;
  console.log('\n[준비] 카테고리 분포:');
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}건`);
  }

  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(classified, null, 2), 'utf8');
  console.log(`\n[준비] 저장: ${OUTPUT} (${classified.length}건)`);
  console.log('[준비] 다음 단계: 이 파일을 운영서버로 옮겨 증분 인덱싱 → RAG 재시작');
  console.log('        (scripts/index_account2_on_prod.sh 참고)');
}

main();
