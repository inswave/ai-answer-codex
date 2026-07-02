const path = require('path');
const puppeteer = require('puppeteer');

const dir = __dirname;
const htmlPath = path.join(dir, 'ai-answer-system-architecture.html');
const pdfPath = path.join(dir, 'ai-answer-system-architecture.pdf');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), {
      waitUntil: 'networkidle0',
    });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '12mm',
        bottom: '12mm',
        left: '12mm',
        right: '12mm',
      },
    });
    console.log(pdfPath);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
