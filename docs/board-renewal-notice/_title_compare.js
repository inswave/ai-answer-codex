const puppeteer = require('puppeteer');
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const T = '[공지] 기술지원 게시판 리뉴얼 — AI 자동 답변 서비스 오픈';
const blocks = [
  ['현재 (분홍 배경 + 빨강 글씨)',
   '<div style="background:#ffe5e5;padding:10px;"><b style="color:#dc3545;">'+T+'</b></div>'],
  ['개선A — 왼쪽 바 + 진한 글씨 (차분한 공지)',
   '<div style="border-left:5px solid #dc3545;background:#fff5f5;padding:10px 14px;"><b style="font-size:16px;color:#c0392b;">'+T+'</b></div>'],
  ['개선B — 솔리드 빨강 + 흰 글씨 (강한 주목)',
   '<div style="background:#dc3545;padding:12px 16px;border-radius:4px;"><b style="font-size:16px;color:#fff;">'+T+'</b></div>'],
  ['개선C — 브랜드 블루 (본문과 통일감)',
   '<div style="border-left:5px solid #1a4fa0;background:#eef4fc;padding:10px 14px;"><b style="font-size:16px;color:#1a4fa0;">'+T+'</b></div>'],
];
let body = '';
for (const [label, html] of blocks) {
  body += '<p style="font-size:12px;color:#888;margin:18px 0 6px;">'+label+'</p>' + html;
}
const page = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>'
  + 'body{font-family:"Malgun Gothic",sans-serif;background:#fff;margin:0;}'
  + '.box{width:720px;margin:20px auto;padding:20px;}</style></head>'
  + '<body><div class="box">'+body+'</div></body></html>';
require('fs').writeFileSync(dir+'/_title_compare.html', page);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 780, height: 600, deviceScaleFactor: 2 });
  await p.goto('file:///' + dir + '/_title_compare.html', { waitUntil: 'networkidle0' });
  await p.screenshot({ path: dir + '/title_compare.png', fullPage: true });
  await b.close();
  console.log('비교 이미지 생성 완료');
})();
