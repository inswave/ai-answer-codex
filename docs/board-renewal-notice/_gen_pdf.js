// HTML → PDF 변환 (Puppeteer). 공지 HTML 을 A4 PDF 로 출력한다.
const path = require('path');
const puppeteer = require('puppeteer');

const dir = __dirname;
const htmlPath = path.join(dir, '기술지원게시판_리뉴얼_공지.html');
const pdfPath = path.join(dir, '기술지원게시판_리뉴얼_공지.pdf');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#9aa3b0;text-align:center;padding:0 10mm;">' +
        '인스웨이브 기술지원팀 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    console.log('PDF 생성 완료:', pdfPath);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('PDF 생성 실패:', e.message); process.exit(1); });
