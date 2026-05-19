const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const FAQ_URL = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/faqList.xml';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'wtech', 'faq_data_full.json');
const ORIGINAL_FILE = path.join(__dirname, '..', 'data', 'wtech', 'faq_data.json');
const COOKIE_FILE = path.join(__dirname, 'wtech_cookies.json');

const MAIN_URL = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const EMAIL = '';
const PASSWORD = '';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
}

async function loadCookies(page) {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      await page.setCookie(...cookies);
      return true;
    }
  } catch (e) {}
  return false;
}

async function login(page) {
  await page.goto(MAIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(3000);
  await page.evaluate(() => { document.getElementById('mf_wfm_header_btnLogin')?.click(); });
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
    await page.evaluate(() => { document.getElementById('mf_wfm_content_btnLogin')?.click(); });
    await delay(5000);
    console.log('로그인 완료');
    await saveCookies(page);
  }
}

async function loadFaqPage(page) {
  await page.goto(FAQ_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(4000);
  await page.evaluate(() => {
    const btn = document.getElementById('mf_wfm_content_go_faq');
    if (btn) btn.click();
  });
  await delay(4000);
  return await page.evaluate(() => !!document.getElementById('mf_wfm_content_grd_faq_cell_0_4'));
}

async function getPageItems(page) {
  return await page.evaluate(() => {
    const items = [];
    let idx = 0;
    while (true) {
      const numEl = document.getElementById(`mf_wfm_content_grd_faq_cell_${idx}_0`);
      const titleEl = document.getElementById(`mf_wfm_content_grd_faq_cell_${idx}_4`);
      const productEl = document.getElementById(`mf_wfm_content_grd_faq_cell_${idx}_2`);
      if (!titleEl) break;
      items.push({
        num: numEl?.innerText?.trim() || '',
        title: titleEl?.innerText?.trim() || '',
        product: productEl?.innerText?.trim() || ''
      });
      idx++;
    }
    return items;
  });
}

// 다음 페이지로 이동 (nextPage_btn 클릭)
async function goNextPage(page) {
  const clicked = await page.evaluate(() => {
    const btn = document.getElementById('mf_wfm_content_pgl_nextPage_btn');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (clicked) await delay(3000);
  return clicked;
}

// 특정 페이지 번호로 이동 (FAQ 페이지 새로 로드 후 nextPage 반복)
async function goToPageFromStart(page, targetPage) {
  if (targetPage <= 1) return true;
  for (let i = 1; i < targetPage; i++) {
    const ok = await goNextPage(page);
    if (!ok) return false;
  }
  return true;
}

(async () => {
  const browser = await puppeteer.launch({ headless: false, protocolTimeout: 300000 });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // 쿠키 또는 로그인
  const hasCookies = await loadCookies(page);
  if (!hasCookies) await login(page);

  // 기존 수집 데이터 로드
  let allFaqs = [];
  const collectedNums = new Set();
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      allFaqs = prev;
      prev.forEach(f => collectedNums.add(f.num));
      console.log(`기존 데이터: ${prev.length}건`);
    } catch (e) {}
  }

  const maxPages = 10; // 안전장치

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    console.log(`\n=== Page ${pageNum} ===`);

    // 매번 FAQ 페이지 새로 로드
    const loaded = await loadFaqPage(page);
    if (!loaded) {
      console.log('FAQ 로드 실패. 재로그인...');
      await login(page);
      const retry = await loadFaqPage(page);
      if (!retry) { console.log('접근 실패. 종료.'); break; }
    }

    // 해당 페이지로 이동 (1페이지부터 nextPage 반복)
    if (pageNum > 1) {
      const moved = await goToPageFromStart(page, pageNum);
      if (!moved) {
        console.log(`  페이지 ${pageNum} 이동 불가 → 마지막 페이지 도달`);
        break;
      }
    }

    // 현재 페이지 항목 가져오기
    const items = await getPageItems(page);
    console.log(`  ${items.length}건 발견`);
    if (items.length === 0) break;

    // 첫 행 번호로 이전 페이지와 중복 여부 확인
    const firstNum = items[0]?.num;
    console.log(`  번호 범위: ${items[0]?.num} ~ ${items[items.length-1]?.num}`);

    // 새 항목 필터링
    const newItems = items.filter(it => !collectedNums.has(it.num));
    if (newItems.length === 0) {
      console.log('  전부 수집됨 → 다음 페이지');
      continue;
    }
    console.log(`  신규 ${newItems.length}건 수집 시작`);

    // 각 행 상세 진입
    for (let rowIdx = 0; rowIdx < items.length; rowIdx++) {
      const item = items[rowIdx];
      if (collectedNums.has(item.num)) continue;

      console.log(`  [${item.num}] ${item.title.substring(0, 50)}`);

      try {
        // 상세 진입
        const titleCell = await page.$(`#mf_wfm_content_grd_faq_cell_${rowIdx}_4`);
        if (!titleCell) continue;
        await titleCell.click();
        await delay(4000);

        const answer = await page.evaluate(() => {
          const el = document.getElementById('mf_wfm_content_txtContent');
          return el ? el.innerText?.trim() : '';
        });

        const preview = answer ? answer.substring(0, 50) + '...' : '(답변 없음)';
        console.log(`    → ${preview}`);

        allFaqs.push({ num: item.num, product: item.product, title: item.title, answer: answer });
        collectedNums.add(item.num);
      } catch (err) {
        console.log(`    → [ERROR] ${err.message.substring(0, 60)} — 스킵`);
        allFaqs.push({ num: item.num, product: item.product, title: item.title, answer: '' });
        collectedNums.add(item.num);
      }

      // 목록 복귀 (FAQ 페이지 새로 로드)
      try {
        const loaded = await loadFaqPage(page);
        if (!loaded) {
          await login(page);
          await loadFaqPage(page);
        }
      } catch (err) {
        await loadFaqPage(page);
      }

      // 원래 페이지로 이동
      if (pageNum > 1) {
        await goToPageFromStart(page, pageNum);
      }
    }
  }

  // 결과 저장
  // 중복 제거 (답변 있는 것 우선)
  const seen = {};
  for (const d of allFaqs) {
    if (!seen[d.num] || (d.answer && !seen[d.num].answer)) {
      seen[d.num] = d;
    }
  }
  const result = Object.values(seen).sort((a, b) => parseInt(b.num) - parseInt(a.num));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n=== 완료 ===`);
  console.log(`총: ${result.length}건 (답변 있음: ${result.filter(d=>d.answer).length}건)`);
  console.log(`저장: ${OUTPUT_FILE}`);

  // 기존 파일 업데이트
  const backupFile = ORIGINAL_FILE.replace('.json', '_backup.json');
  if (fs.existsSync(ORIGINAL_FILE)) {
    fs.copyFileSync(ORIGINAL_FILE, backupFile);
  }
  fs.writeFileSync(ORIGINAL_FILE, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`업데이트: ${ORIGINAL_FILE}`);

  await saveCookies(page);
  await browser.close();
})();
