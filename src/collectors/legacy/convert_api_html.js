const fs = require('fs');
const path = require('path');

const HTML_DIR = 'C:/Users/user/Desktop/html';
const OUTPUT_FILE = 'C:/inswave/faq_자동답변/data/api/ws5_api_guide.json';

// HTML entity decoding
function decodeEntities(text) {
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&#160;': ' ',
    '&ndash;': '-', '&mdash;': '--', '&laquo;': '<<', '&raquo;': '>>',
    '&bull;': '*', '&middot;': '*', '&hellip;': '...',
    '&copy;': '(c)', '&reg;': '(R)', '&trade;': '(TM)',
  };
  // Named/numeric entities
  let result = text.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  for (const [entity, char] of Object.entries(entities)) {
    result = result.split(entity).join(char);
  }
  return result;
}

// Extract text from HTML
function extractText(html) {
  let text = html;
  // Remove script and style tags with content
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Replace br/p/div/li/tr/h tags with newlines for readability
  text = text.replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n');
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode entities
  text = decodeEntities(text);
  // Normalize whitespace: collapse spaces on each line, then collapse blank lines
  text = text.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function main() {
  const folders = fs.readdirSync(HTML_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  console.log(`Found ${folders.length} folders`);

  const results = [];

  for (const folder of folders) {
    const folderPath = path.join(HTML_DIR, folder);
    const htmlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.html'));

    if (htmlFiles.length === 0) {
      console.warn(`No HTML file in: ${folder}`);
      continue;
    }

    const htmlFile = htmlFiles[0];
    const filePath = path.join(folderPath, htmlFile);
    const htmlContent = fs.readFileSync(filePath, 'utf-8');
    const content = extractText(htmlContent);
    const component = folder;
    const title = `WebSquare API Guide - ${component}`;

    results.push({ component, title, content, htmlContent });
  }

  console.log(`Processed ${results.length} components`);

  // Ensure output directory exists
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Written to: ${OUTPUT_FILE}`);

  // Stats
  const stats = fs.statSync(OUTPUT_FILE);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`File size: ${sizeMB} MB (${stats.size.toLocaleString()} bytes)`);
  console.log(`Total entries: ${results.length}`);

  // Check gridView addRow
  const gv = results.find(r => r.component === 'WebSquare.uiplugin.gridView');
  if (gv) {
    const hasAddRow = gv.content.includes('addRow');
    console.log(`gridView entry found. Contains 'addRow': ${hasAddRow}`);
    if (hasAddRow) {
      const idx = gv.content.indexOf('addRow');
      console.log(`Sample around addRow: ...${gv.content.substring(idx - 50, idx + 100)}...`);
    }
  } else {
    console.log('gridView entry NOT found!');
  }

  // Delete old files
  const oldFiles = [
    'C:/inswave/faq_자동답변/data/api/ws5_ai_api_data.json',
    'C:/inswave/faq_자동답변/data/api/ws5_sp5_api_data.json',
    'C:/inswave/faq_자동답변/data/api/ws5_sp4_api_data.json',
  ];
  for (const f of oldFiles) {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      console.log(`Deleted: ${f}`);
    } else {
      console.log(`Not found (skip): ${f}`);
    }
  }

  console.log('Done.');
}

main();
