const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGIN = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/member/mbLogin.xml';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR', '--ignore-certificate-errors'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 980 });
    await page.goto(LOGIN, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(7000);
    await page.screenshot({ path: 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice/shot_login.png', fullPage: true });
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, button, a')).slice(0, 60).map((el) => ({
        tag: el.tagName, type: el.type || '', id: el.id || '', name: el.name || '',
        ph: el.placeholder || '', txt: (el.innerText || el.value || '').trim().slice(0, 20),
        vis: !!(el.offsetParent),
      })).filter((e) => e.vis && (e.tag === 'INPUT' || e.txt))
    );
    console.log(JSON.stringify(inputs, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
