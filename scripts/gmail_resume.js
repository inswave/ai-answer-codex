#!/usr/bin/env node
/**
 * Gmail 나머지 크롤링 재개 + 통합 + 분류 + 재인덱싱
 * 체크포인트 기반으로 이어서 처리
 */

const GmailCollector = require('../src/collectors/gmailCollector');
const { loadConfig } = require('../src/utils/config');
const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');

async function main() {
  console.log('=== Gmail 나머지 크롤링 재개 ===');

  const config = loadConfig().gmail;
  const excludeFilter = (config.searchQueries || []).join(' ');

  const collector = new GmailCollector(config);
  const newData = await collector.collect({ rawQuery: excludeFilter });
  console.log('[Gmail] 크롤링 완료:', newData.length, '건');

  await fs.writeFile(
    path.join(ROOT, 'data/raw/gmail_qa.json'),
    JSON.stringify(newData, null, 2),
    'utf8'
  );
  console.log('[Gmail] 저장 완료');

  // 통합
  console.log('\n=== 통합 시작 ===');
  execSync('node scripts/merge.js', { cwd: ROOT, stdio: 'inherit' });

  // 분류
  console.log('\n=== 분류 시작 ===');
  execSync('node scripts/classify.js', { cwd: ROOT, stdio: 'inherit' });

  // RAG 인덱싱
  console.log('\n=== RAG 인덱싱 시작 ===');
  const pythonPath = process.env.PYTHON_PATH || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe')
    : 'python3');
  execSync(`"${pythonPath}" src/rag/indexer.py`, { cwd: ROOT, stdio: 'inherit', timeout: 1800000 });

  console.log('\n=== 전체 완료 ===');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('실패:', err.message);
    process.exit(1);
  });
