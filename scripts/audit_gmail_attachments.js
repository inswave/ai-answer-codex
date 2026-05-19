#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../data/raw/gmail_attachments');
const OUTPUT_PATH = path.resolve(__dirname, '../data/review/gmail_attachment_manifest.json');
const LOCAL_MAP_PATH = path.resolve(__dirname, '../data/review/gmail_attachment_local_map.json');
const WITH_LOCAL_MAP = process.argv.includes('--with-local-map');

const SAMPLE_EXT = new Set(['.xml', '.html', '.htm', '.js', '.css', '.txt', '.md']);
const DOC_REVIEW_EXT = new Set(['.doc', '.docx', '.pdf']);
const DROP_EXT = new Set([
  '.zip', '.xlsx', '.xls', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp',
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.msi', '.scr', '.com', '.vbs', '.dll',
  '.sql', '.java', '.jsp', '.ini', '.conf', '.json', '.csv', '.bin', '.ics',
]);
const LICENSE_EXT = new Set(['.ellicense', '.license', '.lic', '.key']);
const RISKY_NAME_PATTERN = /license|licence|라이선스|라이센스|보고서|점검|유지보수|계약|견적|청구|정산|회의록|설치계획서|확인서|계약서|검수|납품|공문|요청서/i;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function hashRelativePath(fullPath) {
  const relative = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
  return crypto.createHash('sha256').update(relative).digest('hex').slice(0, 16);
}

function classifyFile(fullPath) {
  const stat = fs.statSync(fullPath);
  const filename = path.basename(fullPath);
  const ext = path.extname(filename).toLowerCase();
  const reasons = [];

  if (!ext) reasons.push('missing_extension');
  if (LICENSE_EXT.has(ext) || RISKY_NAME_PATTERN.test(filename)) reasons.push('risky_name_or_license');

  let classification = 'dropCandidates';

  if (reasons.includes('risky_name_or_license')) {
    classification = 'dropCandidates';
  } else if (SAMPLE_EXT.has(ext)) {
    classification = 'sampleCandidates';
  } else if (DOC_REVIEW_EXT.has(ext)) {
    classification = 'docReviewCandidates';
  } else if (DROP_EXT.has(ext) || !ext) {
    classification = 'dropCandidates';
  } else {
    classification = 'dropCandidates';
    reasons.push('unsupported_extension');
  }

  if (classification === 'sampleCandidates') reasons.push('technical_sample_extension');
  if (classification === 'docReviewCandidates') reasons.push('document_review_extension');
  if (DROP_EXT.has(ext)) reasons.push('excluded_extension');

  return {
    id: hashRelativePath(fullPath),
    extension: ext || '(none)',
    size: stat.size,
    classification,
    reasons: [...new Set(reasons)],
  };
}

function toLocalMapItem(fullPath) {
  const item = classifyFile(fullPath);
  const relativePath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');

  return {
    id: item.id,
    classification: item.classification,
    extension: item.extension,
    size: item.size,
    relativePath,
    filename: path.basename(fullPath),
  };
}

function summarize(items) {
  const byClassification = {};
  const byExtension = {};
  let totalBytes = 0;

  for (const item of items) {
    byClassification[item.classification] = (byClassification[item.classification] || 0) + 1;
    byExtension[item.extension] = (byExtension[item.extension] || 0) + 1;
    totalBytes += item.size;
  }

  return {
    total: items.length,
    totalBytes,
    sampleCandidateCount: byClassification.sampleCandidates || 0,
    docReviewCandidateCount: byClassification.docReviewCandidates || 0,
    dropCandidateCount: byClassification.dropCandidates || 0,
    byExtension: Object.fromEntries(
      Object.entries(byExtension).sort((a, b) => b[1] - a[1])
    ),
  };
}

function main() {
  const files = walk(ROOT_DIR);
  const items = files.map(classifyFile);
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceRoot: 'data/raw/gmail_attachments',
    privacy: {
      includesOriginalFilenames: false,
      includesOriginalPaths: false,
      id: 'sha256(relativePath).slice(0, 16)',
    },
    policy: {
      sampleCandidates: [...SAMPLE_EXT].sort(),
      docReviewCandidates: [...DOC_REVIEW_EXT].sort(),
      dropCandidates: 'license/risky business documents, zip, spreadsheets, images, executable/config/data files, unsupported extensions',
    },
    stats: summarize(items),
    sampleCandidates: items.filter((item) => item.classification === 'sampleCandidates'),
    docReviewCandidates: items.filter((item) => item.classification === 'docReviewCandidates'),
    dropCandidates: items.filter((item) => item.classification === 'dropCandidates'),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  let localMapOutput = null;
  if (WITH_LOCAL_MAP) {
    const localMap = {
      generatedAt: manifest.generatedAt,
      sourceRoot: ROOT_DIR,
      warning: 'Local review aid only. Contains original Gmail attachment filenames and paths. Do not commit or share.',
      files: files.map(toLocalMapItem),
    };
    fs.writeFileSync(LOCAL_MAP_PATH, `${JSON.stringify(localMap, null, 2)}\n`, 'utf8');
    localMapOutput = path.relative(process.cwd(), LOCAL_MAP_PATH).replace(/\\/g, '/');
  }

  console.log(JSON.stringify({
    output: path.relative(process.cwd(), OUTPUT_PATH).replace(/\\/g, '/'),
    localMapOutput,
    stats: manifest.stats,
  }, null, 2));
}

main();
