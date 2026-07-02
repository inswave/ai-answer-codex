const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const HOME = 'http://localhost:8080/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const EMAIL = 'medanbee@gmail.com';
const PW = 'sweetrain00!';
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });
    await page.goto(HOME, { waitUntil: 'networkidle2', timeout: 45000 }); await sleep(6000);
    await page.click('#mf_wfm_header_btnLogin').catch(()=>{}); await sleep(4000);
    await page.type('#mf_wfm_content_inputUserId___input', EMAIL, { delay: 20 });
    await page.type('#mf_wfm_content_inputPassWord___input', PW, { delay: 20 });
    await page.click('#mf_wfm_content_btnLogin').catch(()=>{}); await sleep(7000);
    await page.hover('#mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1').catch(()=>{}); await sleep(1500);
    await page.click('#mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2').catch(()=>{}); await sleep(7000);
    await page.evaluate(() => { const e=[...document.querySelectorAll('a,td,span,div')].find(x=>x.offsetParent&&/TabControl/.test(x.innerText||'')&&(x.innerText||'').length<40); if(e)e.click(); });
    await sleep(9000);
    // 첫 AI 답변 = .ai-answer-body (재답변 ai-thread-item 아님)
    const handle = await page.evaluateHandle(() => document.querySelector('.ai-answer-body') || null);
    const el = handle.asElement();
    if (el) {
      await el.scrollIntoView(); await sleep(800);
      await el.screenshot({ path: dir + '/first_ai_answer.png' });
      const box = await el.boundingBox();
      console.log('첫 답변 크롭 완료 |', box && (Math.round(box.width)+'x'+Math.round(box.height)));
    } else console.log('ai-answer-body 못 찾음');
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
