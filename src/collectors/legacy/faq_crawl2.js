const puppeteer = require('./정식라이선스/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Intercept network requests to find FAQ API
  const apiCalls = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('faq') || url.includes('qna') || url.includes('FAQ') || url.includes('list')) {
      let body = '';
      try { body = await response.text(); } catch(e) {}
      apiCalls.push({ url, status: response.status(), bodyLen: body.length, bodyPreview: body.substring(0, 500) });
    }
  });

  await page.goto('https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/faqList.xml', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  await new Promise(r => setTimeout(r, 3000));

  // Try clicking FAQ menu if exists
  try {
    const faqMenu = await page.$('span::-p-text(자주 찾는 질문)');
    if (faqMenu) {
      console.log("Found FAQ menu, clicking...");
      await faqMenu.click();
      await new Promise(r => setTimeout(r, 5000));
    }
  } catch(e) {
    console.log("Could not click FAQ menu:", e.message);
  }

  // Check for FAQ content area
  const faqContent = await page.evaluate(() => {
    // Look for elements that might contain FAQ
    const possibleContainers = document.querySelectorAll('[id*="faq"], [id*="FAQ"], [id*="qna"], [class*="faq"], [class*="FAQ"]');
    const results = [];
    possibleContainers.forEach(el => {
      results.push({ id: el.id, class: el.className, tag: el.tagName, text: el.innerText?.substring(0, 300) });
    });
    return results;
  });

  console.log("\n=== FAQ-related elements ===");
  faqContent.forEach((el, i) => console.log(`[${i}]`, JSON.stringify(el)));

  console.log("\n=== Intercepted API calls ===");
  apiCalls.forEach((c, i) => console.log(`[${i}] ${c.url}\n  status=${c.status} bodyLen=${c.bodyLen}\n  preview: ${c.bodyPreview}\n`));

  // Also try to find the WFrame content area
  const wframeContent = await page.evaluate(() => {
    const wfm = document.querySelector('[id*="wfm_content"]');
    if (wfm) return wfm.innerHTML.substring(0, 2000);
    return 'No wfm_content found';
  });
  console.log("\n=== WFrame content area (first 2000 chars) ===");
  console.log(wframeContent);

  await browser.close();
})();
