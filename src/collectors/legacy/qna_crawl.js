const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const QNA_URL = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=/ui/qna/qnaList.xml';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'wtech', 'qna_data.json');

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  // 로그인이 필요하므로 브라우저를 띄워서 수동 로그인
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();

  // W-Tech 메인으로 이동 → 로그인
  await page.goto('https://wtech.inswave.kr', { waitUntil: 'networkidle2', timeout: 30000 });

  console.log('========================================');
  console.log('W-Tech에 로그인해주세요.');
  console.log('로그인 완료 후 자동으로 크롤링이 시작됩니다.');
  console.log('========================================');

  // 로그인 완료 대기 — QnA 페이지로 이동 시도하며 확인
  let loggedIn = false;
  while (!loggedIn) {
    await delay(3000);
    try {
      await page.goto(QNA_URL, { waitUntil: 'networkidle2', timeout: 15000 });
      await delay(3000);

      // QnA 그리드가 있는지 확인
      const hasGrid = await page.evaluate(() => {
        // 일반적인 WebSquare 그리드 ID 패턴 확인
        const els = document.querySelectorAll('[id*="grd"], [id*="grid"], [id*="list"]');
        return els.length > 0;
      });

      if (hasGrid) {
        loggedIn = true;
        console.log('로그인 확인! 크롤링을 시작합니다...');
      } else {
        console.log('아직 로그인되지 않았습니다. 대기 중...');
      }
    } catch (e) {
      console.log('페이지 로드 대기 중...');
    }
  }

  // 먼저 페이지 구조 파악
  await delay(3000);

  // 디버그: 페이지 내 주요 요소 ID 확인
  const debugInfo = await page.evaluate(() => {
    const allElements = document.querySelectorAll('[id]');
    const ids = [];
    allElements.forEach(el => {
      if (el.id && (
        el.id.includes('grd') || el.id.includes('grid') ||
        el.id.includes('pgl') || el.id.includes('page') ||
        el.id.includes('btn') || el.id.includes('txt') ||
        el.id.includes('sel') || el.id.includes('search')
      )) {
        ids.push({ id: el.id, tag: el.tagName, text: el.innerText?.substring(0, 100) });
      }
    });
    return ids;
  });

  console.log('\n=== 페이지 요소 ===');
  debugInfo.forEach(el => console.log(`  ${el.id} (${el.tag}): ${el.text}`));

  // 제품 필터에서 "웹스퀘어" 선택 시도
  const productFilter = await page.evaluate(() => {
    const selects = document.querySelectorAll('[id*="sel"], [id*="cmb"], [id*="product"], [id*="category"]');
    return Array.from(selects).map(el => ({
      id: el.id, tag: el.tagName,
      text: el.innerText?.substring(0, 200),
      options: el.tagName === 'SELECT' ? Array.from(el.options || []).map(o => o.text) : []
    }));
  });
  console.log('\n=== 필터/셀렉트 요소 ===');
  productFilter.forEach(el => console.log(JSON.stringify(el)));

  // 그리드 셀 패턴 확인
  const gridPattern = await page.evaluate(() => {
    const cells = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 10; col++) {
        const patterns = [
          `mf_wfm_content_grd_qna_cell_${row}_${col}`,
          `mf_wfm_content_grd_list_cell_${row}_${col}`,
          `mf_wfm_content_grd_cell_${row}_${col}`,
          `mf_wfm_content_gridView_cell_${row}_${col}`,
        ];
        for (const id of patterns) {
          const el = document.getElementById(id);
          if (el) {
            cells.push({ id, text: el.innerText?.trim()?.substring(0, 100) });
          }
        }
      }
    }
    return cells;
  });

  console.log('\n=== 그리드 셀 패턴 ===');
  gridPattern.forEach(c => console.log(`  ${c.id}: ${c.text}`));

  // 그리드 ID prefix 자동 감지
  const gridPrefix = await page.evaluate(() => {
    const allEls = document.querySelectorAll('[id*="_cell_0_"]');
    if (allEls.length > 0) {
      const firstId = allEls[0].id;
      return firstId.replace(/_cell_0_\d+$/, '');
    }
    return null;
  });

  console.log(`\n그리드 prefix: ${gridPrefix}`);

  if (!gridPrefix) {
    console.log('그리드를 찾을 수 없습니다. 스크린샷을 저장합니다.');
    await page.screenshot({ path: path.join(__dirname, 'qna_debug.png'), fullPage: true });
    await browser.close();
    return;
  }

  // 컬럼 수 파악
  let colCount = 0;
  const colInfo = await page.evaluate((prefix) => {
    const cols = [];
    for (let c = 0; c < 15; c++) {
      const el = document.getElementById(`${prefix}_cell_0_${c}`);
      if (el) cols.push({ col: c, text: el.innerText?.trim()?.substring(0, 100) });
    }
    return cols;
  }, gridPrefix);

  console.log('\n=== 컬럼 정보 (첫 번째 행) ===');
  colInfo.forEach(c => console.log(`  col ${c.col}: ${c.text}`));
  colCount = colInfo.length;

  // 총 페이지 수 확인
  const pageInfo = await page.evaluate(() => {
    // 페이지네이션 텍스트에서 전체 건수 파악
    const totalEl = document.querySelector('[id*="total"], [id*="cnt"], [id*="count"]');
    const pagingEls = document.querySelectorAll('[id*="pgl_page_"]');
    const lastPage = pagingEls.length > 0 ?
      Math.max(...Array.from(pagingEls).map(el => {
        const m = el.id.match(/pgl_page_(\d+)/);
        return m ? parseInt(m[1]) : 0;
      })) : 1;
    return {
      totalText: totalEl?.innerText,
      visiblePages: lastPage,
      pagingCount: pagingEls.length
    };
  });

  console.log('\n=== 페이지 정보 ===');
  console.log(JSON.stringify(pageInfo));

  // 본격 크롤링 시작
  const allQna = [];
  let currentPage = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    console.log(`\n=== 페이지 ${currentPage} 크롤링 중 ===`);

    // 현재 페이지의 행 수 파악
    const rowCount = await page.evaluate((prefix) => {
      let count = 0;
      while (document.getElementById(`${prefix}_cell_${count}_0`)) count++;
      return count;
    }, gridPrefix);

    console.log(`  행 수: ${rowCount}`);
    if (rowCount === 0) break;

    for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
      // 목록에서 기본 정보 추출
      const rowData = await page.evaluate((prefix, idx, cols) => {
        const data = {};
        for (let c = 0; c < cols; c++) {
          const el = document.getElementById(`${prefix}_cell_${idx}_${c}`);
          data[`col_${c}`] = el ? el.innerText?.trim() : '';
        }
        return data;
      }, gridPrefix, rowIdx, colCount);

      // 빈 행 스킵
      const hasContent = Object.values(rowData).some(v => v && v.length > 0);
      if (!hasContent) continue;

      console.log(`  [${rowIdx}] ${JSON.stringify(rowData)}`);

      // 제목 셀 클릭하여 상세 페이지 이동
      // 보통 제목은 col 3 또는 4 (번호, 제품, 분류, 제목 순)
      let titleCol = -1;
      for (const c of colInfo) {
        if (c.text && c.text.length > 10) {
          titleCol = c.col;
          break;
        }
      }
      // 일반적으로 제목이 가장 긴 텍스트
      if (titleCol === -1) {
        const maxCol = colInfo.reduce((a, b) => (a.text?.length || 0) > (b.text?.length || 0) ? a : b);
        titleCol = maxCol.col;
      }

      const titleCell = await page.$(`#${gridPrefix}_cell_${rowIdx}_${titleCol}`);
      if (!titleCell) continue;

      await titleCell.click();
      await delay(2500);

      // 상세 페이지에서 질문/답변 내용 추출
      const detail = await page.evaluate(() => {
        const result = {};
        // 일반적인 WebSquare 상세 페이지 요소들
        const contentPatterns = [
          'mf_wfm_content_txtContent', 'mf_wfm_content_txt_content',
          'mf_wfm_content_edtContent', 'mf_wfm_content_edt_content',
          'mf_wfm_content_txtAnswer', 'mf_wfm_content_txt_answer',
          'mf_wfm_content_txtQuestion', 'mf_wfm_content_txt_question',
        ];

        for (const id of contentPatterns) {
          const el = document.getElementById(id);
          if (el && el.innerText?.trim()) {
            result[id] = el.innerText.trim();
          }
        }

        // 모든 textarea, div with content 확인
        const allTexts = document.querySelectorAll('[id*="content"], [id*="Content"], [id*="answer"], [id*="Answer"], [id*="question"], [id*="Question"], [id*="txt"], [id*="edt"]');
        allTexts.forEach(el => {
          const text = el.innerText?.trim();
          if (text && text.length > 20 && el.id) {
            result[el.id] = text;
          }
        });

        return result;
      });

      allQna.push({
        ...rowData,
        detail
      });

      console.log(`    → 상세 키: ${Object.keys(detail).join(', ')}`);

      // 목록으로 돌아가기
      const listBtn = await page.$('[id*="btn_list"], [id*="btnList"], [id*="btn_back"]');
      if (listBtn) {
        await listBtn.click();
        await delay(2500);
      } else {
        await page.goBack();
        await delay(3000);
      }

      // 현재 페이지로 복귀
      if (currentPage > 1) {
        let pageBtn = await page.$(`[id*="pgl_page_${currentPage}"]`);
        if (!pageBtn) {
          // 다음 페이지 그룹 버튼 클릭
          const nextGroupBtn = await page.$('[id*="pgl_next"]');
          if (nextGroupBtn) {
            // 필요한 만큼 next 클릭
            const neededClicks = Math.floor((currentPage - 1) / 10);
            for (let i = 0; i < neededClicks; i++) {
              const nb = await page.$('[id*="pgl_next"]');
              if (nb) { await nb.click(); await delay(1500); }
            }
          }
          pageBtn = await page.$(`[id*="pgl_page_${currentPage}"]`);
        }
        if (pageBtn) {
          const isSelected = await page.evaluate((pg) => {
            const btn = document.querySelector(`[id*="pgl_page_${pg}"]`);
            return btn?.classList.contains('w2pageList_label_selected');
          }, currentPage);
          if (!isSelected) {
            await pageBtn.click();
            await delay(2500);
          }
        }
      }
    }

    // 다음 페이지로 이동
    currentPage++;
    let nextPageBtn = await page.$(`[id*="pgl_page_${currentPage}"]`);
    if (!nextPageBtn) {
      // 다음 페이지 그룹 버튼
      const nextBtn = await page.$('[id*="pgl_next_btn"], [id*="pgl_next"]');
      if (nextBtn) {
        await nextBtn.click();
        await delay(2000);
        nextPageBtn = await page.$(`[id*="pgl_page_${currentPage}"]`);
      }
    }

    if (nextPageBtn) {
      await nextPageBtn.click();
      await delay(3000);
    } else {
      hasMorePages = false;
      console.log('\n더 이상 페이지가 없습니다.');
    }
  }

  // 결과 저장
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allQna, null, 2), 'utf-8');
  console.log(`\n========================================`);
  console.log(`총 ${allQna.length}건 수집 완료`);
  console.log(`저장 위치: ${OUTPUT_FILE}`);
  console.log(`========================================`);

  await browser.close();
})();
