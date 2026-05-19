const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const SPACE_KEY = "TechDBinside";
const SPACE_URL = "https://inswave01.atlassian.net/wiki/spaces/TechDBinside/overview";
const COOKIE_FILE = path.join(__dirname, "confluence_cookies.json");
const OUTPUT_FILE = path.join(__dirname, "..", "data", "confluence", "confluence_inside_data.json");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`쿠키 저장 완료 (${cookies.length}개)`);
}

async function loadCookies(page) {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
    await page.setCookie(...cookies);
    console.log(`쿠키 로드 완료 (${cookies.length}개)`);
    return true;
  }
  return false;
}

async function isLoggedIn(page) {
  try {
    await page.goto("https://inswave01.atlassian.net/wiki", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await delay(3000);
    const url = page.url();
    if (url.includes("id.atlassian.com") || url.includes("accounts.google.com") || url.includes("login")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function waitForManualLogin(page) {
  console.log("\n========================================");
  console.log("브라우저가 열렸습니다.");
  console.log("구글 SSO로 로그인해주세요.");
  console.log("로그인 완료 후 자동으로 크롤링이 시작됩니다.");
  console.log("========================================\n");

  await page.goto("https://inswave01.atlassian.net/wiki", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  const maxWait = 300000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await delay(3000);
    const url = page.url();
    if (url.includes("atlassian.net/wiki") && !url.includes("login") && !url.includes("id.atlassian.com")) {
      const content = await page.content();
      if (content.includes("space") || content.includes("Home")) {
        console.log("로그인 확인됨!");
        await saveCookies(page);
        return true;
      }
    }
  }
  console.log("로그인 타임아웃 (5분 초과)");
  return false;
}

async function getAllPageIds(page) {
  const pages = [];
  let start = 0;
  const limit = 25;

  while (true) {
    const apiUrl =
      `https://inswave01.atlassian.net/wiki/rest/api/content?` +
      `spaceKey=${SPACE_KEY}&limit=${limit}&start=${start}` +
      `&expand=ancestors&type=page`;

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
        parent: r.ancestors && r.ancestors.length > 0
          ? r.ancestors[r.ancestors.length - 1].title
          : null,
      });
    }

    console.log(`  ${pages.length}건 수집됨`);
    if (result.size < limit) break;
    start += limit;
    await delay(500);
  }

  return pages;
}

async function getPageContent(page, pageId) {
  const apiUrl =
    `https://inswave01.atlassian.net/wiki/rest/api/content/${pageId}` +
    `?expand=body.storage,version,metadata.labels`;

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

  return {
    content: textContent.trim(),
    htmlContent: htmlContent,
    lastModified: result.version?.when || null,
    labels: result.metadata?.labels?.results?.map((l) => l.name) || [],
  };
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();

  // 쿠키 로그인 시도
  const hasCookies = await loadCookies(page);
  let loggedIn = false;

  if (hasCookies) {
    console.log("저장된 쿠키로 로그인 시도...");
    loggedIn = await isLoggedIn(page);
    if (loggedIn) console.log("쿠키 로그인 성공!");
    else console.log("쿠키 만료됨. 수동 로그인 필요.");
  }

  if (!loggedIn) {
    loggedIn = await waitForManualLogin(page);
    if (!loggedIn) {
      console.log("로그인 실패. 종료합니다.");
      await browser.close();
      return;
    }
  }

  // 크롤링
  console.log(`\n=== [${SPACE_KEY}] 내부 기술지식DB 크롤링 시작 ===`);

  const pageList = await getAllPageIds(page);
  console.log(`총 ${pageList.length}개 페이지 발견`);

  const allData = [];

  for (let i = 0; i < pageList.length; i++) {
    const p = pageList[i];
    console.log(`  [${i + 1}/${pageList.length}] "${p.title}" 크롤링 중...`);

    try {
      const detail = await getPageContent(page, p.id);
      allData.push({
        space: SPACE_KEY,
        pageId: p.id,
        title: p.title,
        parent: p.parent,
        content: detail.content,
        lastModified: detail.lastModified,
        labels: detail.labels,
        url: `https://inswave01.atlassian.net/wiki/spaces/${SPACE_KEY}/pages/${p.id}`,
      });
    } catch (err) {
      console.log(`  에러: ${err.message}`);
    }

    // 중간 저장 (50건마다)
    if ((i + 1) % 50 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2), "utf-8");
      console.log(`  [중간 저장] ${allData.length}건`);
    }

    await delay(500);
  }

  // 최종 저장
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2), "utf-8");
  console.log(`\n========================================`);
  console.log(`크롤링 완료! 총 ${allData.length}건`);
  console.log(`저장: ${OUTPUT_FILE}`);
  console.log(`========================================`);

  await saveCookies(page);
  await browser.close();
})();
