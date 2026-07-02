const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const URL = 'http://localhost:8080/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/qnaList.xml';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(8000);
    await page.screenshot({ path: dir + '/test_local_list.png', fullPage: true });
    const info = await page.evaluate(() => ({
      bodyLen: document.body.innerText.length,
      hasLogin: !!(document.querySelector('#mf_wfm_header_btnLogin') && document.querySelector('#mf_wfm_header_btnLogin').offsetParent),
      hasWriteBtn: !!document.querySelector('#mf_wfm_content_btn_write'),
      hasQnaList: !!document.querySelector('#mf_wfm_content_qnaList'),
      title: document.title,
      head: (document.body.innerText || '').replace(/\s+/g,' ').slice(0, 160),
    }));
    console.log(JSON.stringify(info, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
