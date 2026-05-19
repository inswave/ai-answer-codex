#!/usr/bin/env node
/**
 * 데이터 수집 스크립트
 * 사용법: node scripts/collect.js [--source gmail,wtech,confluence,apiGuide,wtechFaq]
 */

const { collectAll } = require('../src/collectors');

const args = process.argv.slice(2);
const options = {};

// --source 옵션 파싱
const sourceIdx = args.indexOf('--source');
if (sourceIdx !== -1 && args[sourceIdx + 1]) {
  const sources = args[sourceIdx + 1].split(',');
  const allSources = ['gmail', 'wtech', 'confluence', 'apiGuide', 'wtechFaq'];

  for (const s of allSources) {
    options[s] = sources.includes(s);
  }
}

// --since 옵션 파싱 (YYYY-MM-DD)
const sinceIdx = args.indexOf('--since');
if (sinceIdx !== -1 && args[sinceIdx + 1]) {
  options.since = args[sinceIdx + 1];
}

collectAll(options)
  .then(() => {
    console.log('\n수집 완료');
    process.exit(0);
  })
  .catch((err) => {
    console.error('수집 실패:', err);
    process.exit(1);
  });
