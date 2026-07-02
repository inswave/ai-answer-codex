const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const EMAIL = 'medanbee@gmail.com';
const PW = 'sweetrain00!';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR', '--ignore-certificate-errors'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });
    await page.goto(HOME, { waitUntil: 'networkidle2', timeout: 60000 }); await sleep(6000);
    await page.click('#mf_wfm_header_btnLogin'); await sleep(4000);
    await page.type('#mf_wfm_content_inputUserId___input', EMAIL, { delay: 20 });
    await page.type('#mf_wfm_content_inputPassWord___input', PW, { delay: 20 });
    await page.click('#mf_wfm_content_btnLogin'); await sleep(7000);
    await page.hover('#mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1').catch(()=>{}); await sleep(1500);
    await page.click('#mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2').catch(()=>{}); await sleep(7000);
    // 게시글 열기
    await page.evaluate(() => { const e=[...document.querySelectorAll('a,td,span,div')].find(x=>x.offsetParent&&/TabControl/.test(x.innerText||'')&&(x.innerText||'').length<40); if(e)e.click(); });
    await sleep(9000);
    // 큰 블록 + AI 관련 요소 덤프
    const info = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const id = el.id;
        if (r.width > 300 && r.height > 80 && (/ai|answer|sources|grpAi|aiAnswer|content|thread|comment/i.test(id))) {
          out.push({ id, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + window.scrollY), txt: (el.innerText||'').trim().slice(0,30) });
        }
      });
      return out.slice(0, 40);
    });
    console.log(JSON.stringify(info, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
