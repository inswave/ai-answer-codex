#!/usr/bin/env node
/**
 * [검토용] 2번째 Gmail 계정 수집 결과 리포트
 *
 * collect_gmail_account2.js 가 만든 data/raw/gmail_qa_account2.json 을 분석하여
 * "운영에 반영할 가치가 있는지" 판단에 필요한 통계를 출력한다.
 *
 *   - 총 건수 / 연도별 분포
 *   - 본문 길이 분포 (노이즈 추정)
 *   - 기술문의 추정 비율 (1번 계정 키워드 + 태그 기준)
 *   - 태그(주제) 분포
 *   - 기존 gmail_qa.json 과의 중복(겹침) 추정
 *   - 기술문의 추정 샘플 미리보기
 *
 * 실행: node scripts/report_gmail_account2.js
 *       node scripts/report_gmail_account2.js path/to/file.json   (대상 지정)
 */

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '../data/raw');
const TARGET = process.argv[2] || path.join(RAW_DIR, 'gmail_qa_account2.json');
const EXISTING = path.join(RAW_DIR, 'gmail_qa.json');

// 1번 계정과 동일한 기술문의 포함 키워드
const TECH_KEYWORDS = [
  /기술문의/i, /기술지원/i, /websquare/i, /웹스퀘어/i,
  /gridview/i, /엑셀\s*다운로드/i, /라이선스|라이센스/i,
];

// 노이즈(비기술) 추정 제목 패턴
const NOISE_PATTERNS = [
  /정기점검/, /보고서/, /뉴스레터/, /광고/, /휴가/, /결재/, /회의록/,
  /참석/, /설문/, /안내\s*말씀/, /공지/, /초대/, /webinar|세미나/i,
  // 내부 배포/작업 메일 — 기술문의 아님 (사용자 지정 제외 대상)
  // '전달'은 단독이면 정상 문의도 잡으므로 핫픽스/hotfix 와 같이 있을 때만 제외
  /(핫픽스|hot\s*fix).*전달|전달.*(핫픽스|hot\s*fix)/i, /핫픽스|hot\s*fix/i,
  /claude/i, /codex/i,
  // 보고서 변형 (주간/일간/업무 보고)
  /주간\s*보고|업무\s*보고|일간\s*보고|보고\s*작성/,
  // 라이선스 발급/전달/요청류 (행정성). 라인선스=오타
  /(라이선스|라이센스|라인선스|license)[\s\S]{0,20}(발급|재발급|전달|요청|규정|갱신|증서|납품)/i,
  /(발급|전달|요청|갱신|증서|납품)[\s\S]{0,20}(라이선스|라이센스|라인선스)/i,
  /요청하신[\s\S]{0,20}(라이선스|라이센스|라인선스)/i,
  /(라이선스|라이센스|라인선스)[\s\S]{0,15}만료|만료[\s\S]{0,15}(라이선스|라이센스)/i,
  /뉴스\s*클리핑/,
  /법인카드|경비\s*사용|경비\s*내역|복리후생비|비용\s*정산/,
  /보고\s*마감|마감\s*안내|회차\s*보고|업무\s*혁신|제출\s*안내|교육\s*안내/,
  /부고|빙부상|빙모상|조부상|조모상|별세|발인/,
  /유지보수\s*(사업|계약)|사업\s*연장|사전\s*안내|계약\s*연장/,
  /연락처\s*(전달|변경)|Contact\s*(Change|Notification)/i,
  /계정\s*(공유|정지|대체|생성|삭제|변경)/,
  /임원\s*보고|보고\s*보내|보고서\s*송부|조사서\s*(회신|작성)/,
  /일정\s*공유|패치\s*일정/,
  /담당자\s*변경/,
  /회의\s*자료|회의\s*시간|회의\s*일정|월간\s*회의|주간\s*회의/,
  /실적\s*(자료|보고)|실적\s*DB/,
];

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function pct(n, total) {
  return total ? `${((n / total) * 100).toFixed(1)}%` : '0%';
}

function bar(n, total, width = 30) {
  const filled = total ? Math.round((n / total) * width) : 0;
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

function main() {
  const data = loadJSON(TARGET);
  if (!Array.isArray(data)) {
    console.error(`[리포트] 대상 파일을 읽을 수 없습니다: ${TARGET}`);
    console.error('         수집이 끝났는지 확인하세요. (수집 중이면 .gmail_qa_partial.json 만 존재)');
    process.exit(1);
  }

  const total = data.length;
  console.log('='.repeat(60));
  console.log(`Gmail 계정2 수집 검토 리포트`);
  console.log(`대상: ${TARGET}`);
  console.log(`총 건수: ${total.toLocaleString()}건`);
  console.log('='.repeat(60));

  // ── 1. 연도별 분포 ──
  const byYear = {};
  for (const d of data) {
    const y = (d.date || '').match(/\d{4}/)?.[0] || '미상';
    byYear[y] = (byYear[y] || 0) + 1;
  }
  console.log('\n[1] 연도별 분포');
  for (const y of Object.keys(byYear).sort()) {
    console.log(`  ${y}  ${String(byYear[y]).padStart(6)}  ${bar(byYear[y], total)} ${pct(byYear[y], total)}`);
  }

  // ── 2. 본문 길이 분포 ──
  const buckets = { '~50 (노이즈 의심)': 0, '50~200': 0, '200~1000': 0, '1000~': 0 };
  for (const d of data) {
    const len = (d.answer || '').length;
    if (len < 50) buckets['~50 (노이즈 의심)']++;
    else if (len < 200) buckets['50~200']++;
    else if (len < 1000) buckets['200~1000']++;
    else buckets['1000~']++;
  }
  console.log('\n[2] 본문(답변) 길이 분포');
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`  ${k.padEnd(18)} ${String(v).padStart(6)}  ${bar(v, total)} ${pct(v, total)}`);
  }

  // ── 3. 기술문의 추정 비율 ──
  let tech = 0, noise = 0;
  const techSamples = [];
  for (const d of data) {
    const hay = `${d.question || ''} ${d.answer || ''}`;
    const isTech = TECH_KEYWORDS.some((p) => p.test(hay)) || (Array.isArray(d.tags) && d.tags.length > 0);
    const isNoise = NOISE_PATTERNS.some((p) => p.test(d.question || ''));
    if (isTech) { tech++; if (techSamples.length < 10) techSamples.push(d); }
    if (isNoise) noise++;
  }
  console.log('\n[3] 내용 추정 분류');
  console.log(`  기술문의 추정    ${String(tech).padStart(6)}  ${bar(tech, total)} ${pct(tech, total)}`);
  console.log(`  노이즈 제목 추정 ${String(noise).padStart(6)}  ${bar(noise, total)} ${pct(noise, total)}`);
  console.log(`  (기술문의 = 1번 키워드 매칭 또는 태그 존재 / 노이즈 = 비기술 제목 패턴)`);

  // ── 4. 태그(주제) 분포 ──
  const tagCount = {};
  for (const d of data) {
    for (const t of (d.tags || [])) tagCount[t] = (tagCount[t] || 0) + 1;
  }
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('\n[4] 상위 태그(주제) 분포');
  if (topTags.length === 0) console.log('  (태그 없음)');
  for (const [t, c] of topTags) {
    console.log(`  ${t.padEnd(16)} ${String(c).padStart(6)}  ${bar(c, total)} ${pct(c, total)}`);
  }

  // ── 5. 기존 gmail_qa.json 과 중복 추정 ──
  const existing = loadJSON(EXISTING);
  if (Array.isArray(existing)) {
    const existKeys = new Set(existing.map((d) => (d.question || '').substring(0, 100)));
    let overlap = 0;
    for (const d of data) {
      if (existKeys.has((d.question || '').substring(0, 100))) overlap++;
    }
    console.log('\n[5] 기존 1번 계정(gmail_qa.json) 과 중복 추정');
    console.log(`  기존 데이터: ${existing.length.toLocaleString()}건`);
    console.log(`  제목 앞 100자 기준 겹침: ${overlap}건 (${pct(overlap, total)})`);
    console.log(`  → 신규 추정: ${(total - overlap).toLocaleString()}건`);
  } else {
    console.log('\n[5] 기존 gmail_qa.json 없음 — 중복 비교 생략');
  }

  // ── 6. 기술문의 샘플 ──
  console.log('\n[6] 기술문의 추정 샘플 (최대 10건)');
  techSamples.forEach((d, i) => {
    const q = (d.question || '').replace(/\s+/g, ' ').slice(0, 70);
    const a = (d.answer || '').replace(/\s+/g, ' ').slice(0, 90);
    console.log(`  ${String(i + 1).padStart(2)}. [${d.date ? d.date.slice(0, 10) : '------'}] ${q}`);
    console.log(`      └ ${a}...`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('판단 가이드:');
  console.log(`  - 기술문의 비율(${pct(tech, total)})이 높고 신규분이 많으면 → 운영 반영 가치 있음`);
  console.log('  - 길이 ~50 비중이 크면 정제 단계에서 대부분 걸러짐(정상)');
  console.log('  - 반영 시: gmail_qa.json 에 합치거나 merge.js 에 소스 추가 → merge → classify → index');
  console.log('='.repeat(60));
}

main();
