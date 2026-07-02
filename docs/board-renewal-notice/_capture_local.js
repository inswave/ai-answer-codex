// 로컬 인스턴스에서 내부 페이지 직접 렌더 시도 (index 프레임 없이 w2xPath 로 페이지 직접).
const path = require('path');
const puppeteer = require('puppeteer');

const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const candidates = [
  { name: 'local_write_direct', url: 'http://localhost:8080/websquare/websquare.html?w2xPath=/ui/qna/qnaWriteAI.xml' },
  { name: 'local_list_direct',  url: 'http://localhost:8080/websquare/websquare.html?w2xPath=/ui/qna/qnaList_test.xml' },
  { name: 'local_write_inpath', url: 'http://localhost:8080/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/qnaWriteAI.xml' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR', '--ignore-certificate-errors'] });
  try {
    for (const c of candidates) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 980, deviceScaleFactor: 1.5 });
      try { await page.goto(c.url, { waitUntil: 'networkidle2', timeout: 45000 }); }
      catch (e) { console.log('[' + c.name + '] goto 경고:', e.message); }
      await sleep(7000);
      const out = path.join(dir, c.name + '.png');
      await page.screenshot({ path: out, fullPage: true });
      const bodyLen = await page.evaluate(() => document.body ? document.body.innerText.length : 0);
      console.log(c.name, '| URL:', page.url(), '| 본문길이:', bodyLen);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
