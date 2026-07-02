#!/usr/bin/env node
/**
 * [범용] QA JSON 분류기
 *
 * { question, answer, ... } 배열을 읽어 분류기로 category/subcategory 를 부여하고
 * 저장한다. 릴리즈 노트 PDF 파싱 결과, account2 수집분 등 어떤 QA JSON 에도 사용.
 *
 * 여러 입력을 한 출력으로 합칠 수도 있다(배치 인덱싱용).
 *
 * 사용법:
 *   node scripts/classify_json.js <in.json> <out.json>
 *   node scripts/classify_json.js --out merged.json a.json b.json c.json
 */

const fs = require('fs');
const Classifier = require('../src/classifier/classifier');

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const argv = process.argv.slice(2);
  let out;
  const inputs = [];

  const outIdx = argv.indexOf('--out');
  if (outIdx !== -1) {
    out = argv[outIdx + 1];
    for (let i = 0; i < argv.length; i++) {
      if (i === outIdx || i === outIdx + 1) continue;
      inputs.push(argv[i]);
    }
  } else {
    if (argv.length < 2) {
      console.error('사용법: node scripts/classify_json.js <in.json> <out.json>');
      console.error('       node scripts/classify_json.js --out <merged.json> <in1> <in2> ...');
      process.exit(1);
    }
    inputs.push(argv[0]);
    out = argv[1];
  }

  if (!out || inputs.length === 0) {
    console.error('입력/출력 경로를 확인하세요.');
    process.exit(1);
  }

  const classifier = new Classifier();
  const all = [];
  for (const inPath of inputs) {
    let data;
    try {
      data = loadJSON(inPath);
    } catch (e) {
      console.error(`[분류] 입력 읽기 실패: ${inPath} — ${e.message}`);
      process.exit(1);
    }
    if (!Array.isArray(data)) {
      console.error(`[분류] 배열이 아님: ${inPath}`);
      process.exit(1);
    }
    console.log(`[분류] ${inPath}: ${data.length}건`);
    for (const item of data) {
      const r = classifier.classify(item);
      all.push({
        ...item,
        category: r.category,
        categoryLabel: r.categoryLabel,
        subcategory: r.subcategory,
        subcategoryLabel: r.subcategoryLabel,
      });
    }
  }

  const dist = {};
  for (const c of all) dist[c.categoryLabel] = (dist[c.categoryLabel] || 0) + 1;
  console.log('\n[분류] 카테고리 분포:');
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}건`);
  }

  fs.writeFileSync(out, JSON.stringify(all, null, 2), 'utf8');
  console.log(`\n[분류] 저장: ${out} (총 ${all.length}건)`);
}

main();
