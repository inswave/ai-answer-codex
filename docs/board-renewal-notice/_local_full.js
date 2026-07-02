const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const HOME = 'http://localhost:8080/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const EMAIL = 'medanbee@gmail.com';
const PW = 'sweetrain00!';

async function shotContent(page, name) {
  // 전역 헤더/ GPT 프로모 띠 제외하고 본문 프레임만 클립 캡처
  const el = await page.$('#mf_wfm_content');
  const out = dir + '/' + name + '.png';
  if (el) {
    await el.screenshot({ path: out });
  } else {
    await page.screenshot({ path: out, fullPage: true });
  }
  console.log(name, '저장 | content요소:', !!el, '| URL:', page.url());
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });

    await page.goto(HOME, { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(6000);
    // 로그인
    await page.click('#mf_wfm_header_btnLogin').catch(() => {});
    await sleep(4000);
    await page.type('#mf_wfm_content_inputUserId___input', EMAIL, { delay: 20 }).catch(() => {});
    await page.type('#mf_wfm_content_inputPassWord___input', PW, { delay: 20 }).catch(() => {});
    await page.click('#mf_wfm_content_btnLogin').catch(() => {});
    await sleep(7000);
    const loggedIn = await page.evaluate(() => { const b = document.querySelector('#mf_wfm_header_btnLogin'); return !b || !b.offsetParent; });
    console.log('로그인 성공:', loggedIn);

    // 질의응답 → 기술문의
    await page.hover('#mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1').catch(() => {});
    await sleep(1500);
    await page.click('#mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2').catch(() => {});
    await sleep(8000);
    await shotContent(page, 'local_list');

    // AI 답변 게시글 열기
    const opened = await page.evaluate(() => {
      const e = [...document.querySelectorAll('a,td,span,div')].find((x) => x.offsetParent && /TabControl|접근성|문의/.test(x.innerText || '') && (x.innerText || '').trim().length < 40);
      if (e) { e.click(); return (e.innerText || '').trim().slice(0, 30); } return null;
    });
    console.log('게시글 클릭:', opened);
    await sleep(9000);
    await shotContent(page, 'local_view');

    // 문의 작성(AI) — 목록으로 돌아가 문의하기
    await page.hover('#mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1').catch(() => {});
    await sleep(1200);
    await page.click('#mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2').catch(() => {});
    await sleep(7000);
    await page.click('#mf_wfm_content_btn_write').catch((e) => console.log('문의하기:', e.message));
    await sleep(8000);
    await shotContent(page, 'local_write');
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
