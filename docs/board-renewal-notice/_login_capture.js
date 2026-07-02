const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const HOME = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const IN = (p) => 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=' + p;

const EMAIL = 'medanbee@gmail.com';
const PW = 'sweetrain00!';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--lang=ko-KR', '--ignore-certificate-errors'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 980, deviceScaleFactor: 1.5 });
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });

    // 1) 홈 → LOGIN 클릭 → 폼 입력 → 로그인
    await page.goto(HOME, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(6000);
    await page.click('#mf_wfm_header_btnLogin');
    await sleep(4000);
    await page.type('#mf_wfm_content_inputUserId___input', EMAIL, { delay: 30 });
    await page.type('#mf_wfm_content_inputPassWord___input', PW, { delay: 30 });
    await sleep(500);
    await page.click('#mf_wfm_content_btnLogin');
    await sleep(7000);
    const loggedIn = await page.evaluate(() => !document.querySelector('#mf_wfm_header_btnLogin') || !document.querySelector('#mf_wfm_header_btnLogin').offsetParent);
    console.log('로그인 후 LOGIN버튼 사라짐:', loggedIn, '| URL:', page.url());
    await page.screenshot({ path: dir + '/shot_after_login.png', fullPage: true });

    // 2) QNA 리스트
    await page.goto(IN('/ui/qna/qnaList.xml'), { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(8000);
    await page.screenshot({ path: dir + '/shot_qna_list.png', fullPage: true });
    console.log('리스트 캡처 완료 | 본문길이:', await page.evaluate(() => document.body.innerText.length));

    // 3) 문의 작성(AI)
    await page.goto(IN('/ui/qna/qnaWriteAI.xml'), { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(8000);
    await page.screenshot({ path: dir + '/shot_qna_write.png', fullPage: true });
    console.log('작성 캡처 완료 | 본문길이:', await page.evaluate(() => document.body.innerText.length));
  } finally { await browser.close(); }
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
