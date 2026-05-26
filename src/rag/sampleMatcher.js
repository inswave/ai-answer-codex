const fs = require('fs');
const path = require('path');

const SAMPLE_ROOT = path.resolve(__dirname, '../../data/raw/dev-guide-sample');
const MAX_RESULTS = 2;
const MAX_QUERY_TOKENS = 20;
const MIN_SAMPLE_SCORE = 18;
const SAMPLE_REQUEST_PATTERN = /예제|샘플|첨부|소스|sample|example|xml|w2x|파일/i;
const TOKEN_RE = /[A-Za-z][A-Za-z0-9_.$-]*|[가-힣]{2,}|\d+/g;
const KOREAN_SYNONYMS = [
  { pattern: /엑셀|excel/i, tokens: ['excel', 'advancedexceldownload'] },
  { pattern: /다운로드|download/i, tokens: ['download', 'advancedexceldownload'] },
  { pattern: /업로드|upload/i, tokens: ['upload', 'advancedexcelupload'] },
  { pattern: /그리드|grid/i, tokens: ['gridview'] },
  { pattern: /병합|merge/i, tokens: ['merge', 'mergecells'] },
  { pattern: /서브미션|submission/i, tokens: ['submission', 'executesubmission'] },
  { pattern: /팝업|popup/i, tokens: ['popup', 'openpopup'] },
];

let sampleCache = null;

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function splitIdentifier(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.$/-]+/g, ' ');
}

function tokenize(text) {
  const expanded = splitIdentifier(text);
  const rawTokens = expanded.match(TOKEN_RE) || [];
  const tokens = [];
  const seen = new Set();

  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    if (lower.length < 2) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    tokens.push(lower);
  }

  return tokens;
}

function expandQueryTokens(text, baseTokens) {
  const tokens = [...baseTokens];
  const seen = new Set(tokens);

  for (const item of KOREAN_SYNONYMS) {
    if (!item.pattern.test(text || '')) continue;
    for (const token of item.tokens) {
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }

  return tokens;
}

function walkXmlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkXmlFiles(fullPath, out);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.xml') {
      out.push(fullPath);
    }
  }

  return out;
}

function getSampleIndex() {
  if (sampleCache) return sampleCache;

  const files = walkXmlFiles(SAMPLE_ROOT).map((fullPath) => {
    const rel = normalizePath(path.relative(SAMPLE_ROOT, fullPath));
    const dir = path.dirname(rel) === '.' ? '' : normalizePath(path.dirname(rel));
    const filename = path.basename(rel);
    const stat = fs.statSync(fullPath);
    const searchable = [
      rel,
      dir,
      filename.replace(/\.xml$/i, ''),
    ].join(' ');

    return {
      filename,
      dir: `dev-guide-sample/${dir}`.replace(/\/$/, ''),
      size: stat.size,
      rel,
      tokens: tokenize(searchable),
      searchable: searchable.toLowerCase(),
    };
  });

  sampleCache = files;
  return sampleCache;
}

function scoreSample(sample, queryTokens, directTokens, queryText) {
  if (queryTokens.length === 0) return 0;

  let score = 0;
  const tokenSet = new Set(sample.tokens);
  const searchable = sample.searchable;

  for (const token of queryTokens) {
    if (tokenSet.has(token)) score += 4;
    else if (searchable.includes(token)) score += 2;
  }

  for (const token of directTokens) {
    if (tokenSet.has(token)) score += 8;
    else if (searchable.includes(token)) score += 4;
  }

  // Strong boost when the user mentions an exact API/sample stem.
  if (queryText && searchable.includes(queryText)) score += 12;

  if (directTokens.includes('advancedexceldownload') && searchable.includes('advancedexcelupload')) {
    score -= 12;
  }
  if (directTokens.includes('advancedexcelupload') && searchable.includes('advancedexceldownload')) {
    score -= 12;
  }
  if (directTokens.includes('download') && searchable.includes('upload')) {
    score -= 8;
  }
  if (directTokens.includes('excel') && searchable.includes('/excel/')) {
    score += 6;
  }
  if (directTokens.includes('gridview') && searchable.includes('gridview/')) {
    score += 6;
  }

  return score;
}

function sampleSortPriority(sample) {
  const firstSegment = sample.rel.split('/')[0] || '';
  return firstSegment.startsWith('_') ? 1 : 0;
}

function buildSearchText(query, cases) {
  const caseText = Array.isArray(cases)
    ? cases.slice(0, 5).map((c) => [
      c.title,
      c.source,
      c.content,
    ].filter(Boolean).join(' ')).join(' ')
    : '';

  return [query, caseText].filter(Boolean).join(' ');
}

function toSampleFile(sample) {
  return {
    filename: sample.filename,
    mimeType: 'application/xml',
    size: sample.size,
    sourceTitle: '개발가이드 샘플',
    downloadUrl: `/api/attachment?dir=${encodeURIComponent(sample.dir)}&filename=${encodeURIComponent(sample.filename)}`,
  };
}

function mergeSampleFiles(primary, supplemental, maxResults = MAX_RESULTS) {
  const seen = new Set();
  const merged = [];

  for (const item of [...(primary || []), ...(supplemental || [])]) {
    if (!item || !item.downloadUrl) continue;
    const key = item.downloadUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= maxResults) break;
  }

  return merged;
}

function shouldIncludeSampleFiles(query) {
  return SAMPLE_REQUEST_PATTERN.test(String(query || ''));
}

function findSampleFiles(query, cases = [], options = {}) {
  const maxResults = options.maxResults || MAX_RESULTS;
  if (!shouldIncludeSampleFiles(query) && !options.force) return [];

  const searchText = buildSearchText(query, cases);
  const directTokens = expandQueryTokens(query, tokenize(query)).slice(0, MAX_QUERY_TOKENS);
  const queryTokens = expandQueryTokens(searchText, tokenize(searchText)).slice(0, MAX_QUERY_TOKENS);
  const normalizedQuery = splitIdentifier(query).toLowerCase().trim();

  if (queryTokens.length === 0) return [];

  const seenFilename = new Set();
  const matches = getSampleIndex()
    .map((sample) => ({
      sample,
      score: scoreSample(sample, queryTokens, directTokens, normalizedQuery),
    }))
    .filter((item) => item.score >= (options.minScore || MIN_SAMPLE_SCORE))
    .sort((a, b) => (
      b.score - a.score
      || sampleSortPriority(a.sample) - sampleSortPriority(b.sample)
      || a.sample.rel.localeCompare(b.sample.rel)
    ));

  const files = [];
  for (const item of matches) {
    const key = item.sample.filename.toLowerCase();
    if (seenFilename.has(key)) continue;
    seenFilename.add(key);
    files.push(toSampleFile(item.sample));
    if (files.length >= maxResults) break;
  }

  return files;
}

module.exports = {
  findSampleFiles,
  mergeSampleFiles,
  getSampleIndex,
  shouldIncludeSampleFiles,
};
