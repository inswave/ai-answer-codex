const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR', '--ignore-certificate-errors'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 980 });
    await page.goto(HOME, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(6000);
    // LOGIN 버튼 클릭
    await page.click('#mf_wfm_header_btnLogin').catch((e) => console.log('click err:', e.message));
    await sleep(6000);
    await page.screenshot({ path: dir + '/shot_login_form.png', fullPage: true });
    const fields = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input')).map((el) => ({
        type: el.type || '', id: el.id || '', ph: el.placeholder || '', vis: !!el.offsetParent,
      })).filter((e) => e.vis && (e.type === 'text' || e.type === 'password' || e.type === 'email'))
    );
    console.log('LOGIN_FIELDS=' + JSON.stringify(fields));
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, input[type=button], a')).map((el) => ({
        id: el.id || '', txt: (el.innerText || el.value || '').trim().slice(0, 12), vis: !!el.offsetParent,
      })).filter((e) => e.vis && /로그인|login|확인/i.test(e.txt))
    );
    console.log('LOGIN_BTNS=' + JSON.stringify(btns));
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
