const path = require('path');
const puppeteer = require('puppeteer');
const fs = require('fs');
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const frag = fs.readFileSync(dir + '/기술지원게시판_리뉴얼_공지_에디터용.html', 'utf8');
// 에디터 너비(약 760px) 흉내낸 래퍼로 미리보기
const html = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>'
  + 'body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;font-size:14px;line-height:1.7;color:#222;margin:0;background:#eef1f5;}'
  + '.editor{width:760px;margin:24px auto;background:#fff;border:1px solid #cdd5e0;border-radius:6px;padding:28px 32px;}'
  + 'ul,ol{padding-left:22px;} li{margin:4px 0;}</style></head>'
  + '<body><div class="editor">' + frag + '</div></body></html>';
fs.writeFileSync(dir + '/_editor_preview.html', html);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const p = await b.newPage();
    await p.setViewport({ width: 860, height: 1000, deviceScaleFactor: 2 });
    await p.goto('file:///' + dir + '/_editor_preview.html', { waitUntil: 'networkidle0' });
    await p.screenshot({ path: dir + '/editor_preview.png', fullPage: true });
    console.log('미리보기 생성 완료');
  } finally { await b.close(); }
})();
