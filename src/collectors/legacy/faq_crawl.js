const puppeteer = require('./정식라이선스/node_modules/puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/faqList.xml', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // Wait for dynamic content to load
  await new Promise(r => setTimeout(r, 5000));

  // Get the full page HTML to understand structure
  const content = await page.evaluate(() => {
    return document.body.innerHTML;
  });

  // Try to find FAQ-related elements
  const texts = await page.evaluate(() => {
    const allElements = document.querySelectorAll('*');
    const results = [];
    for (const el of allElements) {
      const text = el.innerText?.trim();
      if (text && text.length > 5 && text.length < 500 && !el.children.length) {
        results.push({ tag: el.tagName, class: el.className, id: el.id, text });
      }
    }
    return results.slice(0, 100);
  });

  console.log("=== Leaf text elements ===");
  texts.forEach((t, i) => {
    console.log(`[${i}] <${t.tag} class="${t.class}" id="${t.id}"> ${t.text}`);
  });

  // Also capture any iframe content
  const frames = page.frames();
  console.log(`\n=== Frames: ${frames.length} ===`);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    console.log(`Frame[${i}]: ${f.url()}`);
    try {
      const frameTexts = await f.evaluate(() => {
        const els = document.querySelectorAll('*');
        const results = [];
        for (const el of els) {
          const text = el.innerText?.trim();
          if (text && text.length > 5 && text.length < 500 && !el.children.length) {
            results.push({ tag: el.tagName, class: el.className, text });
          }
        }
        return results.slice(0, 50);
      });
      frameTexts.forEach((t, j) => {
        console.log(`  [${j}] <${t.tag} class="${t.class}"> ${t.text}`);
      });
    } catch (e) {}
  }

  await browser.close();
})();
