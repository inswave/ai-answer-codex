#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sanitize } = require('../src/utils/sanitize');
const { maskSensitiveInfo } = require('../src/utils/masking');

const INPUT_PATH = path.resolve(__dirname, '../data/raw/wtech-qa/qna_data.json');
const DEFAULT_OUTPUT = path.resolve(__dirname, '../data/eval/wtech_holdout_100.json');
const DEFAULT_QUERIES_OUTPUT = path.resolve(__dirname, '../data/eval/wtech_holdout_queries.json');

const LICENSE_PATTERN = /라이선스|라이센스|license|ellicense|데모\s*라이선스|운영\s*라이선스|라이선스\s*발급|라이센스\s*발급|license\s*key/i;

function parseArgs(argv) {
  const args = {
    limit: 100,
    seed: '2026-05-08',
    output: DEFAULT_OUTPUT,
    queriesOutput: DEFAULT_QUERIES_OUTPUT,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') args.limit = Number(argv[++i] || args.limit);
    else if (arg === '--seed') args.seed = argv[++i] || args.seed;
    else if (arg === '--output') args.output = path.resolve(argv[++i] || args.output);
    else if (arg === '--queries-output') args.queriesOutput = path.resolve(argv[++i] || args.queriesOutput);
  }

  return args;
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableScore(item, seed) {
  return hash(`${seed}:${item.num || ''}:${item.title || ''}`).slice(0, 16);
}

function hasLicenseText(item) {
  const comments = Array.isArray(item.comments)
    ? item.comments.map((c) => c.content || '').join('\n')
    : '';
  const text = [
    item.title,
    item.question,
    item.product,
    item.category,
    comments,
  ].filter(Boolean).join('\n');
  return LICENSE_PATTERN.test(text);
}

function cleanText(text) {
  const normalized = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '');

  const withoutProjectLine = normalized
    .split('\n')
    .filter((line) => {
      const stripped = line.trim();
      if (!stripped) return true;
      if (stripped === '>') return false;
      if (/^\(?\s*\)?$/.test(stripped)) return false;
      if (/진행\s*\(?\s*투입\s*\)?\s*프로젝트\s*[:：]/i.test(stripped)) return false;
      if (/회사명\s*\/\s*프로젝트명/i.test(stripped)) return false;
      return true;
    })
    .join('\n');

  return maskSensitiveInfo(sanitize(withoutProjectLine))
    .replace(/^\s*>\s*$/gm, '')
    .replace(/^\s*\(\s*\)\s*$/gm, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/g, '[전화번호]')
    .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, '[전화번호]');
}

function buildAnswer(comments) {
  if (!Array.isArray(comments)) return '';
  return comments
    .map((comment) => cleanText(comment.content || ''))
    .filter((content) => content.length >= 10)
    .join('\n\n---\n\n');
}

function toEvalItem(item) {
  const question = cleanText([item.title, item.question].filter(Boolean).join('\n\n'));
  const expectedAnswer = buildAnswer(item.comments);
  const id = hash(`wtech:${item.num || ''}:${item.title || ''}`).slice(0, 16);

  return {
    id,
    source: 'W-Tech QNA',
    title: cleanText(item.title || ''),
    date: item.date || '',
    product: item.product || '',
    category: item.category || '',
    question,
    expectedAnswer,
    commentCount: Array.isArray(item.comments) ? item.comments.length : 0,
  };
}

function isUsable(item) {
  if (!item || !item.question && !item.title) return false;
  if (!Array.isArray(item.comments) || item.comments.length === 0) return false;
  if (hasLicenseText(item)) return false;

  const evalItem = toEvalItem(item);
  if (evalItem.question.length < 20) return false;
  if (evalItem.expectedAnswer.length < 30) return false;
  return true;
}

function main() {
  const args = parseArgs(process.argv);
  const raw = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
  const candidates = raw
    .filter(isUsable)
    .sort((a, b) => stableScore(a, args.seed).localeCompare(stableScore(b, args.seed)));

  const selected = candidates.slice(0, args.limit).map(toEvalItem);
  const querySet = selected.map((item) => ({
    id: item.id,
    query: item.question,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'data/raw/wtech-qa/qna_data.json',
    seed: args.seed,
    requestedLimit: args.limit,
    totalRaw: raw.length,
    candidateCount: candidates.length,
    selectedCount: selected.length,
    excludedPolicy: {
      license: 'license, elLicense, 라이선스, 라이센스 related posts are excluded',
      minimumQuestionLength: 20,
      minimumAnswerLength: 30,
    },
    items: selected,
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(args.queriesOutput, `${JSON.stringify(querySet, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    output: path.relative(process.cwd(), args.output).replace(/\\/g, '/'),
    queriesOutput: path.relative(process.cwd(), args.queriesOutput).replace(/\\/g, '/'),
    totalRaw: raw.length,
    candidateCount: candidates.length,
    selectedCount: selected.length,
  }, null, 2));
}

main();
