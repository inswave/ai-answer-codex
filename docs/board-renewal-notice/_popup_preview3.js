const puppeteer = require('puppeteer');
const fs = require('fs');
const dir = 'C:/Users/user/Desktop/ai-answer-remote/docs/board-renewal-notice';
const hd='font-size:14px;font-weight:bold;color:#1a4fa0;border-left:4px solid #2f6fd0;padding-left:9px;';
const html=''
+'<div style="font-size:13px;line-height:1.65;color:#222;">'
+'<div style="border-left:5px solid #1a4fa0;background:#eef4fc;padding:11px 15px;margin:0 0 14px;"><b style="font-size:16px;color:#1a4fa0;">기술지원 게시판 리뉴얼 — AI 자동 답변 서비스 오픈</b></div>'
+'<p style="margin:0 0 12px;">안녕하세요. 인스웨이브 기술지원팀입니다. 기술지원 게시판이 <b>AI 자동 답변 서비스</b>와 함께 새롭게 리뉴얼되었습니다.</p>'
+'<div style="border-left:4px solid #e2562f;background:#fff6f3;padding:11px 14px;margin:0 0 16px;"><b style="color:#c0392b;">[필독]</b> 본 서비스는 <b style="color:#c0392b;">유지보수 계약 업체</b>에 한하여 제공됩니다. AI 답변이 어려운 경우 <b>엔지니어 답변을 요청</b>하시면 기존과 동일하게 담당 엔지니어가 답변드립니다.</div>'
+'<p style="'+hd+' margin:0 0 8px;">새로워진 기능</p>'
+'<ul style="margin:0 0 4px;padding-left:20px;"><li style="margin-bottom:5px;"><b>AI 자동 답변 초안</b> &ndash; 원인 분석 &rarr; 해결 방법 &rarr; 확인 사항 순으로 즉시 제공</li><li style="margin-bottom:5px;">답변 <b>근거(유사 사례&middot;출처)</b> 함께 표시</li><li style="margin-bottom:5px;"><b>첨부 소스(.xml 등) 분석</b> 후 화면 구조에 맞춰 답변</li><li><b>개발가이드 샘플</b> 바로 다운로드</li></ul>'
+'<p style="'+hd+' margin:16px 0 8px;">이용 방법</p>'
+'<ol style="margin:0;padding-left:20px;"><li style="margin-bottom:5px;"><b>[문의하기]</b> 선택 &rarr; 제품 / 회사(프로젝트)명 / WebSquare 버전 입력</li><li style="margin-bottom:5px;">문의 내용 작성 + 관련 <b>소스(.xml 등) 첨부</b></li><li>등록 후 수 분 내 <b>AI 답변 초안</b> 확인 (추가 문의는 이어서 작성)</li></ol>'
+'</div>';
const btns='<div style="margin-top:18px;padding-top:14px;border-top:1px solid #ececec;text-align:right;"><button style="padding:8px 14px;margin-right:6px;background:#fff;color:#555;border:1px solid #ccc;border-radius:4px;font-size:13px;">오늘 하루 보지 않기</button><button style="padding:8px 20px;background:#1a4fa0;color:#fff;border:1px solid #1a4fa0;border-radius:4px;font-size:13px;font-weight:bold;">닫기</button></div>';
// 팝업 본문(grp_pop padding 20 24) 재현
const inner='<div style="padding:20px 24px;">'+html+btns+'</div>';
const page='<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>body{font-family:"Malgun Gothic",sans-serif;margin:0;}#c{width:720px;}</style></head><body><div id="c">'+inner+'</div></body></html>';
fs.writeFileSync(dir+'/_popup_preview3.html',page);
(async()=>{const b=await puppeteer.launch({headless:'new',args:['--no-sandbox']});const p=await b.newPage();await p.setViewport({width:740,height:300,deviceScaleFactor:2});await p.goto('file:///'+dir+'/_popup_preview3.html',{waitUntil:'networkidle0'});const h=await p.evaluate(()=>document.getElementById('c').getBoundingClientRect().height);console.log('CONTENT_HEIGHT='+Math.ceil(h));await b.close();})();
