const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const HOME = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const EMAIL = 'medanbee@gmail.com';
const PW = 'sweetrain00!';

async function clickByText(page, re) {
  return page.evaluate((reStr) => {
    const r = new RegExp(reStr, 'i');
    const els = Array.from(document.querySelectorAll('a, button, td, span, div'));
    const el = els.find((e) => e.offsetParent && r.test((e.innerText || '').trim()) && (e.innerText || '').trim().length < 40);
    if (el) { el.click(); return (el.innerText || '').trim().slice(0, 30); }
    return null;
  }, re);
}
async function dump(page, re) {
  return page.evaluate((reStr) => {
    const r = new RegExp(reStr, 'i');
    return Array.from(document.querySelectorAll('button, a, input[type=button], td')).map((el) => ({
      id: el.id || '', txt: (el.innerText || el.value || '').trim().slice(0, 26), vis: !!el.offsetParent,
    })).filter((e) => e.vis && e.txt && r.test(e.txt));
  }, re);
}

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

    // 질의응답 → 기술문의 서브메뉴
    await page.hover('#mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1').catch(() => {});
    await sleep(1500);
    await page.click('#mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2').catch((e) => console.log('기술문의 click:', e.message));
    await sleep(8000);
    await page.screenshot({ path: dir + '/shot_qna_list.png', fullPage: true });
    console.log('리스트 본문길이:', await page.evaluate(() => document.body.innerText.length));
    console.log('LIST_BTNS=' + JSON.stringify(await dump(page, '문의하기|글쓰기|작성|등록|공지')));

    // 게시글(TabControl) 열기 → AI 답변 보기
    const clicked = await clickByText(page, 'TabControl');
    console.log('게시글 클릭:', clicked);
    await sleep(9000);
    await page.screenshot({ path: dir + '/shot_qna_view.png', fullPage: true });
    console.log('상세 본문길이:', await page.evaluate(() => document.body.innerText.length));
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
