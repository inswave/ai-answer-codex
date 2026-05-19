const puppeteer = require('./정식라이선스/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/faqList.xml', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 5000));

  // Click "더보기" button to go to full FAQ list
  const goFaqBtn = await page.$('#mf_wfm_content_go_faq');
  if (goFaqBtn) {
    console.log("Clicking FAQ more button...");
    await goFaqBtn.click();
    await new Promise(r => setTimeout(r, 5000));
  }

  // Check current page content after navigation
  const pageContent = await page.evaluate(() => {
    // Look for FAQ grid or list
    const allText = [];
    const tds = document.querySelectorAll('td');
    tds.forEach(td => {
      const text = td.innerText?.trim();
      if (text && text.length > 3) {
        allText.push({ id: td.id, text });
      }
    });
    return allText.slice(0, 100);
  });

  console.log("=== Page content after clicking FAQ button ===");
  pageContent.forEach((t, i) => console.log(`[${i}] ${t.id}: ${t.text}`));

  // Check URL
  console.log("\nCurrent URL:", page.url());

  // Look for pagination
  const pagination = await page.evaluate(() => {
    const paging = document.querySelectorAll('[id*="paging"], [id*="page"], [class*="paging"], [class*="page"]');
    return Array.from(paging).map(el => ({ id: el.id, class: el.className, text: el.innerText?.substring(0, 200) }));
  });
  console.log("\n=== Pagination elements ===");
  pagination.forEach((p, i) => console.log(`[${i}]`, JSON.stringify(p)));

  await browser.close();
})();
