const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const SPACES = [
  {
    key: "DB",
    url: "https://inswave01.atlassian.net/wiki/spaces/DB/overview",
  },
  {
    key: "TechDBinside",
    url: "https://inswave01.atlassian.net/wiki/spaces/TechDBinside/overview",
  },
];

const COOKIE_FILE = path.join(__dirname, "confluence_cookies.json");
const OUTPUT_FILE = path.join(__dirname, "confluence_data.json");

// 딜레이
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 쿠키 저장
async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`쿠키 저장 완료 (${cookies.length}개)`);
}

// 쿠키 로드
async function loadCookies(page) {
  if (fs.existsSync(COOKIE_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
    await page.setCookie(...cookies);
    console.log(`쿠키 로드 완료 (${cookies.length}개)`);
    return true;
  }
  return false;
}

// 로그인 여부 확인
async function isLoggedIn(page) {
  try {
    await page.goto("https://inswave01.atlassian.net/wiki", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await delay(3000);
    const url = page.url();
    // 로그인 페이지로 리다이렉트되면 미로그인
    if (
      url.includes("id.atlassian.com") ||
      url.includes("accounts.google.com") ||
      url.includes("login")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// 수동 로그인 대기
async function waitForManualLogin(page) {
  console.log("\n========================================");
  console.log("브라우저가 열렸습니다.");
  console.log("구글 SSO로 로그인해주세요.");
  console.log("로그인 완료 후 Confluence 메인 페이지가 뜨면");
  console.log("자동으로 크롤링이 시작됩니다.");
  console.log("========================================\n");

  await page.goto(
    "https://inswave01.atlassian.net/wiki",
    { waitUntil: "networkidle2", timeout: 60000 }
  );

  // 로그인 완료까지 대기 (최대 5분)
  const maxWait = 300000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await delay(3000);
    const url = page.url();
    if (
      url.includes("atlassian.net/wiki") &&
      !url.includes("login") &&
      !url.includes("id.atlassian.com")
    ) {
      // 페이지 내용이 로드되었는지 확인
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

// Confluence REST API로 스페이스의 페이지 목록 가져오기
// sinceDate가 주어지면 해당 날짜 이후 수정된 페이지만 조회 (CQL 사용)
async function getAllPageIds(page, spaceKey, sinceDate) {
  const pages = [];
  let start = 0;
  const limit = 25;

  while (true) {
    let apiUrl;
    if (sinceDate) {
      const cql = encodeURIComponent(
        `space="${spaceKey}" AND type=page AND lastModified >= "${sinceDate}"`
      );
      apiUrl =
        `https://inswave01.atlassian.net/wiki/rest/api/content/search?` +
        `cql=${cql}&limit=${limit}&start=${start}` +
        `&expand=ancestors`;
    } else {
      apiUrl =
        `https://inswave01.atlassian.net/wiki/rest/api/content?` +
        `spaceKey=${spaceKey}&limit=${limit}&start=${start}` +
        `&expand=ancestors&type=page`;
    }

    console.log(`  페이지 목록 조회 중... (start=${start}${sinceDate ? ', since=' + sinceDate : ''})`);

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

// 개별 페이지 본문 가져오기
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

  // HTML에서 텍스트 추출
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
    labels:
      result.metadata?.labels?.results?.map((l) => l.name) || [],
  };
}

// --since 인자 파싱 (예: node confluence_crawl.js --since 2026-03-23)
const sinceArg = process.argv.indexOf('--since');
const SINCE_DATE = sinceArg !== -1 && process.argv[sinceArg + 1]
  ? process.argv[sinceArg + 1]
  : null;

// 메인
(async () => {
  if (SINCE_DATE) {
    console.log(`증분 크롤링 모드: ${SINCE_DATE} 이후 수정된 페이지만 수집`);
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // 1. 쿠키로 로그인 시도
  const hasCookies = await loadCookies(page);
  let loggedIn = false;

  if (hasCookies) {
    console.log("저장된 쿠키로 로그인 시도...");
    loggedIn = await isLoggedIn(page);
    if (loggedIn) {
      console.log("쿠키 로그인 성공!");
    } else {
      console.log("쿠키 만료됨. 수동 로그인 필요.");
    }
  }

  // 2. 수동 로그인
  if (!loggedIn) {
    loggedIn = await waitForManualLogin(page);
    if (!loggedIn) {
      console.log("로그인 실패. 종료합니다.");
      await browser.close();
      return;
    }
  }

  // 3. 각 스페이스 크롤링
  const allData = [];

  for (const space of SPACES) {
    console.log(`\n=== [${space.key}] 스페이스 크롤링 시작 ===`);

    // 페이지 목록 가져오기
    const pageList = await getAllPageIds(page, space.key, SINCE_DATE);
    console.log(`총 ${pageList.length}개 페이지 발견`);

    // 각 페이지 본문 가져오기
    for (let i = 0; i < pageList.length; i++) {
      const p = pageList[i];
      console.log(
        `  [${i + 1}/${pageList.length}] "${p.title}" 크롤링 중...`
      );

      try {
        const detail = await getPageContent(page, p.id);
        allData.push({
          space: space.key,
          pageId: p.id,
          title: p.title,
          parent: p.parent,
          content: detail.content,
          htmlContent: detail.htmlContent,
          lastModified: detail.lastModified,
          labels: detail.labels,
          url: `https://inswave01.atlassian.net/wiki/spaces/${space.key}/pages/${p.id}`,
        });
      } catch (err) {
        console.log(`  ⚠ 에러: ${err.message}`);
        allData.push({
          space: space.key,
          pageId: p.id,
          title: p.title,
          parent: p.parent,
          content: "",
          htmlContent: "",
          lastModified: null,
          labels: [],
          url: `https://inswave01.atlassian.net/wiki/spaces/${space.key}/pages/${p.id}`,
          error: err.message,
        });
      }

      await delay(500); // 서버 부하 방지
    }

    console.log(`[${space.key}] 크롤링 완료!`);
  }

  // 4. 저장
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2), "utf-8");
  console.log(`\n========================================`);
  console.log(`크롤링 완료! 총 ${allData.length}건`);
  console.log(`저장: ${OUTPUT_FILE}`);
  console.log(`========================================`);

  // 쿠키 다시 저장 (갱신)
  await saveCookies(page);
  await browser.close();
})();
