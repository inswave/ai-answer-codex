// 리뉴얼 게시판(운영) 화면 캡처 (Puppeteer).
//   URL 패턴: /websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=<내부페이지>
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = 'https://wtech.inswave.kr/websquare/websquare.html?w2xPath=/cm/xml/index.xml&inPath=';
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';

const targets = [
  { name: 'shot_list',  page: '/ui/qna/qnaList.xml' },
  { name: 'shot_write', page: '/ui/qna/qnaWriteAI.xml' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--lang=ko-KR', '--ignore-certificate-errors'],
  });
  try {
    for (const t of targets) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 980, deviceScaleFactor: 1.5 });
      const url = BASE + t.page;
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (e) {
        console.log('[' + t.name + '] goto 경고:', e.message);
      }
      await sleep(8000); // WebSquare 엔진 부팅 + 비동기 submission 대기
      const out = path.join(dir, t.name + '.png');
      await page.screenshot({ path: out, fullPage: true });
      console.log('캡처:', out, '| 최종 URL:', page.url(), '| 제목:', await page.title());
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('캡처 실패:', e.message); process.exit(1); });
