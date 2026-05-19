const puppeteer = require('puppeteer');
const path = require('path');

const MAIN_URL = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const QNA_URL = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/qnaList.xml';
const EMAIL = '';
const PASSWORD = '';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({ headless: false, defaultViewport: { width: 1400, height: 900 } });
  const page = await browser.newPage();

  // 메인 페이지 접속
  await page.goto(MAIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(3000);

  // 로그인
  console.log('로그인 시도...');
  const loginBtn = await page.$('#mf_wfm_header_btnLogin');
  if (loginBtn) {
    // evaluate로 클릭
    await page.evaluate(() => {
      document.getElementById('mf_wfm_header_btnLogin').click();
    });
    await delay(3000);

    const emailInput = await page.$('#mf_wfm_content_inputUserId___input');
    const pwInput = await page.$('#mf_wfm_content_inputPassWord___input');
    if (emailInput && pwInput) {
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(EMAIL, { delay: 30 });
      await delay(300);
      await pwInput.click({ clickCount: 3 });
      await pwInput.type(PASSWORD, { delay: 30 });
      await delay(300);
      await page.evaluate(() => {
        document.getElementById('mf_wfm_content_btnLogin').click();
      });
      await delay(5000);
    }
  }
  console.log('로그인 후 URL:', page.url());

  // 방법1: evaluate로 메뉴 클릭 (dispatchEvent)
  console.log('\n=== 방법1: JS evaluate 메뉴 클릭 ===');
  try {
    // 먼저 질의응답 메뉴에 mouse over
    await page.evaluate(() => {
      const menu = document.getElementById('mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1');
      if (menu) {
        menu.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        menu.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      }
    });
    await delay(1000);

    // 기술문의 서브메뉴 클릭
    await page.evaluate(() => {
      const subMenu = document.getElementById('mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2');
      if (subMenu) {
        subMenu.click();
      }
    });
    await delay(5000);
    console.log('URL:', page.url());
  } catch (e) {
    console.log('방법1 에러:', e.message);
  }

  // 그리드 확인
  let cells = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('[id*="_cell_0_"]').forEach(el => {
      result.push({ id: el.id, text: el.innerText?.trim()?.substring(0, 100) });
    });
    return result;
  });
  console.log(`\n_cell_0_ 패턴: ${cells.length}개`);
  cells.forEach(c => console.log(`  ${c.id}: ${c.text}`));

  let pgl = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('[id*="pgl"]').forEach(el => {
      result.push({ id: el.id, text: el.innerText?.trim()?.substring(0, 30) });
    });
    return result;
  });
  console.log(`\n페이지네이션: ${pgl.length}개`);
  pgl.forEach(p => console.log(`  ${p.id}: ${p.text}`));

  // 방법2: WebSquare SPA 라우팅 함수 탐색
  console.log('\n=== 방법2: WebSquare 내부 네비게이션 ===');
  const wsInfo = await page.evaluate(() => {
    const result = {};
    // WebSquare 전역 객체 확인
    if (typeof WebSquare !== 'undefined') {
      result.hasWebSquare = true;
      result.version = WebSquare.version || 'unknown';
      // 네비게이션 관련 함수 탐색
      if (WebSquare.net) result.hasNet = true;
      if (WebSquare.uiplugin) result.hasUiplugin = true;
    }
    // $w 전역 객체 확인
    if (typeof $w !== 'undefined') {
      result.has$w = true;
    }
    // gcm 전역 객체
    if (typeof gcm !== 'undefined') {
      result.hasGcm = true;
      result.gcmKeys = Object.keys(gcm).slice(0, 20);
    }
    // scwin 전역 객체
    if (typeof scwin !== 'undefined') {
      result.hasScwin = true;
    }
    return result;
  });
  console.log('WebSquare 정보:', JSON.stringify(wsInfo));

  // gcm에 네비게이션 함수가 있는지
  if (wsInfo.hasGcm) {
    const gcmFuncs = await page.evaluate(() => {
      const funcs = [];
      for (const key of Object.keys(gcm)) {
        if (typeof gcm[key] === 'function') {
          funcs.push(key);
        }
      }
      return funcs;
    });
    console.log('gcm 함수들:', gcmFuncs.join(', '));
  }

  // 방법3: 직접 WebSquare 네비게이션 호출
  console.log('\n=== 방법3: wfm_content goPage 시도 ===');
  try {
    await page.evaluate(() => {
      // WebSquare WFrame의 내부 네비게이션
      const wfmContent = WebSquare.getComponentById('mf_wfm_content');
      if (wfmContent) {
        wfmContent.setSrc('/ui/qna/qnaList.xml');
      }
    });
    await delay(5000);
  } catch (e) {
    console.log('방법3 에러:', e.message);
  }

  cells = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('[id*="_cell_0_"]').forEach(el => {
      result.push({ id: el.id, text: el.innerText?.trim()?.substring(0, 100) });
    });
    return result;
  });
  console.log(`\n_cell_0_ 패턴: ${cells.length}개`);
  cells.forEach(c => console.log(`  ${c.id}: ${c.text}`));

  pgl = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('[id*="pgl"]').forEach(el => {
      result.push({ id: el.id, text: el.innerText?.trim()?.substring(0, 30) });
    });
    return result;
  });
  console.log(`\n페이지네이션: ${pgl.length}개`);
  pgl.forEach(p => console.log(`  ${p.id}: ${p.text}`));

  await page.screenshot({ path: path.join(__dirname, 'qna_debug2.png'), fullPage: true });
  await delay(30000);
  await browser.close();
})();
