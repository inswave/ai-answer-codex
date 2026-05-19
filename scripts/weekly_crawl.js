#!/usr/bin/env node
/**
 * 주간 크롤링 스크립트
 * Gmail + W-Tech + Confluence 증분 수집 → 통합 → 분류 → 인덱싱
 *
 * 사용법:
 *   node scripts/weekly_crawl.js          # 지난 7일 기준
 *   node scripts/weekly_crawl.js --days 3 # 지난 3일 기준
 *
 * 스케줄: 매주 월요일 자동 실행 (Windows Task Scheduler)
 */

const GmailCollector = require('../src/collectors/gmailCollector');
const WTechCollector = require('../src/collectors/wtechCollector');
const { ConfluenceCollector } = require('../src/collectors/confluenceCollector');
const { loadConfig } = require('../src/utils/config');
const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data/raw');
const LOG_DIR = path.join(ROOT, 'logs');

// --days 인자 파싱
const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const DAYS = daysIdx !== -1 && args[daysIdx + 1] ? parseInt(args[daysIdx + 1]) : 7;

async function log(message) {
  const now = new Date().toISOString();
  const logLine = `[${now}] ${message}\n`;
  console.log(message);

  await fs.mkdir(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `weekly_crawl_${now.split('T')[0]}.log`);
  await fs.appendFile(logFile, logLine, 'utf8');
}

// ── 1. Gmail 크롤링 ──
async function crawlGmail(afterDate) {
  await log('[Gmail] 크롤링 시작...');
  const config = loadConfig().gmail;

  // config.searchQueries는 제외 키워드 (예: "-subject:(정기점검) -subject:(보고서) ...")
  // 제외 항목만 빼고 전체 메일을 가져옴 (포함 키워드 없이)
  const excludeFilter = (config.searchQueries || []).join(' ');
  const searchQuery = `${excludeFilter} after:${afterDate}`;

  const collector = new GmailCollector(config);
  const newData = await collector.collect({ rawQuery: searchQuery });
  await log(`[Gmail] 크롤링: ${newData.length}건`);

  if (newData.length === 0) {
    await log('[Gmail] 신규 데이터 없음');
    return;
  }

  // 기존 데이터와 병합
  const existingPath = path.join(RAW_DIR, 'gmail_qa.json');
  let existingData = [];
  try {
    existingData = JSON.parse(await fs.readFile(existingPath, 'utf8'));
  } catch {
    await log('[Gmail] 기존 gmail_qa.json 없음. 새로 생성.');
  }

  const existingKeys = new Set(existingData.map((d) => (d.question || '').substring(0, 100)));
  const uniqueNew = newData.filter((d) => !existingKeys.has((d.question || '').substring(0, 100)));

  const merged = [...existingData, ...uniqueNew];
  await fs.writeFile(existingPath, JSON.stringify(merged, null, 2), 'utf8');
  await log(`[Gmail] 병합 완료: ${merged.length}건 (신규 ${uniqueNew.length}건)`);

  // 첨부파일 저장
  if (collector._parsedMails) {
    await collector.saveAttachments(collector._parsedMails, RAW_DIR);
  }
}

// ── 2. W-Tech 크롤링 ──
async function crawlWTech() {
  if (['1', 'true'].includes(String(process.env.DISABLE_PUPPETEER).toLowerCase())) {
    await log('[W-Tech] DISABLE_PUPPETEER=1 — 스킵');
    return;
  }
  await log('[W-Tech] 크롤링 시작 (증분)...');
  const collector = new WTechCollector();
  await collector.collect(); // 체크포인트 기반 증분: 연속 10건 기존 글이면 자동 종료
  await collector.save(RAW_DIR);
  await log(`[W-Tech] 크롤링 완료: 표준 QA ${collector.collectedData.length}건`);
}

// ── 3. Confluence 크롤링 ──
async function crawlConfluence() {
  await log('[Confluence] 크롤링 시작...');
  const collector = new ConfluenceCollector();
  await collector.collect(); // 5개 스페이스 전체 재수집 (~5~7분, fetch 기반이라 빠름)
  await collector.save(RAW_DIR);
  await log(`[Confluence] 크롤링 완료: ${collector.collectedData.length}건`);
}

// ── 메인 ──
async function main() {
  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - DAYS);
  const sinceStr = since.toISOString().split('T')[0]; // YYYY-MM-DD
  const afterDate = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, '0')}/${String(since.getDate()).padStart(2, '0')}`;

  await log(`=== 주간 크롤링 시작 (${sinceStr} 이후, ${DAYS}일) ===`);

  const results = [];

  // 각 크롤러 실행
  const tasks = [
    { name: 'Gmail', fn: () => crawlGmail(afterDate) },
    { name: 'W-Tech', fn: () => crawlWTech() },
    { name: 'Confluence', fn: () => crawlConfluence() },
  ];

  for (const task of tasks) {
    try {
      await task.fn();
      results.push({ name: task.name, status: 'success' });
    } catch (err) {
      await log(`[${task.name}] 실패: ${err.message}`);
      results.push({ name: task.name, status: 'failed' });
    }
  }

  // 통합 → 분류 → 인덱싱
  await log('데이터 통합 시작...');
  execSync('node scripts/merge.js', { cwd: ROOT, stdio: 'inherit' });

  await log('자동 분류 시작...');
  execSync('node scripts/classify.js', { cwd: ROOT, stdio: 'inherit' });

  await log('RAG 인덱싱 시작...');
  const pythonPath = process.env.PYTHON_PATH || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe')
    : 'python3');
  execSync(`"${pythonPath}" src/rag/indexer.py`, { cwd: ROOT, stdio: 'inherit', timeout: 1800000 });

  // 결과 요약
  await log('=== 주간 크롤링 결과 ===');
  for (const r of results) {
    await log(`  ${r.name}: ${r.status}`);
  }
  await log('========================');
}

main().catch(async (err) => {
  await log(`주간 크롤링 실패: ${err.message}`);
  process.exit(1);
});
