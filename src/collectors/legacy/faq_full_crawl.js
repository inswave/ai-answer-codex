const puppeteer = require('puppeteer');
const fs = require('fs');

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

  const allFaqs = [];
  const totalPages = 7; // 69 items / 10 per page

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    console.log(`\n=== Page ${pageNum} ===`);

    if (pageNum > 1) {
      // Check if page button exists directly
      let pageBtn = await page.$(`#mf_wfm_content_pgl_page_${pageNum}`);
      if (!pageBtn) {
        // Need to click "next page group" button first
        const nextBtn = await page.$('#mf_wfm_content_pgl_next_btn');
        if (nextBtn) {
          await nextBtn.click();
          await new Promise(r => setTimeout(r, 2500));
          pageBtn = await page.$(`#mf_wfm_content_pgl_page_${pageNum}`);
        }
      }
      if (pageBtn) {
        await pageBtn.click();
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // Get row count on this page
    const rowCount = await page.evaluate(() => {
      let count = 0;
      while (document.getElementById(`mf_wfm_content_grd_faq_cell_${count}_4`)) count++;
      return count;
    });

    console.log(`Found ${rowCount} rows`);

    for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
      // Get title and product from list
      const rowInfo = await page.evaluate((idx) => {
        const title = document.getElementById(`mf_wfm_content_grd_faq_cell_${idx}_4`)?.innerText?.trim() || '';
        const product = document.getElementById(`mf_wfm_content_grd_faq_cell_${idx}_2`)?.innerText?.trim() || '';
        const num = document.getElementById(`mf_wfm_content_grd_faq_cell_${idx}_0`)?.innerText?.trim() || '';
        return { title, product, num };
      }, rowIdx);

      // Skip empty rows
      if (!rowInfo.title) {
        console.log(`  [skip] empty row at index ${rowIdx}`);
        continue;
      }

      console.log(`  [${rowInfo.num}] ${rowInfo.title}`);

      // Click title to open detail
      const titleCell = await page.$(`#mf_wfm_content_grd_faq_cell_${rowIdx}_4`);
      if (!titleCell) continue;
      await titleCell.click();
      await new Promise(r => setTimeout(r, 2500));

      // Extract answer from detail page
      const answer = await page.evaluate(() => {
        const el = document.getElementById('mf_wfm_content_txtContent');
        return el ? el.innerText?.trim() : '';
      });

      allFaqs.push({
        num: rowInfo.num,
        product: rowInfo.product,
        title: rowInfo.title,
        answer: answer
      });

      console.log(`    → answer: ${answer.substring(0, 80)}...`);

      // Go back to list
      const listBtn = await page.$('#mf_wfm_content_btn_list');
      if (listBtn) {
        await listBtn.click();
        await new Promise(r => setTimeout(r, 2500));
      }

      // After going back, if not on page 1, re-navigate to correct page
      if (pageNum > 1) {
        const currentPageBtn = await page.$(`#mf_wfm_content_pgl_page_${pageNum}`);
        if (currentPageBtn) {
          const isSelected = await page.evaluate((pn) => {
            const btn = document.getElementById(`mf_wfm_content_pgl_page_${pn}`);
            return btn?.classList.contains('w2pageList_label_selected');
          }, pageNum);
          if (!isSelected) {
            await currentPageBtn.click();
            await new Promise(r => setTimeout(r, 2500));
          }
        }
      }
    }
  }

  // Save results
  const outputPath = 'C:/inswave/faq_자동답변/faq_data.json';
  fs.writeFileSync(outputPath, JSON.stringify(allFaqs, null, 2), 'utf-8');
  console.log(`\n\nTotal FAQs collected: ${allFaqs.length}`);
  console.log(`Saved to ${outputPath}`);

  await browser.close();
})();
