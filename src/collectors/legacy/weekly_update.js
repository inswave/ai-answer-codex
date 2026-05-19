/**
 * 주간 자동 데이터 업데이트
 * 매주 월요일 실행 — Gmail 신규 수집 → 분류 업데이트 → RAG 인덱스 재구축
 *
 * 수동 실행: node scripts/weekly_update.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, `update_${new Date().toISOString().split('T')[0]}.log`);

function log(msg) {
  const time = new Date().toLocaleTimeString('ko-KR');
  const line = `[${time}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
}

function run(cmd, label) {
  log(`▶ ${label} 시작`);
  try {
    const output = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 3600000, // 60분
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // 마지막 5줄만 로그
    const lastLines = output.trim().split('\n').slice(-5).join('\n');
    log(`  ${lastLines.replace(/\n/g, '\n  ')}`);
    log(`✔ ${label} 완료\n`);
    return true;
  } catch (err) {
    log(`✘ ${label} 실패: ${err.message.substring(0, 200)}`);
    return false;
  }
}

function getStats() {
  try {
    const email = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'email', 'email_technical_qna.json'), 'utf-8'));
    const qna = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wtech', 'qna_data.json'), 'utf-8'));
    return { email: email.length, qna: qna.length, total: email.length + qna.length };
  } catch {
    return { email: 0, qna: 0, total: 0 };
  }
}

async function main() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  log('========================================');
  log('  주간 데이터 업데이트 시작');
  log(`  날짜: ${new Date().toLocaleDateString('ko-KR')}`);
  log('========================================\n');

  const before = getStats();
  log(`수집 전 현황: Gmail ${before.email}건 / QNA ${before.qna}건\n`);

  // 1. Gmail 신규 수집
  const gmailOk = run('node scripts/gmail_crawl.js', '① Gmail 신규 수집');

  // 2. 분류 업데이트
  if (gmailOk) {
    run('node scripts/classify_data.js', '② 데이터 분류');
  }

  // 3. 다이제스트 재생성
  if (gmailOk) {
    run('node scripts/build_digest.js', '③ 다이제스트 재생성');
  }

  // 4. RAG 인덱스 재구축 (시간 오래 걸림 — 선택적)
  const ragIndexExists = fs.existsSync(path.join(ROOT, 'rag', 'vector_index'));
  if (ragIndexExists) {
    log('▶ ④ RAG 인덱스 재구축 (백그라운드)');
    try {
      // 별도 프로세스로 실행 (메인 스크립트는 바로 종료)
      const { spawn } = require('child_process');
      const child = spawn('node', ['rag/build_index.js'], {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      log('  RAG 인덱스 재구축 백그라운드 실행됨');
    } catch {
      log('  RAG 인덱스 재구축 스킵');
    }
  }

  // 결과
  const after = getStats();
  const added = after.email - before.email;

  log('\n========================================');
  log('  업데이트 완료');
  log(`  Gmail: ${before.email} → ${after.email}건 (+${added}건)`);
  log(`  로그: ${LOG_FILE}`);
  log('========================================');
}

main().catch(err => {
  log(`오류: ${err.message}`);
  process.exit(1);
});
