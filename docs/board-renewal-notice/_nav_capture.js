const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const HOME = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const EMAIL = 'medanbee@gmail.com';
const PW = 'sweetrain00!';

async function dumpClickables(page, re) {
  return page.evaluate((reStr) => {
    const r = new RegExp(reStr, 'i');
    return Array.from(document.querySelectorAll('button, a, input[type=button], span, li')).map((el) => ({
      tag: el.tagName, id: el.id || '', txt: (el.innerText || el.value || '').trim().slice(0, 24), vis: !!el.offsetParent,
    })).filter((e) => e.vis && e.txt && r.test(e.txt));
  }, re);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR', '--ignore-certificate-errors'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 980, deviceScaleFactor: 1.5 });
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });

    await page.goto(HOME, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(6000);
    await page.click('#mf_wfm_header_btnLogin');
    await sleep(4000);
    await page.type('#mf_wfm_content_inputUserId___input', EMAIL, { delay: 25 });
    await page.type('#mf_wfm_content_inputPassWord___input', PW, { delay: 25 });
    await page.click('#mf_wfm_content_btnLogin');
    await sleep(7000);

    // 질의응답 메뉴 클릭
    await page.click('#mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1').catch((e) => console.log('menu click:', e.message));
    await sleep(8000);
    await page.screenshot({ path: dir + '/shot_qna_list.png', fullPage: true });
    console.log('질의응답 클릭 후 본문길이:', await page.evaluate(() => document.body.innerText.length));
    console.log('NAV_LINKS=' + JSON.stringify(await dumpClickables(page, '질의응답|문의|공지|QNA|기술문의|목록|글쓰기|작성')));
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
