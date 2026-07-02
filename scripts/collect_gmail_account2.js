#!/usr/bin/env node
/**
 * [일회성] 2번째 Gmail 계정 크롤링 — 검토용 별도 수집
 *
 * 목적: terrafd@inswave.com 등 추가 계정의 메일을 "제외 필터" 방식으로
 *       (노이즈 제목만 빼고 전체) 받아 별도 파일로 저장 → 내용 검토 후
 *       운영 반영 여부 결정.
 *
 * 검색 방식: 포함 키워드로 좁히지 않고, 아래 EXCLUDE_SUBJECTS 제목만 제외한
 *           전체 메일을 받는다(기간 제한 없음). weekly_crawl.js 와 동일한
 *           -subject 제외 필터 방식.
 *
 * 안전장치:
 *   - 기존 data/raw/gmail_qa.json / 첨부 / merge 를 일절 건드리지 않는다.
 *     (collector.save() 를 호출하지 않고, 반환된 QA를 별도 파일로 직접 저장)
 *   - 잔여 체크포인트(.gmail_checkpoint.json 등)가 있으면 1번 계정 상태 보호를
 *     위해 즉시 중단한다.
 *   - 앱 비밀번호는 파일에 두지 않고 환경변수로만 받는다.
 *
 * 실행:
 *   GMAIL2_USER=terrafd@inswave.com \
 *   GMAIL2_APP_PASSWORD='xxxx xxxx xxxx xxxx' \
 *   node scripts/collect_gmail_account2.js
 *
 *   (PowerShell)
 *   $env:GMAIL2_USER='terrafd@inswave.com'; $env:GMAIL2_APP_PASSWORD='xxxx xxxx xxxx xxxx'; node scripts/collect_gmail_account2.js
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const GmailCollector = require('../src/collectors/gmailCollector');

const RAW_DIR = path.join(__dirname, '../data/raw');
const OUTPUT_PATH = path.join(RAW_DIR, 'gmail_qa_account2.json');

// 제외할 제목 키워드 (노이즈). 필요하면 여기만 편집하면 됨.
const EXCLUDE_SUBJECTS = ['정기점검', '보고서', '뉴스레터'];
// 기간 제한 없음(전체 기간). 특정 시점 이후만 받으려면 'YYYY/MM/DD' 로 지정.
const AFTER_DATE = '';
const CHECKPOINT_PATH = path.join(RAW_DIR, '.gmail_checkpoint.json');
const QA_PARTIAL_PATH = path.join(RAW_DIR, '.gmail_qa_partial.json');

async function main() {
  const user = process.env.GMAIL2_USER || 'terrafd@inswave.com';
  const appPassword = process.env.GMAIL2_APP_PASSWORD;

  if (!appPassword) {
    console.error('[중단] GMAIL2_APP_PASSWORD 환경변수가 없습니다.');
    console.error('       2번 계정에서 2단계 인증 ON → 앱 비밀번호(16자리) 생성 후,');
    console.error("       GMAIL2_APP_PASSWORD='xxxx xxxx xxxx xxxx' 로 지정해 다시 실행하세요.");
    process.exit(1);
  }

  // 체크포인트가 있으면 이어받기(resume). collect() 가 doneUIDs 를 읽어
  // 이미 받은 UID 는 건너뛰고 나머지부터 계속한다.
  const resuming = fs.existsSync(CHECKPOINT_PATH) || fs.existsSync(QA_PARTIAL_PATH);
  if (resuming) {
    console.log('[Account2] 기존 체크포인트 발견 → 이어받기(resume) 모드로 진행합니다.');
  }

  await fsp.mkdir(RAW_DIR, { recursive: true });

  // 앱 비밀번호 전용 config — oauth.refreshToken 을 두지 않아 IMAP 비밀번호 경로로 동작
  const config = {
    user,
    authType: 'app',
    appPassword,
  };

  // 제외 필터 쿼리 구성: -subject:(정기점검) -subject:(보고서) ... [after:날짜]
  const excludeFilter = EXCLUDE_SUBJECTS.map((kw) => `-subject:(${kw})`).join(' ');
  const rawQuery = [excludeFilter, AFTER_DATE ? `after:${AFTER_DATE}` : '']
    .filter(Boolean)
    .join(' ')
    .trim();

  console.log(`[Account2] 크롤링 시작: ${user} (앱 비밀번호 인증, 제외 필터 방식)`);
  console.log(`[Account2] 검색 쿼리: ${rawQuery || '(전체)'}`);
  console.log(`[Account2] 기간: ${AFTER_DATE ? `after:${AFTER_DATE}` : '전체 기간'}`);

  const collector = new GmailCollector(config);
  const qa = await collector.collect({ rawQuery });

  await fsp.writeFile(OUTPUT_PATH, JSON.stringify(qa, null, 2), 'utf8');

  console.log(`\n[Account2] 완료: ${qa.length}건 수집`);
  console.log(`[Account2] 저장: ${OUTPUT_PATH}`);
  console.log('[Account2] ※ 기존 gmail_qa.json / 첨부 / merge 는 변경되지 않았습니다.');

  // 간단 미리보기 (제목/질문 앞부분)
  const preview = qa.slice(0, 5).map((d, i) => {
    const q = (d.question || '').replace(/\s+/g, ' ').slice(0, 80);
    return `  ${i + 1}. ${q}`;
  });
  if (preview.length) {
    console.log('\n[미리보기] 상위 5건:');
    console.log(preview.join('\n'));
  }
}

main().catch((err) => {
  console.error('[Account2] 실패:', err.message);
  process.exit(1);
});
