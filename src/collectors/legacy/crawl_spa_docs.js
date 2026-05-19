/**
 * WebSquare SPA 기반 문서 크롤링 스크립트
 * - WS5 SP5 API 문서
 * - WS5 SP4 API 문서
 * - AI 릴리즈 노트
 * - SP5 릴리즈 노트
 *
 * 사용법: node crawl_spa_docs.js
 */
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const COOKIE_FILE = path.join(__dirname, "confluence_cookies.json");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 1. API 문서 크롤링 (SP4, SP5) — WebSquare SPA
// ============================================================
async function crawlApiDocs(page, url, label) {
  console.log(`\n=== [${label}] API 문서 크롤링 시작 ===`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(5000);

  // 왼쪽 트리 메뉴에서 모든 항목 가져오기
  const menuItems = await page.evaluate(() => {
    const items = [];
    // WebSquare 트리 메뉴 항목 찾기
    const links = document.querySelectorAll(
      'a[href], [class*="tree"] [class*="item"], [class*="menu"] [class*="item"]'
    );
    links.forEach((el) => {
      const text = (el.textContent || "").trim();
      const href = el.getAttribute("href") || "";
      if (text && text.length < 200) {
        items.push({ text, href });
      }
    });
    return items;
  });
  console.log(`  메뉴 항목 ${menuItems.length}개 발견`);

  // 페이지 전체 콘텐츠 가져오기
  const content = await page.evaluate(() => {
    return document.body.innerText || "";
  });
  const html = await page.content();

  return {
    source: label,
    title: label,
    menuItems: menuItems,
    content: content,
    htmlContent: html,
    url: url,
  };
}

// ============================================================
// 2. 릴리즈 노트 크롤링 — SPA with 트리 구조
// ============================================================
async function crawlReleaseNotes(page, url, label) {
  console.log(`\n=== [${label}] 릴리즈 노트 크롤링 시작 ===`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(5000);

  // 사이드바 트리에서 모든 항목 클릭하면서 수집
  const allData = [];

  // 1단계: 사이드바의 트리 항목 목록 수집
  const treeItems = await page.evaluate(() => {
    const items = [];
    const els = document.querySelectorAll(
      '[class*="tree-item"], [class*="sidebar"] a, [class*="sidebar"] [class*="item"], [class*="menu"] li'
    );
    els.forEach((el, idx) => {
      const text = (el.textContent || "").trim();
      if (text && text.length < 300) {
        items.push({ text: text.substring(0, 200), index: idx });
      }
    });
    return items;
  });
  console.log(`  트리 항목 ${treeItems.length}개 발견`);

  // 2단계: 각 트리 항목 클릭 → 본문 수집
  // 먼저 클릭 가능한 요소 찾기
  const clickableItems = await page.evaluate(() => {
    const items = [];
    const els = document.querySelectorAll(
      '[class*="tree-item"] > [class*="title"], [class*="tree-item"] > span, [class*="sidebar"] a'
    );
    els.forEach((el, idx) => {
      const text = (el.textContent || "").trim();
      if (text && text.length > 0 && text.length < 200) {
        items.push({ text, idx });
      }
    });
    return items;
  });
  console.log(`  클릭 가능 항목 ${clickableItems.length}개`);

  if (clickableItems.length === 0) {
    // 클릭 가능 항목이 없으면 전체 페이지 긁기
    const content = await page.evaluate(() => document.body.innerText || "");
    const html = await page.content();
    allData.push({
      source: label,
      title: label,
      content: content,
      htmlContent: html,
      url: url,
    });
  } else {
    for (let i = 0; i < clickableItems.length; i++) {
      const item = clickableItems[i];
      console.log(
        `  [${i + 1}/${clickableItems.length}] "${item.text}" 클릭 중...`
      );
      try {
        // 해당 항목 클릭
        await page.evaluate((idx) => {
          const els = document.querySelectorAll(
            '[class*="tree-item"] > [class*="title"], [class*="tree-item"] > span, [class*="sidebar"] a'
          );
          if (els[idx]) els[idx].click();
        }, item.idx);
        await delay(2000);

        // 본문 내용 수집
        const content = await page.evaluate(() => {
          const viewer =
            document.querySelector('[class*="viewer"]') ||
            document.querySelector('[class*="content"]') ||
            document.querySelector("main") ||
            document.body;
          return viewer.innerText || "";
        });

        allData.push({
          source: label,
          title: item.text,
          content: content.trim(),
          url: url + "#" + encodeURIComponent(item.text),
        });
      } catch (err) {
        console.log(`    에러: ${err.message}`);
      }
    }
  }

  return allData;
}

// ============================================================
// 메인
// ============================================================
(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // 쿠키 로드 (필요시)
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
    await page.setCookie(...cookies);
  }

  const results = {};

  // --- SP5 API ---
  try {
    const sp5Api = await crawlApiDocs(
      page,
      "https://docs.inswave.com/websquare/websquare.html?w2xPath=/support/api/ws5_sp5/api.xml",
      "ws5_sp5_api"
    );
    results.sp5Api = sp5Api;
    console.log(`  [ws5_sp5_api] 콘텐츠 길이: ${sp5Api.content.length}`);
  } catch (err) {
    console.log(`  SP5 API 에러: ${err.message}`);
  }

  // --- SP4 API ---
  try {
    const sp4Api = await crawlApiDocs(
      page,
      "https://docs.inswave.com/websquare/websquare.html?w2xPath=/support/api/ws5_sp4/api.xml",
      "ws5_sp4_api"
    );
    results.sp4Api = sp4Api;
    console.log(`  [ws5_sp4_api] 콘텐츠 길이: ${sp4Api.content.length}`);
  } catch (err) {
    console.log(`  SP4 API 에러: ${err.message}`);
  }

  // API 문서 저장
  const apiOutDir = path.join(__dirname, "..", "data", "api");
  fs.writeFileSync(
    path.join(apiOutDir, "ws5_sp5_api_data.json"),
    JSON.stringify(results.sp5Api || {}, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(apiOutDir, "ws5_sp4_api_data.json"),
    JSON.stringify(results.sp4Api || {}, null, 2),
    "utf-8"
  );
  console.log("\nAPI 문서 저장 완료!");

  // --- AI 릴리즈 노트 ---
  try {
    const aiNotes = await crawlReleaseNotes(
      page,
      "https://docs1.inswave.com/ai_release_note",
      "ai_release_note"
    );
    const rnOutDir = path.join(__dirname, "..", "data", "release_notes");
    fs.writeFileSync(
      path.join(rnOutDir, "ai_release_note_data.json"),
      JSON.stringify(aiNotes, null, 2),
      "utf-8"
    );
    console.log(`[AI 릴리즈 노트] ${aiNotes.length}건 저장 완료!`);
  } catch (err) {
    console.log(`  AI 릴리즈 노트 에러: ${err.message}`);
  }

  // --- SP5 릴리즈 노트 ---
  try {
    const sp5Notes = await crawlReleaseNotes(
      page,
      "https://docs1.inswave.com/sp5_release_note",
      "sp5_release_note"
    );
    const rnOutDir = path.join(__dirname, "..", "data", "release_notes");
    fs.writeFileSync(
      path.join(rnOutDir, "sp5_release_note_data.json"),
      JSON.stringify(sp5Notes, null, 2),
      "utf-8"
    );
    console.log(`[SP5 릴리즈 노트] ${sp5Notes.length}건 저장 완료!`);
  } catch (err) {
    console.log(`  SP5 릴리즈 노트 에러: ${err.message}`);
  }

  console.log("\n========================================");
  console.log("모든 SPA 문서 크롤링 완료!");
  console.log("========================================");

  await browser.close();
})();
