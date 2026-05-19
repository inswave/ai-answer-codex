const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const MAIN_URL = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';
const OUTPUT_FILE = path.join(__dirname, '..', '..', '..', 'data', 'raw', 'wtech-qa', 'qna_data.json');

const EMAIL = '';
const PASSWORD = '';

const GRID_PREFIX = 'mf_wfm_content_qnaList';

// 라이선스 관련 키워드 (제목에 포함되면 스킵)
const SKIP_KEYWORDS = [
  '라이센스', '라이선스', 'license', '라이센스키', '라이선스키',
  '라이센스 요청', '라이센스 발급', '라이선스 발급', '라이센스 부탁',
  '플러그인 요청', 'WRM 아이디', 'wrm 사이트 아이디',
];

function shouldSkip(title) {
  const lower = title.toLowerCase();
  return SKIP_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function loginAndGoQna(page) {
  // 메인 페이지 접속
  await page.goto(MAIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(3000);

  // 로그인
  console.log('로그인...');
  await page.evaluate(() => {
    document.getElementById('mf_wfm_header_btnLogin').click();
  });
  await delay(3000);

  const emailInput = await page.$('#mf_wfm_content_inputUserId___input');
  const pwInput = await page.$('#mf_wfm_content_inputPassWord___input');
  if (emailInput && pwInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(EMAIL, { delay: 30 });
    await delay(300);
    await pwInput.click({ clickCount: 3 });
    await pwInput.type(PASSWORD, { delay: 30 });
    await delay(300);
    await page.evaluate(() => {
      document.getElementById('mf_wfm_content_btnLogin').click();
    });
    await delay(5000);
  }

  // 메뉴로 QNA 이동 (질의응답 > 기술문의)
  console.log('기술문의 페이지 이동...');
  await page.evaluate(() => {
    const menu = document.getElementById('mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1');
    if (menu) {
      menu.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      menu.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }
  });
  await delay(1000);
  await page.evaluate(() => {
    document.getElementById('mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2').click();
  });
  await delay(5000);

  // 로그인 확인
  const loggedIn = await page.evaluate(() => {
    const btn = document.getElementById('mf_wfm_header_btnLogout');
    return btn && btn.offsetParent !== null;
  });
  console.log(`로그인 상태: ${loggedIn ? '성공' : '실패'}`);
  return loggedIn;
}

async function navigateToQnaViaMenu(page) {
  await page.evaluate(() => {
    const menu = document.getElementById('mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1');
    if (menu) {
      menu.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      menu.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }
  });
  await delay(1000);
  await page.evaluate(() => {
    document.getElementById('mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2').click();
  });
  await delay(5000);
}

async function getRowCount(page) {
  return page.evaluate((prefix) => {
    let count = 0;
    while (document.getElementById(`${prefix}_cell_${count}_0`)) count++;
    return count;
  }, GRID_PREFIX);
}

async function getRowData(page, rowIdx) {
  return page.evaluate((prefix, idx) => {
    const get = (col) => {
      const el = document.getElementById(`${prefix}_cell_${idx}_${col}`);
      return el?.innerText?.trim() || '';
    };
    return {
      num: get(0),
      status: get(1),
      product: get(3),
      category: get(4),
      title: get(5),
      date: get(6),
      author: get(7),
      views: get(8)
    };
  }, GRID_PREFIX, rowIdx);
}

async function getDetailContent(page) {
  return page.evaluate(() => {
    const questionEl = document.getElementById('mf_wfm_content_txtContent');
    const question = questionEl?.innerText?.trim() || '';

    const statusEl = document.getElementById('mf_wfm_content_input_status');
    const status = statusEl?.innerText?.trim() || '';

    const titleEl = document.getElementById('mf_wfm_content_input_title');
    const title = titleEl?.innerText?.trim() || '';

    const dateEl = document.getElementById('mf_wfm_content_input_regdate');
    const regdate = dateEl?.innerText?.trim() || '';

    const authorEl = document.getElementById('mf_wfm_content_input_writer');
    const author = authorEl?.innerText?.trim() || '';

    const commentCountEl = document.getElementById('mf_wfm_content_commentCount');
    const commentCount = parseInt(commentCountEl?.innerText?.trim() || '0');

    const comments = [];
    for (let i = 0; i < 20; i++) {
      const contentEl = document.getElementById(`mf_wfm_content_generator1_${i}_content`);
      if (!contentEl) break;

      const commentText = contentEl.innerText?.trim() || '';
      if (!commentText) continue;

      const nameEl = document.getElementById(`mf_wfm_content_generator1_${i}_tex_comm_writer`);
      const commentAuthor = nameEl?.innerText?.trim() || '';

      const cDateEl = document.getElementById(`mf_wfm_content_generator1_${i}_tex_comm_date`);
      const commentDate = cDateEl?.innerText?.trim() || '';

      const fileEl = document.getElementById(`mf_wfm_content_generator1_${i}_tex_comm_filenm`);
      const commentFile = fileEl?.innerText?.trim() || '';

      comments.push({
        author: commentAuthor,
        date: commentDate,
        content: commentText,
        file: commentFile || undefined
      });
    }

    return { question, status, title, regdate, author, commentCount, comments };
  });
}

async function navigateToPage(page, targetPage) {
  let pageBtn = await page.$(`#mf_wfm_content_pgl_page_${targetPage}`);

  if (!pageBtn) {
    // 페이지 그룹 이동 필요 (5개씩)
    const neededClicks = Math.floor((targetPage - 1) / 5);
    // 먼저 첫 번째 그룹으로 이동
    for (let i = 0; i < 10; i++) {
      const prevBtn = await page.$('#mf_wfm_content_pgl_prev_btn');
      if (!prevBtn) break;
      const isFirstGroup = await page.$('#mf_wfm_content_pgl_page_1');
      if (isFirstGroup) break;
      await page.evaluate(() => {
        document.getElementById('mf_wfm_content_pgl_prev_btn').click();
      });
      await delay(1500);
    }
    // 필요한 만큼 next 클릭
    for (let i = 0; i < neededClicks; i++) {
      const nextBtn = await page.$('#mf_wfm_content_pgl_next_btn');
      if (nextBtn) {
        await page.evaluate(() => {
          document.getElementById('mf_wfm_content_pgl_next_btn').click();
        });
        await delay(1500);
      }
    }
    pageBtn = await page.$(`#mf_wfm_content_pgl_page_${targetPage}`);
  }

  if (pageBtn) {
    const isSelected = await page.evaluate((pg) => {
      const btn = document.getElementById(`mf_wfm_content_pgl_page_${pg}`);
      return btn?.classList.contains('w2pageList_label_selected');
    }, targetPage);

    if (!isSelected) {
      await page.evaluate((pg) => {
        document.getElementById(`mf_wfm_content_pgl_page_${pg}`).click();
      }, targetPage);
      await delay(3000);
    }
    return true;
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();

  // 로그인 + QNA 페이지 이동
  const loggedIn = await loginAndGoQna(page);
  if (!loggedIn) {
    console.log('로그인 실패. 종료.');
    await browser.close();
    return;
  }

  // 그리드 확인
  const initRowCount = await getRowCount(page);
  console.log(`초기 행 수: ${initRowCount}`);

  if (initRowCount === 0) {
    console.log('그리드를 찾을 수 없습니다. 종료.');
    await browser.close();
    return;
  }

  // 기존 데이터 로드
  let allQna = [];
  const collectedNums = new Set();
  if (fs.existsSync(OUTPUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    allQna = existing;
    existing.forEach(item => collectedNums.add(item.num));
    console.log(`기존 데이터 ${existing.length}건 로드 (이어서 크롤링)`);
  }

  let errorCount = 0;
  let skipCount = 0;
  let currentPage = 1;
  let hasMorePages = true;
  let consecutiveSkips = 0; // 연속 스킵 카운터
  const SKIP_THRESHOLD = 10; // 연속 10건 이미 수집된 글이면 중단

  while (hasMorePages) {
    console.log(`\n========== 페이지 ${currentPage} ==========`);

    const rowCount = await getRowCount(page);
    console.log(`  행 수: ${rowCount}`);

    if (rowCount === 0) {
      console.log('  행이 없습니다. 종료.');
      break;
    }

    for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
      const rowData = await getRowData(page, rowIdx);

      // 공지 스킵
      if (rowData.num === '공지') {
        console.log(`  [공지] ${rowData.title} — 스킵`);
        continue;
      }

      if (!rowData.title) continue;

      // 제목에서 댓글 수 분리 (예: "제목1" → "제목")
      const titleMatch = rowData.title.match(/^(.+?)(\d+)$/);
      const cleanTitle = titleMatch ? titleMatch[1].trim() : rowData.title;

      // 이미 수집된 항목 스킵
      if (collectedNums.has(rowData.num)) {
        consecutiveSkips++;
        if (consecutiveSkips >= SKIP_THRESHOLD) {
          console.log(`\n  연속 ${SKIP_THRESHOLD}건 이미 수집됨 — 새 글 수집 완료`);
          hasMorePages = false;
          break;
        }
        continue;
      }

      // 새 글 발견 시 카운터 초기화
      consecutiveSkips = 0;

      // 라이선스 관련 글 스킵
      if (shouldSkip(cleanTitle)) {
        console.log(`  [${rowData.num}] ${cleanTitle} — 라이선스 스킵`);
        skipCount++;
        continue;
      }

      console.log(`  [${rowData.num}] ${cleanTitle}`);

      try {
        // 제목 셀 클릭
        await page.evaluate((prefix, idx) => {
          document.getElementById(`${prefix}_cell_${idx}_5`).click();
        }, GRID_PREFIX, rowIdx);
        await delay(3000);

        // 상세 내용 추출
        const detail = await getDetailContent(page);

        allQna.push({
          num: rowData.num,
          status: rowData.status || detail.status,
          product: rowData.product,
          category: rowData.category,
          title: cleanTitle || detail.title,
          date: rowData.date || detail.regdate,
          author: rowData.author || detail.author,
          views: rowData.views,
          question: detail.question,
          commentCount: detail.commentCount,
          comments: detail.comments
        });

        console.log(`    → 질문 ${detail.question.length}자, 댓글 ${detail.comments.length}건`);

        // 목록으로 돌아가기
        await page.evaluate(() => {
          document.getElementById('mf_wfm_content_btn_list').click();
        });
        await delay(3000);

        // 올바른 페이지로 복귀
        if (currentPage > 1) {
          await navigateToPage(page, currentPage);
        }

      } catch (err) {
        console.error(`    → 에러: ${err.message}`);
        errorCount++;
        // 에러 복구: 메뉴로 QNA 페이지 재이동
        try {
          await navigateToQnaViaMenu(page);
          if (currentPage > 1) {
            await navigateToPage(page, currentPage);
          }
        } catch (e) {
          console.error('    → 복구 실패:', e.message);
        }
      }
    }

    // 다음 페이지 이동
    currentPage++;
    let nextPageBtn = await page.$(`#mf_wfm_content_pgl_page_${currentPage}`);

    if (!nextPageBtn) {
      // 다음 페이지 그룹으로
      const hasNextBtn = await page.$('#mf_wfm_content_pgl_next_btn');
      if (hasNextBtn) {
        await page.evaluate(() => {
          document.getElementById('mf_wfm_content_pgl_next_btn').click();
        });
        await delay(2000);
        nextPageBtn = await page.$(`#mf_wfm_content_pgl_page_${currentPage}`);
      }
    }

    if (nextPageBtn) {
      await page.evaluate((pg) => {
        document.getElementById(`mf_wfm_content_pgl_page_${pg}`).click();
      }, currentPage);
      await delay(3000);
    } else {
      hasMorePages = false;
      console.log('\n더 이상 페이지가 없습니다.');
    }

    // 중간 저장 (3페이지마다)
    if (currentPage % 3 === 0 || !hasMorePages) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allQna, null, 2), 'utf-8');
      console.log(`\n  [중간 저장] ${allQna.length}건 저장됨`);
    }
  }

  // 최종 저장
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allQna, null, 2), 'utf-8');
  console.log(`\n========================================`);
  console.log(`크롤링 완료!`);
  console.log(`총 ${allQna.length}건 수집 (에러 ${errorCount}건, 라이선스 스킵 ${skipCount}건)`);
  console.log(`저장 위치: ${OUTPUT_FILE}`);
  console.log(`========================================`);

  await browser.close();
})();
