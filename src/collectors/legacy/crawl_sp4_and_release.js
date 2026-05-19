const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function htmlToText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

const SP4_BASE = "https://docs.inswave.com/support/api/ws5_sp4/5.0_4.5276B.20250218.131208";

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 },
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();

  // ========== 1. SP4 API 문서 ==========
  console.log("=== SP4 API 문서 크롤링 ===");

  // api_left.html에서 링크 추출
  await page.goto(`${SP4_BASE}/api_left.html`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await delay(2000);

  const sp4Links = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href && href.endsWith(".html")) {
        links.push(href);
      }
    });
    return links;
  });
  console.log(`SP4 페이지 ${sp4Links.length}개 발견`);

  const sp4Data = [];
  for (let i = 0; i < sp4Links.length; i++) {
    const pagePath = sp4Links[i];
    const componentName = pagePath.split("/")[0];
    const url = `${SP4_BASE}/${pagePath}`;
    console.log(`  [${i + 1}/${sp4Links.length}] ${componentName}`);
    try {
      const res = await page.evaluate(async (u) => {
        const r = await fetch(u);
        return r.text();
      }, url);
      const text = htmlToText(res);
      sp4Data.push({
        source: "ws5_sp4_api",
        component: componentName,
        title: `ws5_sp4_api - ${componentName}`,
        content: text,
        htmlContent: res,
        url: url,
      });
    } catch (err) {
      console.log(`    에러: ${err.message}`);
    }
    await delay(200);
  }

  const sp4Out = path.join(__dirname, "..", "data", "api", "ws5_sp4_api_data.json");
  fs.writeFileSync(sp4Out, JSON.stringify(sp4Data, null, 2), "utf-8");
  console.log(`SP4 API 완료! ${sp4Data.length}건\n`);

  // ========== 2. AI 릴리즈 노트 ==========
  console.log("=== AI 릴리즈 노트 크롤링 ===");
  await page.goto("https://docs1.inswave.com/ai_release_note", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await delay(8000);

  // 클릭 가능한 트리 항목 수집
  const aiItems = await page.evaluate(() => {
    const items = [];
    const els = document.querySelectorAll('[class*="tree-item"]');
    els.forEach((el, idx) => {
      const titleEl = el.querySelector('[class*="title"]') || el.querySelector("span");
      const text = (titleEl || el).textContent.replace(/keyboard_arrow_\w+/g, "").trim();
      if (text && text.length > 5 && text.length < 300) {
        items.push({ text, idx });
      }
    });
    return items;
  });
  console.log(`  ${aiItems.length}개 항목 발견`);

  const aiData = [];
  for (let i = 0; i < aiItems.length; i++) {
    const item = aiItems[i];
    console.log(`  [${i + 1}/${aiItems.length}] "${item.text.substring(0, 60)}"`);
    try {
      await page.evaluate((idx) => {
        const els = document.querySelectorAll('[class*="tree-item"]');
        const el = els[idx];
        const clickTarget = el.querySelector('[class*="title"]') || el.querySelector("span") || el;
        clickTarget.click();
      }, item.idx);
      await delay(2000);

      const content = await page.evaluate(() => {
        const viewer =
          document.querySelector('[class*="viewer-content"]') ||
          document.querySelector('[class*="viewer"]') ||
          document.querySelector('[class*="content-area"]') ||
          document.querySelector("main");
        return viewer ? viewer.innerText : document.body.innerText;
      });

      aiData.push({
        source: "ai_release_note",
        title: item.text,
        content: content.trim().substring(0, 50000),
        url: "https://docs1.inswave.com/ai_release_note",
      });
    } catch (err) {
      console.log(`    에러: ${err.message}`);
    }
  }

  const aiOut = path.join(__dirname, "..", "data", "release_notes", "ai_release_note_data.json");
  fs.writeFileSync(aiOut, JSON.stringify(aiData, null, 2), "utf-8");
  console.log(`AI 릴리즈 노트 완료! ${aiData.length}건\n`);

  // ========== 3. SP5 릴리즈 노트 ==========
  console.log("=== SP5 릴리즈 노트 크롤링 ===");
  await page.goto("https://docs1.inswave.com/sp5_release_note", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await delay(8000);

  const sp5Items = await page.evaluate(() => {
    const items = [];
    const els = document.querySelectorAll('[class*="tree-item"]');
    els.forEach((el, idx) => {
      const titleEl = el.querySelector('[class*="title"]') || el.querySelector("span");
      const text = (titleEl || el).textContent.replace(/keyboard_arrow_\w+/g, "").trim();
      if (text && text.length > 5 && text.length < 300) {
        items.push({ text, idx });
      }
    });
    return items;
  });
  console.log(`  ${sp5Items.length}개 항목 발견`);

  const sp5Data = [];
  for (let i = 0; i < sp5Items.length; i++) {
    const item = sp5Items[i];
    console.log(`  [${i + 1}/${sp5Items.length}] "${item.text.substring(0, 60)}"`);
    try {
      await page.evaluate((idx) => {
        const els = document.querySelectorAll('[class*="tree-item"]');
        const el = els[idx];
        const clickTarget = el.querySelector('[class*="title"]') || el.querySelector("span") || el;
        clickTarget.click();
      }, item.idx);
      await delay(2000);

      const content = await page.evaluate(() => {
        const viewer =
          document.querySelector('[class*="viewer-content"]') ||
          document.querySelector('[class*="viewer"]') ||
          document.querySelector('[class*="content-area"]') ||
          document.querySelector("main");
        return viewer ? viewer.innerText : document.body.innerText;
      });

      sp5Data.push({
        source: "sp5_release_note",
        title: item.text,
        content: content.trim().substring(0, 50000),
        url: "https://docs1.inswave.com/sp5_release_note",
      });
    } catch (err) {
      console.log(`    에러: ${err.message}`);
    }
  }

  const sp5Out = path.join(__dirname, "..", "data", "release_notes", "sp5_release_note_data.json");
  fs.writeFileSync(sp5Out, JSON.stringify(sp5Data, null, 2), "utf-8");
  console.log(`SP5 릴리즈 노트 완료! ${sp5Data.length}건`);

  console.log("\n========================================");
  console.log("모든 크롤링 완료!");
  console.log("========================================");

  await browser.close();
})();
