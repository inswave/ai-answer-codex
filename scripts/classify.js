#!/usr/bin/env node
/**
 * 데이터 분류 스크립트
 * 사용법: node scripts/classify.js [--input data/processed/all_qa.json]
 */

const fs = require('fs').promises;
const path = require('path');
const Classifier = require('../src/classifier/classifier');
const DigestGenerator = require('../src/classifier/digestGenerator');

const PROCESSED_DIR = path.join(__dirname, '../data/processed');

async function main() {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  const inputPath = inputIdx !== -1 ? args[inputIdx + 1] : path.join(PROCESSED_DIR, 'all_qa.json');

  // 데이터 로드
  const raw = await fs.readFile(inputPath, 'utf8');
  const data = JSON.parse(raw);
  console.log(`데이터 로드: ${data.length}건`);

  // 분류 실행
  const classifier = new Classifier();
  const classified = classifier.classifyAll(data);
  classifier.printStats();

  // 분류 결과 저장
  await classifier.save(classified, PROCESSED_DIR);

  // 다이제스트 생성
  const digestGen = new DigestGenerator();
  const digests = digestGen.generate(classified);
  await digestGen.save(digests, PROCESSED_DIR);

  console.log('\n분류 및 다이제스트 생성 완료');
}

main().catch((err) => {
  console.error('분류 실패:', err);
  process.exit(1);
});
