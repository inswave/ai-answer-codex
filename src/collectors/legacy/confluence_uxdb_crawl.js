const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const COOKIE_FILE = path.join(__dirname, "confluence_cookies.json");
const OUTPUT_FILE = path.join(__dirname, "confluence_uxdb_data.json");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
  await page.setCookie(...cookies);

  await page.goto("https://inswave01.atlassian.net/wiki", {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await delay(3000);
  console.log("로그인 확인됨!");

  // 1. 페이지 목록 가져오기
  const pages = [];
  let start = 0;
  const limit = 25;
  while (true) {
    const apiUrl =
      `/wiki/rest/api/content?spaceKey=UXDB&limit=${limit}&start=${start}&expand=ancestors&type=page`;
    console.log(`  페이지 목록 조회 중... (start=${start})`);
    const result = await page.evaluate(async (url) => {
      const res = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return res.json();
    }, apiUrl);
    if (!result.results || result.results.length === 0) break;
    for (const r of result.results) {
      pages.push({
        id: r.id,
        title: r.title,
        parent:
          r.ancestors && r.ancestors.length > 0
            ? r.ancestors[r.ancestors.length - 1].title
            : null,
      });
    }
    console.log(`  ${pages.length}건 수집됨`);
    if (result.size < limit) break;
    start += limit;
    await delay(500);
  }
  console.log(`총 ${pages.length}개 페이지 발견`);

  // 2. 각 페이지 본문 가져오기
  const allData = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    console.log(`  [${i + 1}/${pages.length}] "${p.title}" 크롤링 중...`);
    try {
      const apiUrl =
        `/wiki/rest/api/content/${p.id}?expand=body.storage,version,metadata.labels`;
      const result = await page.evaluate(async (url) => {
        const res = await fetch(url, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        return res.json();
      }, apiUrl);
      const htmlContent = result.body?.storage?.value || "";
      const textContent = await page.evaluate((html) => {
        const div = document.createElement("div");
        div.innerHTML = html;
        return div.innerText || div.textContent || "";
      }, htmlContent);
      allData.push({
        space: "UXDB",
        pageId: p.id,
        title: p.title,
        parent: p.parent,
        content: textContent.trim(),
        htmlContent: htmlContent,
        lastModified: result.version?.when || null,
        labels:
          result.metadata?.labels?.results?.map((l) => l.name) || [],
        url: `https://inswave01.atlassian.net/wiki/spaces/UXDB/pages/${p.id}`,
      });
    } catch (err) {
      console.log(`  에러: ${err.message}`);
      allData.push({
        space: "UXDB",
        pageId: p.id,
        title: p.title,
        parent: p.parent,
        content: "",
        htmlContent: "",
        lastModified: null,
        labels: [],
        url: `https://inswave01.atlassian.net/wiki/spaces/UXDB/pages/${p.id}`,
        error: err.message,
      });
    }

    // 중간 저장 (50건마다)
    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2), "utf-8");
      console.log(`  -- 중간 저장 (${allData.length}건) --`);
    }

    await delay(500);
  }

  // 3. 최종 저장
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2), "utf-8");
  console.log(`\n========================================`);
  console.log(`크롤링 완료! 총 ${allData.length}건`);
  console.log(`저장: ${OUTPUT_FILE}`);
  console.log(`========================================`);

  const newCookies = await page.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(newCookies, null, 2));
  await browser.close();
})();
