const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    // 'AI 답변' 텍스트/뱃지 또는 ai- 클래스 가진 카드 후보 덤프
    const cands = await page.evaluate(() => {
      const res = [];
      document.querySelectorAll('div,section,li,table').forEach((el) => {
        const r = el.getBoundingClientRect();
        const cls = (el.className && el.className.toString) ? el.className.toString() : '';
        const txt = (el.innerText || '').trim();
        const isAi = /ai[-_]?answer|aiAnswer|ai-thread|답변/i.test(cls) || /^AI\b|AI 답변|AI답변/.test(txt.slice(0, 12));
        if (isAi && r.width > 400 && r.height > 120 && r.height < 1400) {
          res.push({ tag: el.tagName, id: el.id || '', cls: cls.slice(0, 40), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + window.scrollY), txt: txt.slice(0, 24) });
        }
      });
      return res.sort((a, b) => a.top - b.top).slice(0, 20);
    });
    console.log(JSON.stringify(cands, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
