/**
 * W-Tech QNA 게시판 크롤러
 * Puppeteer 기반 — WebSquare SPA 로그인 모달 + 동적 그리드 처리
 *
 * 동작 방식:
 *  1. 메인 페이지 로드 → LOGIN 버튼 클릭 → 로그인 모달에 자격증명 입력
 *  2. 메뉴 hover/click으로 기술문의(QNA) 페이지 이동
 *  3. 그리드 행 단위로 제목 클릭 → 상세 페이지에서 질문/댓글 추출 → 목록 복귀
 *  4. 페이지네이션으로 다음 페이지 이동
 *
 * 체크포인트(이어 크롤링):
 *  - data/raw/wtech-qa/qna_data.json에 기존 데이터 있으면 num 기반 중복 제거
 *  - 연속 SKIP_THRESHOLD건 이미 수집된 글이면 새 글 없는 것으로 보고 종료
 *
 * 참고: 레거시 src/collectors/legacy/qna_crawl_v2.js의 검증된 셀렉터/흐름을 클래스로 래핑
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { maskPersonalInfo } = require('../utils/masking');
const { loadConfig } = require('../utils/config');

const MAIN_URL = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml';

const SELECTORS = {
  loginBtnHeader: 'mf_wfm_header_btnLogin',
  logoutBtnHeader: 'mf_wfm_header_btnLogout',
  loginModalUserId: '#mf_wfm_content_inputUserId___input',
  loginModalPassword: '#mf_wfm_content_inputPassWord___input',
  loginModalSubmit: 'mf_wfm_content_btnLogin',
  menuDepth1Qna: 'mf_wfm_header_gen_menuDepth1_1_btn_menuDepth1',
  menuDepth2Tech: 'mf_wfm_header_gen_menuDepth1_1_gen_menuDepth2_1_btn_menuDepth2',
  gridPrefix: 'mf_wfm_content_qnaList',
  detailQuestion: 'mf_wfm_content_txtContent',
  detailTitle: 'mf_wfm_content_input_title',
  detailRegdate: 'mf_wfm_content_input_regdate',
  detailWriter: 'mf_wfm_content_input_writer',
  detailStatus: 'mf_wfm_content_input_status',
  detailCommentCount: 'mf_wfm_content_commentCount',
  backToList: 'mf_wfm_content_btn_list',
  pgPagePrefix: 'mf_wfm_content_pgl_page_',
  pgNext: 'mf_wfm_content_pgl_next_btn',
  pgPrev: 'mf_wfm_content_pgl_prev_btn',
  pgSelected: 'w2pageList_label_selected',
};

// 라이선스 관련 키워드 (제목에 포함되면 스킵 — 답변 데이터로 부적합)
const SKIP_KEYWORDS = [
  '라이센스', '라이선스', 'license', '라이센스키', '라이선스키',
  '라이센스 요청', '라이센스 발급', '라이선스 발급', '라이센스 부탁',
  '플러그인 요청', 'WRM 아이디', 'wrm 사이트 아이디',
];

const SKIP_THRESHOLD = 10; // 연속 N건 이미 수집되면 종료

class WTechCollector {
  constructor(config) {
    this.config = config || loadConfig().wtech;
    this.browser = null;
    this.collectedData = []; // 표준 QA 포맷 (반환용)
    this.rawData = [];        // 원본 포맷 (체크포인트/저장용)
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: 'new',
      defaultViewport: { width: 1400, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    console.log('[W-Tech] 브라우저 초기화 완료');
  }

  _delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  _shouldSkipByTitle(title) {
    const lower = (title || '').toLowerCase();
    return SKIP_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
  }

  /**
   * 로그인 + QNA 페이지 이동
   */
  async loginAndGoQna(page) {
    await page.goto(MAIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await this._delay(3000);

    console.log('[W-Tech] 로그인 모달 열기');
    await page.evaluate((id) => document.getElementById(id).click(), SELECTORS.loginBtnHeader);
    await this._delay(3000);

    const emailInput = await page.$(SELECTORS.loginModalUserId);
    const pwInput = await page.$(SELECTORS.loginModalPassword);
    if (!emailInput || !pwInput) {
      throw new Error('[W-Tech] 로그인 모달 입력 필드 못 찾음');
    }

    const { username, password } = this.config.credentials;
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(username, { delay: 30 });
    await this._delay(300);
    await pwInput.click({ clickCount: 3 });
    await pwInput.type(password, { delay: 30 });
    await this._delay(300);

    await page.evaluate((id) => document.getElementById(id).click(), SELECTORS.loginModalSubmit);
    await this._delay(5000);

    await this.navigateToQnaViaMenu(page);

    const loggedIn = await page.evaluate((id) => {
      const btn = document.getElementById(id);
      return btn && btn.offsetParent !== null;
    }, SELECTORS.logoutBtnHeader);

    console.log(`[W-Tech] 로그인 상태: ${loggedIn ? '성공' : '실패'}`);
    return loggedIn;
  }

  async navigateToQnaViaMenu(page) {
    await page.evaluate((id) => {
      const menu = document.getElementById(id);
      if (menu) {
        menu.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        menu.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      }
    }, SELECTORS.menuDepth1Qna);
    await this._delay(1000);
    await page.evaluate((id) => document.getElementById(id).click(), SELECTORS.menuDepth2Tech);
    await this._delay(5000);
  }

  async getRowCount(page) {
    return page.evaluate((prefix) => {
      let count = 0;
      while (document.getElementById(`${prefix}_cell_${count}_0`)) count++;
      return count;
    }, SELECTORS.gridPrefix);
  }

  async getRowData(page, rowIdx) {
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
        views: get(8),
      };
    }, SELECTORS.gridPrefix, rowIdx);
  }

  async getDetailContent(page) {
    return page.evaluate((sel) => {
      const text = (id) => document.getElementById(id)?.innerText?.trim() || '';
      const question = text(sel.detailQuestion);
      const status = text(sel.detailStatus);
      const title = text(sel.detailTitle);
      const regdate = text(sel.detailRegdate);
      const author = text(sel.detailWriter);
      const commentCount = parseInt(text(sel.detailCommentCount) || '0', 10);

      const comments = [];
      for (let i = 0; i < 50; i++) {
        const contentEl = document.getElementById(`mf_wfm_content_generator1_${i}_content`);
        if (!contentEl) break;
        const commentText = contentEl.innerText?.trim() || '';
        if (!commentText) continue;
        comments.push({
          author: text(`mf_wfm_content_generator1_${i}_tex_comm_writer`),
          date: text(`mf_wfm_content_generator1_${i}_tex_comm_date`),
          content: commentText,
          file: text(`mf_wfm_content_generator1_${i}_tex_comm_filenm`) || undefined,
        });
      }

      return { question, status, title, regdate, author, commentCount, comments };
    }, SELECTORS);
  }

  async navigateToPage(page, targetPage) {
    let pageBtn = await page.$(`#${SELECTORS.pgPagePrefix}${targetPage}`);

    if (!pageBtn) {
      const neededClicks = Math.floor((targetPage - 1) / 5);
      // 첫 번째 페이지 그룹으로 되감기
      for (let i = 0; i < 10; i++) {
        const prevBtn = await page.$(`#${SELECTORS.pgPrev}`);
        if (!prevBtn) break;
        const isFirstGroup = await page.$(`#${SELECTORS.pgPagePrefix}1`);
        if (isFirstGroup) break;
        await page.evaluate((id) => document.getElementById(id).click(), SELECTORS.pgPrev);
        await this._delay(1500);
      }
      // 필요한 만큼 next 클릭
      for (let i = 0; i < neededClicks; i++) {
        const nextBtn = await page.$(`#${SELECTORS.pgNext}`);
        if (nextBtn) {
          await page.evaluate((id) => document.getElementById(id).click(), SELECTORS.pgNext);
          await this._delay(1500);
        }
      }
      pageBtn = await page.$(`#${SELECTORS.pgPagePrefix}${targetPage}`);
    }

    if (pageBtn) {
      const isSelected = await page.evaluate((id, sel) => {
        const btn = document.getElementById(id);
        return btn?.classList.contains(sel);
      }, `${SELECTORS.pgPagePrefix}${targetPage}`, SELECTORS.pgSelected);

      if (!isSelected) {
        await page.evaluate((id) => document.getElementById(id).click(), `${SELECTORS.pgPagePrefix}${targetPage}`);
        await this._delay(3000);
      }
      return true;
    }
    return false;
  }

  /**
   * 표준 QA 포맷으로 변환
   */
  _toStandardQA(item) {
    const answer = (item.comments || [])
      .map((c) => c.content)
      .filter(Boolean)
      .join('\n\n---\n\n');
    return {
      id: item.num,
      category: item.category || '',
      subcategory: item.product || '',
      question: maskPersonalInfo(`${item.title}\n\n${item.question}`),
      answer: maskPersonalInfo(answer),
      source: 'W-Tech QNA',
      date: item.date || '',
      tags: [],
    };
  }

  _loadCheckpoint() {
    const filePath = path.join(__dirname, '../../data/raw/wtech-qa/qna_data.json');
    if (!fs.existsSync(filePath)) {
      return { existing: [], collectedNums: new Set(), filePath };
    }
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const collectedNums = new Set(existing.map((item) => item.num));
    return { existing, collectedNums, filePath };
  }

  /**
   * 메인 수집 루프
   * @param {Object} [options] - { maxPages?: number, fullRefresh?: boolean }
   */
  async collect(options = {}) {
    const { maxPages = Infinity, fullRefresh = false } = options;

    try {
      await this.init();
      const page = await this.browser.newPage();

      const ok = await this.loginAndGoQna(page);
      if (!ok) throw new Error('[W-Tech] 로그인 실패');

      const initRowCount = await this.getRowCount(page);
      console.log(`[W-Tech] QNA 페이지 진입 — 초기 행 수: ${initRowCount}`);
      if (initRowCount === 0) throw new Error('[W-Tech] 그리드 행 못 찾음 (페이지 이동 실패 가능성)');

      // 체크포인트
      const { existing, collectedNums, filePath } = this._loadCheckpoint();
      if (fullRefresh) {
        this.rawData = [];
        collectedNums.clear();
        console.log('[W-Tech] fullRefresh: 체크포인트 무시');
      } else {
        this.rawData = existing;
        console.log(`[W-Tech] 체크포인트 로드: 기존 ${existing.length}건`);
      }

      let errorCount = 0;
      let skipCount = 0;
      let newlyCollected = 0;
      let currentPage = 1;
      let consecutiveSkips = 0;
      let stop = false;

      while (!stop && currentPage <= maxPages) {
        console.log(`\n[W-Tech] ====== 페이지 ${currentPage} ======`);
        const rowCount = await this.getRowCount(page);
        if (rowCount === 0) { console.log('[W-Tech] 행 없음. 종료'); break; }

        for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
          const rowData = await this.getRowData(page, rowIdx);

          if (rowData.num === '공지') continue;
          if (!rowData.title) continue;

          // 제목 끝에 댓글 수 붙는 경우 분리
          const titleMatch = rowData.title.match(/^(.+?)(\d+)$/);
          const cleanTitle = titleMatch ? titleMatch[1].trim() : rowData.title;

          // 이미 수집됨
          if (collectedNums.has(rowData.num)) {
            consecutiveSkips++;
            if (consecutiveSkips >= SKIP_THRESHOLD) {
              console.log(`[W-Tech] 연속 ${SKIP_THRESHOLD}건 이미 수집 → 신규 글 없음으로 종료`);
              stop = true;
              break;
            }
            continue;
          }
          consecutiveSkips = 0;

          // 라이선스 키워드 스킵
          if (this._shouldSkipByTitle(cleanTitle)) {
            console.log(`[W-Tech]  [${rowData.num}] ${cleanTitle} → 라이선스 스킵`);
            skipCount++;
            continue;
          }

          console.log(`[W-Tech]  [${rowData.num}] ${cleanTitle}`);
          try {
            await page.evaluate((prefix, idx) => {
              document.getElementById(`${prefix}_cell_${idx}_5`).click();
            }, SELECTORS.gridPrefix, rowIdx);
            await this._delay(3000);

            const detail = await this.getDetailContent(page);
            const item = {
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
              comments: detail.comments,
            };
            this.rawData.push(item);
            collectedNums.add(rowData.num);
            newlyCollected++;

            console.log(`[W-Tech]    → 질문 ${detail.question.length}자, 댓글 ${detail.comments.length}건`);

            // 목록 복귀
            await page.evaluate((id) => document.getElementById(id).click(), SELECTORS.backToList);
            await this._delay(3000);

            if (currentPage > 1) await this.navigateToPage(page, currentPage);
          } catch (err) {
            console.error(`[W-Tech]    → 에러: ${err.message}`);
            errorCount++;
            // 복구: 메뉴 재이동
            try {
              await this.navigateToQnaViaMenu(page);
              if (currentPage > 1) await this.navigateToPage(page, currentPage);
            } catch (e) {
              console.error('[W-Tech]    → 복구 실패:', e.message);
            }
          }
        }

        if (stop) break;

        // 다음 페이지
        currentPage++;
        if (currentPage > maxPages) break;

        let nextPageBtn = await page.$(`#${SELECTORS.pgPagePrefix}${currentPage}`);
        if (!nextPageBtn) {
          const hasNextBtn = await page.$(`#${SELECTORS.pgNext}`);
          if (hasNextBtn) {
            await page.evaluate((id) => document.getElementById(id).click(), SELECTORS.pgNext);
            await this._delay(2000);
            nextPageBtn = await page.$(`#${SELECTORS.pgPagePrefix}${currentPage}`);
          }
        }

        if (nextPageBtn) {
          await page.evaluate((id) => document.getElementById(id).click(), `${SELECTORS.pgPagePrefix}${currentPage}`);
          await this._delay(3000);
        } else {
          console.log('[W-Tech] 더 이상 페이지 없음. 종료');
          break;
        }

        // 3페이지마다 중간 저장 (raw)
        if (currentPage % 3 === 0) {
          fs.writeFileSync(filePath, JSON.stringify(this.rawData, null, 2), 'utf8');
          console.log(`[W-Tech] 중간 저장: ${this.rawData.length}건`);
        }
      }

      // 최종 raw 저장
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(this.rawData, null, 2), 'utf8');

      // 표준 QA 포맷으로 변환 (이번 세션에 신규 수집된 것만)
      this.collectedData = this.rawData.map((item) => this._toStandardQA(item));

      console.log(`\n[W-Tech] ===== 완료 =====`);
      console.log(`  신규 수집: ${newlyCollected}건`);
      console.log(`  전체 누적: ${this.rawData.length}건`);
      console.log(`  라이선스 스킵: ${skipCount}건`);
      console.log(`  에러: ${errorCount}건`);

      return this.collectedData;
    } finally {
      await this.close();
    }
  }

  async save(outputDir) {
    const outputPath = path.join(outputDir, 'wtech_qa.json');
    await fsp.writeFile(outputPath, JSON.stringify(this.collectedData, null, 2), 'utf8');
    console.log(`[W-Tech] 저장 완료: ${outputPath}`);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = WTechCollector;
