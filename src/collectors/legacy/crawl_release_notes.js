const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function crawlReleaseNote(page, url, label) {
  console.log(`\n=== [${label}] 릴리즈 노트 크롤링 ===`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await delay(10000);

  // UI-TREE-ITEM 엘리먼트 수집
  const itemCount = await page.evaluate(() => {
    return document.querySelectorAll("ui-tree-item").length;
  });
  console.log(`  ui-tree-item ${itemCount}개 발견`);

  // 각 트리 아이템의 텍스트 가져오기
  const items = await page.evaluate(() => {
    const els = document.querySelectorAll("ui-tree-item");
    return Array.from(els).map((el, idx) => ({
      text: el.textContent.replace(/keyboard_arrow_\w+/g, "").replace(/\s+/g, " ").trim().substring(0, 200),
      idx,
      hasChildren: el.querySelectorAll("ui-tree-item").length > 0,
    }));
  });

  // 자식이 없는 (리프) 항목만 클릭
  const leafItems = items.filter((item) => !item.hasChildren && item.text.length > 5);
  console.log(`  리프 항목 ${leafItems.length}개`);

  const allData = [];

  for (let i = 0; i < leafItems.length; i++) {
    const item = leafItems[i];
    console.log(`  [${i + 1}/${leafItems.length}] "${item.text.substring(0, 70)}"`);

    try {
      // 해당 트리 아이템 클릭
      await page.evaluate((idx) => {
        const els = document.querySelectorAll("ui-tree-item");
        const el = els[idx];
        // 직접 클릭 또는 내부 요소 클릭
        el.click();
      }, item.idx);
      await delay(3000);

      // 뷰어 영역에서 콘텐츠 수집
      const content = await page.evaluate(() => {
        // ui-html 또는 ui-main 내부의 콘텐츠
        const viewer =
          document.querySelector("ui-html") ||
          document.querySelector("ui-main") ||
          document.querySelector('[class*="viewer"]');
        if (viewer) return viewer.innerText || "";
        return document.body.innerText || "";
      });

      if (content.length > 100) {
        allData.push({
          source: label,
          title: item.text,
          content: content.trim().substring(0, 100000),
          url: url,
        });
        console.log(`    -> ${content.length}자 수집`);
      } else {
        console.log(`    -> 콘텐츠 부족 (${content.length}자)`);
      }
    } catch (err) {
      console.log(`    에러: ${err.message}`);
    }
  }

  return allData;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();

  // AI 릴리즈 노트
  const aiData = await crawlReleaseNote(
    page,
    "https://docs1.inswave.com/ai_release_note",
    "ai_release_note"
  );
  const aiOut = path.join(__dirname, "..", "data", "release_notes", "ai_release_note_data.json");
  fs.writeFileSync(aiOut, JSON.stringify(aiData, null, 2), "utf-8");
  console.log(`\nAI 릴리즈 노트 저장: ${aiData.length}건`);

  // SP5 릴리즈 노트
  const sp5Data = await crawlReleaseNote(
    page,
    "https://docs1.inswave.com/sp5_release_note",
    "sp5_release_note"
  );
  const sp5Out = path.join(__dirname, "..", "data", "release_notes", "sp5_release_note_data.json");
  fs.writeFileSync(sp5Out, JSON.stringify(sp5Data, null, 2), "utf-8");
  console.log(`SP5 릴리즈 노트 저장: ${sp5Data.length}건`);

  console.log("\n========================================");
  console.log("릴리즈 노트 크롤링 완료!");
  console.log("========================================");

  await browser.close();
})();
