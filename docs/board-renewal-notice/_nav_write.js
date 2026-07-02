const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const HOME = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const EMAIL = 'medanbee@gmail.com';
const PW = 'sweetrain00!';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR', '--ignore-certificate-errors'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 1.5 });
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });

    await page.goto(HOME, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(6000);
    await page.click('#mf_wfm_header_btnLogin'); await sleep(4000);
    await page.type('#mf_wfm_content_inputUserId___input', EMAIL, { delay: 25 });
    await page.type('#mf_wfm_content_inputPassWord___input', PW, { delay: 25 });
    await page.click('#mf_wfm_content_btnLogin'); await sleep(7000);

    await page.hover('#mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1').catch(() => {});
    await sleep(1500);
    await page.click('#mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2').catch(() => {});
    await sleep(7000);
    // 문의하기 버튼
    await page.click('#mf_wfm_content_btn_write').catch((e) => console.log('문의하기 click:', e.message));
    await sleep(8000);
    await page.screenshot({ path: dir + '/shot_qna_write.png', fullPage: true });
    console.log('작성폼 본문길이:', await page.evaluate(() => document.body.innerText.length), '| URL:', page.url());
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
