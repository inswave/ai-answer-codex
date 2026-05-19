const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/faqList.xml', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await new Promise(r => setTimeout(r, 5000));

  // Navigate to full FAQ page
  const goFaqBtn = await page.$('#mf_wfm_content_go_faq');
  if (goFaqBtn) {
    await goFaqBtn.click();
    await new Promise(r => setTimeout(r, 5000));
  }

  // Click first FAQ item
  console.log("=== Clicking first FAQ item ===");
  const firstTitle = await page.$('#mf_wfm_content_grd_faq_cell_0_4');
  if (firstTitle) {
    await firstTitle.click();
    await new Promise(r => setTimeout(r, 3000));

    // Check URL change
    console.log("URL after click:", page.url());

    // Dump all visible text areas that appeared
    const newContent = await page.evaluate(() => {
      const results = [];
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const text = el.innerText?.trim();
        const id = el.id || '';
        // Look for FAQ detail-related elements
        if (id && text && text.length > 20 && (
          id.includes('Detail') || id.includes('detail') ||
          id.includes('View') || id.includes('view') ||
          id.includes('cont') || id.includes('answer') ||
          id.includes('body') || id.includes('desc')
        )) {
          if (!results.some(r => r.id === id)) {
            results.push({ id, tag: el.tagName, text: text.substring(0, 500) });
          }
        }
      }
      return results;
    });

    console.log("\n=== Elements with detail/view/content IDs ===");
    newContent.forEach((c, i) => console.log(`[${i}] ${c.tag}#${c.id}: ${c.text.substring(0, 200)}\n`));

    // Check for WFrame navigation - the FAQ detail might be in a new WFrame
    const wframes = await page.evaluate(() => {
      const frames = document.querySelectorAll('[id*="wfm"], [id*="WFrame"]');
      return Array.from(frames).map(f => ({ id: f.id, visible: f.offsetParent !== null, text: f.innerText?.substring(0, 300) }));
    });
    console.log("\n=== WFrames ===");
    wframes.forEach((w, i) => console.log(`[${i}] ${w.id} (visible: ${w.visible}): ${w.text?.substring(0, 150)}\n`));

    // Screenshot for debugging
    await page.screenshot({ path: 'faq_detail_debug.png', fullPage: true });
    console.log("\nScreenshot saved: faq_detail_debug.png");

    // Also check if it's an accordion - maybe the answer expands below the row
    const gridContent = await page.evaluate(() => {
      const grid = document.getElementById('mf_wfm_content_grd_faq');
      return grid ? grid.innerHTML.substring(0, 3000) : 'grid not found';
    });
    console.log("\n=== Grid HTML (first 1500 chars) ===");
    console.log(gridContent.substring(0, 1500));
  }

  await browser.close();
})();
