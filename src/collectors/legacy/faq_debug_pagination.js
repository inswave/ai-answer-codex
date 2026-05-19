const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const FAQ_URL = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/faqList.xml';
const COOKIE_FILE = path.join(__dirname, 'wtech_cookies.json');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await puppeteer.launch({ headless: false, protocolTimeout: 60000 });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // 쿠키 로드
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    await page.setCookie(...cookies);
  }

  await page.goto(FAQ_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(4000);

  // go_faq 버튼 클릭
  await page.evaluate(() => {
    const btn = document.getElementById('mf_wfm_content_go_faq');
    if (btn) btn.click();
  });
  await delay(4000);

  // 현재 페이지네이션 구조 분석
  console.log('=== 1~5페이지 그룹 ===');
  const pageInfo1 = await page.evaluate(() => {
    const info = { buttons: [], nextBtn: null, prevBtn: null };
    // 페이지 버튼 탐색 (1~20까지)
    for (let i = 1; i <= 20; i++) {
      const btn = document.getElementById(`mf_wfm_content_pgl_page_${i}`);
      if (btn) {
        info.buttons.push({ id: `page_${i}`, text: btn.innerText?.trim(), visible: btn.offsetParent !== null });
      }
    }
    // next/prev 버튼
    const next = document.getElementById('mf_wfm_content_pgl_next_btn');
    if (next) info.nextBtn = { text: next.innerText?.trim(), visible: next.offsetParent !== null };
    const prev = document.getElementById('mf_wfm_content_pgl_prev_btn');
    if (prev) info.prevBtn = { text: prev.innerText?.trim(), visible: prev.offsetParent !== null };

    // pageList 영역의 전체 HTML도 확인
    const pgl = document.querySelector('[id*="pgl"]');

    // 모든 pgl 관련 요소 탐색
    const allPgl = [];
    document.querySelectorAll('[id*="mf_wfm_content_pgl"]').forEach(el => {
      allPgl.push({ id: el.id, tag: el.tagName, text: el.innerText?.trim().substring(0, 30), visible: el.offsetParent !== null });
    });
    info.allPglElements = allPgl;

    return info;
  });
  console.log(JSON.stringify(pageInfo1, null, 2));

  // next 버튼 클릭
  console.log('\n=== next 버튼 클릭 후 ===');
  const nextClicked = await page.evaluate(() => {
    const next = document.getElementById('mf_wfm_content_pgl_next_btn');
    if (next) { next.click(); return true; }
    // 다른 가능한 next 버튼
    const allBtns = document.querySelectorAll('[id*="pgl"][id*="next"]');
    if (allBtns.length > 0) { allBtns[0].click(); return true; }
    return false;
  });
  console.log('next 클릭:', nextClicked);
  await delay(3000);

  const pageInfo2 = await page.evaluate(() => {
    const info = { buttons: [] };
    for (let i = 1; i <= 20; i++) {
      const btn = document.getElementById(`mf_wfm_content_pgl_page_${i}`);
      if (btn && btn.offsetParent !== null) {
        info.buttons.push({ id: `page_${i}`, text: btn.innerText?.trim() });
      }
    }
    // 현재 그리드 첫 행 번호 확인
    const firstNum = document.getElementById('mf_wfm_content_grd_faq_cell_0_0')?.innerText?.trim();
    info.firstRowNum = firstNum;

    const allPgl = [];
    document.querySelectorAll('[id*="mf_wfm_content_pgl"]').forEach(el => {
      if (el.offsetParent !== null) {
        allPgl.push({ id: el.id, text: el.innerText?.trim().substring(0, 30) });
      }
    });
    info.visiblePglElements = allPgl;

    return info;
  });
  console.log(JSON.stringify(pageInfo2, null, 2));

  // 그리드 데이터도 확인
  const rows = await page.evaluate(() => {
    const items = [];
    let idx = 0;
    while (true) {
      const numEl = document.getElementById(`mf_wfm_content_grd_faq_cell_${idx}_0`);
      if (!numEl) break;
      items.push(numEl.innerText?.trim());
      idx++;
    }
    return items;
  });
  console.log('현재 페이지 행 번호:', rows);

  await browser.close();
})();
