#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const WTechCollector = require('../src/collectors/wtechCollector');
const { sanitize } = require('../src/utils/sanitize');
const { maskSensitiveInfo } = require('../src/utils/masking');

const DEFAULT_OUTPUT = path.resolve(__dirname, '../data/eval/latest_wtech_10.json');

const LICENSE_PATTERN = /라이선스|라이센스|license|ellicense|라이선스\s*키|라이센스\s*키|키\s*발급|플러그인\s*전달|plugin\s*delivery/i;

function parseArgs(argv) {
  const args = {
    limit: 10,
    maxPages: 5,
    output: DEFAULT_OUTPUT,
  };
  const positional = [];

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') args.limit = Number(argv[++i] || args.limit);
    else if (arg === '--max-pages') args.maxPages = Number(argv[++i] || args.maxPages);
    else if (arg === '--output') args.output = path.resolve(argv[++i] || args.output);
    else positional.push(arg);
  }

  if (positional[0] && !Number.isNaN(Number(positional[0]))) args.limit = Number(positional[0]);
  if (positional[1] && !Number.isNaN(Number(positional[1]))) args.maxPages = Number(positional[1]);
  if (positional[2]) args.output = path.resolve(positional[2]);

  return args;
}

function cleanText(text) {
  return maskSensitiveInfo(sanitize(String(text || '')))
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasLicenseText(item) {
  const comments = Array.isArray(item.comments)
    ? item.comments.map((comment) => comment.content || '').join('\n')
    : '';
  const haystack = [
    item.num,
    item.title,
    item.product,
    item.category,
    item.question,
    comments,
  ].filter(Boolean).join('\n');

  return LICENSE_PATTERN.test(haystack);
}

function hasUsefulComment(item) {
  return Array.isArray(item.comments)
    && item.comments.some((comment) => cleanText(comment.content).length >= 20);
}

function toEvalItem(item) {
  return {
    num: String(item.num || ''),
    status: cleanText(item.status || ''),
    product: cleanText(item.product || ''),
    category: cleanText(item.category || ''),
    title: cleanText(item.title || ''),
    date: cleanText(item.date || ''),
    views: cleanText(item.views || ''),
    question: cleanText(item.question || ''),
    commentCount: Array.isArray(item.comments) ? item.comments.length : 0,
    comments: (item.comments || [])
      .map((comment) => ({
        author: cleanText(comment.author || ''),
        date: cleanText(comment.date || ''),
        content: cleanText(comment.content || ''),
        file: comment.file ? cleanText(comment.file) : undefined,
      }))
      .filter((comment) => comment.content),
  };
}

async function getDetailAttachments(page) {
  return page.evaluate(() => {
    const names = new Set();
    const candidates = Array.from(document.querySelectorAll('[id*="file"], [id*="File"], [id*="filenm"], [id*="atch"]'));
    for (const el of candidates) {
      const text = el.innerText?.trim() || el.getAttribute('title')?.trim() || '';
      if (!text) continue;
      if (/\.(xml|html?|js|css|txt|md|docx?|pdf)$/i.test(text)) {
        names.add(text);
      }
    }
    return Array.from(names);
  });
}

async function collectLatestWtechEval(args) {
  const collector = new WTechCollector();
  const accepted = [];
  const skipped = [];
  let inspected = 0;

  try {
    await collector.init();
    const page = await collector.browser.newPage();
    const ok = await collector.loginAndGoQna(page);
    if (!ok) throw new Error('W-Tech login failed');

    for (let currentPage = 1; currentPage <= args.maxPages && accepted.length < args.limit; currentPage++) {
      if (currentPage > 1) {
        const moved = await collector.navigateToPage(page, currentPage);
        if (!moved) break;
      }

      const rowCount = await collector.getRowCount(page);
      if (rowCount === 0) break;

      for (let rowIdx = 0; rowIdx < rowCount && accepted.length < args.limit; rowIdx++) {
        const rowData = await collector.getRowData(page, rowIdx);
        if (rowData.num === '공지' || !rowData.title) continue;

        const titleMatch = rowData.title.match(/^(.+?)(\d+)$/);
        const cleanTitle = titleMatch ? titleMatch[1].trim() : rowData.title.trim();
        inspected++;

        if (hasLicenseText({ ...rowData, title: cleanTitle })) {
          skipped.push({ num: rowData.num, title: cleanText(cleanTitle), reason: 'license' });
          continue;
        }

        try {
          await page.evaluate((prefix, idx) => {
            document.getElementById(`${prefix}_cell_${idx}_5`).click();
          }, 'mf_wfm_content_qnaList', rowIdx);
          await collector._delay(2500);

          const detail = await collector.getDetailContent(page);
          const attachments = await getDetailAttachments(page);
          const item = {
            num: rowData.num,
            status: rowData.status || detail.status,
            product: rowData.product,
            category: rowData.category,
            title: cleanTitle || detail.title,
            date: rowData.date || detail.regdate,
            views: rowData.views,
            question: detail.question,
            commentCount: detail.commentCount,
            comments: detail.comments,
            attachments,
          };

          if (hasLicenseText(item)) {
            skipped.push({ num: rowData.num, title: cleanText(item.title), reason: 'license_detail' });
          } else if (!hasUsefulComment(item)) {
            skipped.push({ num: rowData.num, title: cleanText(item.title), reason: 'no_useful_comment' });
          } else {
            accepted.push({ ...toEvalItem(item), attachments: attachments.map(cleanText).filter(Boolean) });
            console.log(`[eval:wtech-latest] accepted ${accepted.length}/${args.limit}: ${rowData.num}`);
          }

          await page.evaluate((id) => document.getElementById(id).click(), 'mf_wfm_content_btn_list');
          await collector._delay(2500);
          if (currentPage > 1) await collector.navigateToPage(page, currentPage);
        } catch (err) {
          skipped.push({ num: rowData.num, title: cleanText(cleanTitle), reason: `error: ${err.message}` });
          try {
            await collector.navigateToQnaViaMenu(page);
            if (currentPage > 1) await collector.navigateToPage(page, currentPage);
          } catch (restoreErr) {
            throw new Error(`restore failed after row ${rowData.num}: ${restoreErr.message}`);
          }
        }
      }
    }
  } finally {
    await collector.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'W-Tech latest posts via Puppeteer',
    requestedLimit: args.limit,
    maxPages: args.maxPages,
    inspectedCount: inspected,
    selectedCount: accepted.length,
    skippedCount: skipped.length,
    excludedPolicy: {
      license: 'license, 라이선스, 라이센스, 키 발급, 플러그인 전달 posts are excluded',
      minimumUsefulCommentLength: 20,
    },
    items: accepted,
    skipped,
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function main() {
  const args = parseArgs(process.argv);
  const report = await collectLatestWtechEval(args);
  console.log(JSON.stringify({
    output: path.relative(process.cwd(), args.output).replace(/\\/g, '/'),
    inspectedCount: report.inspectedCount,
    selectedCount: report.selectedCount,
    skippedCount: report.skippedCount,
  }, null, 2));
}

main().catch((err) => {
  console.error(`[eval:wtech-latest] ${err.stack || err.message}`);
  process.exit(1);
});
