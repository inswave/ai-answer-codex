const puppeteer = require('puppeteer');
const fs = require('fs');
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
// 팝업 XML 의 onpageload HTML 과 동일한 내용
const inner = ''
  + '<div style="font-size:13px; line-height:1.6; color:#222;">'
  + '<div style="border-left:5px solid #1a4fa0; background:#eef4fc; padding:10px 14px; margin:0 0 14px;">'
  +   '<b style="font-size:16px; color:#1a4fa0;">[공지] 기술지원 게시판 리뉴얼 — AI 자동 답변 서비스 오픈</b>'
  + '</div>'
  + '<p>안녕하세요. 인스웨이브 기술지원팀입니다. 기술지원 게시판이 <b>AI 자동 답변 서비스</b>와 함께 새롭게 리뉴얼되었습니다.</p>'
  + '<div style="border-left:4px solid #e2562f; background:#fff6f3; padding:10px 14px; margin:12px 0;">'
  +   '<b style="color:#c0392b;">[필독]</b> 본 서비스는 <b style="color:#c0392b;">유지보수 계약 업체에 한하여</b> 제공됩니다. AI 답변이 어려운 경우 <b>엔지니어 답변을 요청</b>하시면 기존과 동일하게 담당 엔지니어가 답변드립니다.'
  + '</div>'
  + '<p style="font-size:14px; font-weight:bold; color:#1a4fa0; border-left:4px solid #2f6fd0; padding-left:8px; margin:14px 0 6px;">새로워진 기능</p>'
  + '<ul style="margin:6px 0; padding-left:20px;">'
  +   '<li>문의 등록 시 <b>AI가 답변 초안을 자동 제공</b> (원인 → 해결 → 확인 순)</li>'
  +   '<li>답변 <b>근거(유사 사례·출처)</b> 함께 표시</li>'
  +   '<li><b>첨부 소스(.xml 등) 분석</b> 후 화면 구조에 맞춰 답변</li>'
  +   '<li>관련 <b>개발가이드 샘플</b> 바로 다운로드</li>'
  + '</ul>'
  + '<p style="font-size:14px; font-weight:bold; color:#1a4fa0; border-left:4px solid #2f6fd0; padding-left:8px; margin:14px 0 6px;">이용 방법</p>'
  + '<ol style="margin:6px 0; padding-left:20px;">'
  +   '<li><b>[문의하기]</b> 선택 → 제품 / 회사(프로젝트)명 / WebSquare 버전 입력</li>'
  +   '<li>문의 내용 작성 + 관련 <b>소스(.xml 등) 첨부</b></li>'
  +   '<li>등록 후 수 분 내 <b>AI 답변 초안</b> 확인 (추가 문의는 이어서 작성)</li>'
  + '</ol>'
  + '</div>';
const btns = '<div style="margin-top:16px;text-align:right;border-top:1px solid #eee;padding-top:12px;">'
  + '<button style="padding:7px 12px;margin-left:6px;">오늘 하루 보지 않기</button>'
  + '<button style="padding:7px 12px;margin-left:6px;background:#1a4fa0;color:#fff;border:none;border-radius:3px;">닫기</button></div>';
const page = '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>'
  + 'body{font-family:"Malgun Gothic",sans-serif;background:#ccc;margin:0;padding:30px;}'
  + '.popup{width:720px;background:#fff;border:1px solid #999;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.3);}'
  + '.titlebar{background:#f3f5f8;border-bottom:1px solid #ddd;padding:8px 14px;font-weight:bold;font-size:13px;border-radius:6px 6px 0 0;}'
  + '.bodyp{padding:20px 24px;}</style></head>'
  + '<body><div class="popup"><div class="titlebar">기술지원 게시판 리뉴얼 안내</div>'
  + '<div class="bodyp">' + inner + btns + '</div></div></body></html>';
fs.writeFileSync(dir + '/_popup_preview.html', page);
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 800, height: 820, deviceScaleFactor: 2 });
  await p.goto('file:///' + dir + '/_popup_preview.html', { waitUntil: 'networkidle0' });
  await p.screenshot({ path: dir + '/popup_preview.png', fullPage: true });
  await b.close();
  console.log('팝업 미리보기 생성');
})();
