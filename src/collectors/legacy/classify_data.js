const fs = require('fs');
const path = require('path');

// === 분류 카테고리 정의 ===
const CATEGORIES = {
  'GridView': {
    sub: {
      '셀/컬럼 설정': /column|컬럼|inputtype|inputType|displaymode|displayMode|datatype|dataType|blockselect|blockSelect|셀\s*설정|컬럼\s*설정|header|footer|셀\s*타입/i,
      '정렬/필터': /sort|정렬|filter|필터|검색|autofilter|autoFilter/i,
      '행 추가/삭제': /addrow|addRow|removeRow|insertRow|deleteRow|행\s*추가|행\s*삭제|행\s*이동|rowMove|removeAll/i,
      '셀 병합': /merge|병합|rowSpan|colSpan|rowspan|colspan/i,
      '서브토탈': /subtotal|subTotal|서브토탈|소계|합계|summary/i,
      '스크롤/페이징': /scroll|스크롤|paging|페이징|wheelRows|pageSize|가상스크롤|virtualScroll/i,
      '포커스/선택': /focus|포커스|select.*row|선택|highlight|activerow|activeRow|focusMove/i,
      '엑셀 업/다운로드': /excel.*down|excel.*up|엑셀.*다운|엑셀.*업|advancedExcel|excelDown|excelUp|엑셀.*그리드|그리드.*엑셀/i,
      '기타 GridView': /gridview|gridView|그리드뷰|그리드\s*뷰/i,
    },
    pattern: /gridview|gridView|그리드뷰|그리드\s*뷰|그리드|grid\b/i,
  },
  '엑셀': {
    sub: {
      '엑셀 다운로드': /excel.*down|엑셀.*다운|exceldownload|다운로드.*엑셀/i,
      '엑셀 업로드': /excel.*up|엑셀.*업|excelupload|업로드.*엑셀|advancedExcelUpload/i,
      'OfficeExcel': /officeexcel|officeExcel|office\s*excel|오피스.*엑셀/i,
      '서식/포맷': /displayformat|displayFormat|celltype|cellType|숫자.*포맷|서식|느낌표|dataConvertor/i,
      '기타 엑셀': /엑셀|excel/i,
    },
    pattern: /엑셀|excel|xlsx|xls/i,
  },
  '입력 컴포넌트': {
    sub: {
      'Input/TextBox': /\binput\b|inputbox|inputBox|텍스트.*박스|입력.*필드|validateOnInput|한글.*입력|한글.*유효/i,
      'SelectBox': /selectbox|selectBox|셀렉트.*박스|드롭다운|dropdown|combobox|comboBox/i,
      'MultiSelect': /multiselect|multiSelect|멀티.*셀렉트|다중.*선택/i,
      'AutoComplete': /autocomplete|autoComplete|자동.*완성/i,
      'Calendar': /calendar|캘린더|달력|날짜.*선택|datepicker|datePicker/i,
      'TextArea': /textarea|textArea|텍스트.*영역/i,
      'CheckBox/Radio': /checkbox|checkBox|체크.*박스|radio|라디오/i,
      '기타 입력': /trigger|트리거|inputCalendar|mask|마스크/i,
    },
    pattern: /\binput\b|inputbox|selectbox|selectBox|autocomplete|calendar|textarea|checkbox|radio|trigger|combobox/i,
  },
  '데이터': {
    sub: {
      'DataList/DataMap': /datalist|dataList|datamap|dataMap|데이터리스트|데이터맵|datacollection|dataCollection/i,
      'Submission': /submission|서브미션|통신|ajax|request|response/i,
      'JSON/XML 연동': /json|xml\b|데이터.*연동|바인딩|binding/i,
      '기타 데이터': /데이터|data\b/i,
    },
    pattern: /datalist|dataList|datamap|dataMap|submission|서브미션|datacollection|dataCollection/i,
  },
  '레이아웃/화면': {
    sub: {
      'Popup/Window': /popup|팝업|window.*open|windowopen|모달|modal|dialog|새\s*창/i,
      'Tab': /\btab\b|tabcontrol|tabControl|탭|tab.*container/i,
      'Generator': /generator|제너레이터|동적.*생성|insertChild/i,
      'Group/Layout': /group\b|그룹|layout|레이아웃|tableLayout|tablelayout/i,
      'Tree': /\btree\b|트리|treeview|treeView/i,
      '다국어': /다국어|locale|i18n|language|언어/i,
      '기타 화면': /화면|페이지|메뉴|네비게이션|navigation/i,
    },
    pattern: /popup|팝업|tab\b|tabcontrol|generator|제너레이터|tree\b|트리|다국어|layout/i,
  },
  '엔진/설정': {
    sub: {
      'config.xml': /config\.xml|config\s*xml|엔진\s*설정/i,
      'websquare.xml': /websquare\.xml|websquare\s*xml/i,
      '엔진 버전/업그레이드': /엔진.*버전|버전.*업|업그레이드|upgrade|마이그레이션|migration|sp[345]/i,
      'Studio/개발도구': /studio|스튜디오|개발.*도구|studioserver|studioServer/i,
      '초기 설정/설치': /설치|install|배포|deploy|was\b|tomcat|jeus|weblogic|jdk/i,
      '기타 설정': /설정|config|property|속성/i,
    },
    pattern: /config\.xml|websquare\.xml|엔진|engine|버전|version|studio|스튜디오|설치|install|sp[345]\b|업그레이드/i,
  },
  '하이브리드/모바일': {
    sub: {
      'W-Gear': /w-?gear|wgear|더블유기어|기어/i,
      '하이브리드앱': /hybrid|하이브리드|cordova|phonegap|앱.*연동/i,
      '모바일 대응': /mobile|모바일|반응형|responsive|touch|터치|스와이프/i,
    },
    pattern: /w-?gear|wgear|hybrid|하이브리드|mobile|모바일|cordova/i,
  },
  '보안': {
    sub: {
      '취약점 패치': /취약점|vulnerability|보안.*패치|보안.*조치|cve/i,
      'XSS/인젝션': /xss|크로스사이트|injection|인젝션|스크립팅/i,
      '경로탐색/파일보안': /경로.*탐색|path.*traversal|resource\.wq|upload\.wq|파일.*보안/i,
      '인증/권한': /sso|인증|authentication|권한|authorization|로그인|session|세션/i,
    },
    pattern: /취약점|보안|security|xss|인증|sso|세션|session|패치.*보안/i,
  },
  '외부연계': {
    sub: {
      '차트': /chart|차트|fusion.*chart|fusionchart|echarts|d3/i,
      '에디터': /editor|에디터|ckeditor|ck.*editor|smarteditor/i,
      'ActiveX/플러그인': /activex|activeX|플러그인|plugin|npapi|클립보드/i,
      '지도': /map|지도|kakao.*map|naver.*map|google.*map/i,
      '기타 외부': /외부.*연계|연동|3rd.*party|라이브러리/i,
    },
    pattern: /chart|차트|editor|에디터|activex|플러그인|plugin|지도|map\b/i,
  },
  '라이선스': {
    sub: {
      '데모 라이선스': /데모.*라이[선센]스|demo.*license|평가.*라이/i,
      '정식 라이선스': /정식.*라이[선센]스|commercial.*license|운영.*라이/i,
      '라이선스 오류': /라이[선센]스.*오류|라이[선센]스.*만료|license.*error|license.*expire/i,
      '기타 라이선스': /라이[선센]스|license/i,
    },
    pattern: /라이[선센]스|license/i,
  },
  'W-Pack/빌드': {
    sub: {
      'W-Pack 빌드': /w-?pack|wpack|빌드|build/i,
      'GCC/난독화': /gcc|난독화|obfuscate|minify|압축/i,
    },
    pattern: /w-?pack|wpack|gcc|난독화|빌드|build/i,
  },
  'W-Browser': {
    sub: {
      '설치/버전': /w-?browser|wbrowser|더블유브라우저/i,
      '메모리/성능': /메모리.*증가|memory.*leak|메모리.*누수/i,
    },
    pattern: /w-?browser|wbrowser|더블유브라우저/i,
  },
  '기타': {
    sub: {
      '웹접근성': /웹.*접근성|wai-?aria|aria|접근성|스크린.*리더/i,
      'PDF/인쇄': /pdf|인쇄|print|프린트/i,
      '성능': /성능|performance|느림|속도|최적화|optimize/i,
      '정기점검/보고서': /정기.*점검|분기.*점검|보고서|점검.*보고/i,
      'AI 관련': /\bai\b|인공지능|websquare.*ai|ai.*엔진|ai.*플러그인/i,
      '분류불가': /.*/,
    },
    pattern: /./,  // fallback
  },
};

// === 분류 함수 ===
function classify(text) {
  const result = { main: '기타', sub: '분류불가' };

  for (const [mainCat, { sub, pattern }] of Object.entries(CATEGORIES)) {
    if (mainCat === '기타') continue;
    if (pattern.test(text)) {
      result.main = mainCat;
      for (const [subCat, subPattern] of Object.entries(sub)) {
        if (subPattern.test(text)) {
          result.sub = subCat;
          break;
        }
      }
      break;
    }
  }

  // 기타 카테고리 소분류
  if (result.main === '기타') {
    const etcSub = CATEGORIES['기타'].sub;
    for (const [subCat, subPattern] of Object.entries(etcSub)) {
      if (subPattern.test(text)) {
        result.sub = subCat;
        break;
      }
    }
  }

  return result;
}

// === 데이터 로드 및 분류 ===
function loadAndClassify() {
  const stats = {};
  const allClassified = [];

  // 1. W-Tech QNA
  console.log('W-Tech QNA 분류 중...');
  const qna = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'wtech', 'qna_data.json'), 'utf-8'));
  for (const item of qna) {
    const text = `${item.title || ''} ${item.question || ''} ${(item.comments || []).map(c => c.content || '').join(' ')}`;
    const cat = classify(text);
    allClassified.push({ source: 'wtech_qna', id: item.num, title: item.title, date: item.date, ...cat });
  }

  // 2. Gmail
  console.log('Gmail 기술문의 분류 중...');
  const email = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'email', 'email_technical_qna.json'), 'utf-8'));
  for (const item of email) {
    const text = `${item.subject || ''} ${item.content || ''}`;
    const cat = classify(text);
    allClassified.push({ source: 'gmail', id: item.threadId, title: item.subject, date: item.date, ...cat });
  }

  // 3. Confluence files
  const confFiles = [
    { file: 'confluence_inside_data.json', source: 'confluence_inside' },
    { file: 'confluence_uxdb_data.json', source: 'confluence_uxdb' },
    { file: 'confluence_db_data.json', source: 'confluence_db' },
    { file: 'confluence_pa_data.json', source: 'confluence_pa' },
    { file: 'confluence_w5c_data.json', source: 'confluence_w5c' },
  ];
  for (const { file, source } of confFiles) {
    console.log(`${source} 분류 중...`);
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'confluence', file), 'utf-8'));
    for (const item of data) {
      const text = `${item.title || ''} ${item.content || ''} ${(item.labels || []).join(' ')}`;
      const cat = classify(text);
      allClassified.push({ source, id: item.pageId, title: item.title, date: item.lastModified, ...cat });
    }
  }

  // 4. API Guide
  console.log('API 가이드 분류 중...');
  const api = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'api', 'ws5_api_guide.json'), 'utf-8'));
  for (const item of api) {
    const text = `${item.component || ''} ${item.title || ''} ${item.content || ''}`;
    const cat = classify(text);
    allClassified.push({ source: 'api_guide', id: item.component, title: item.title, date: '', ...cat });
  }

  // 5. FAQ
  console.log('FAQ 분류 중...');
  const faq = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'wtech', 'faq_data.json'), 'utf-8'));
  for (const item of faq) {
    const text = `${item.title || ''} ${item.answer || ''}`;
    const cat = classify(text);
    allClassified.push({ source: 'wtech_faq', id: item.num, title: item.title, date: '', ...cat });
  }

  return allClassified;
}

// === 통계 생성 ===
function generateStats(classified) {
  const mainStats = {};
  const subStats = {};
  const sourceByMain = {};

  for (const item of classified) {
    // 대분류 통계
    mainStats[item.main] = (mainStats[item.main] || 0) + 1;

    // 소분류 통계
    const key = `${item.main} > ${item.sub}`;
    subStats[key] = (subStats[key] || 0) + 1;

    // 소스별 대분류
    const srcKey = `${item.source}|${item.main}`;
    sourceByMain[srcKey] = (sourceByMain[srcKey] || 0) + 1;
  }

  return { mainStats, subStats, sourceByMain };
}

// === 메인 ===
function main() {
  console.log('=== 전체 데이터 분류 시작 ===\n');

  const classified = loadAndClassify();
  console.log(`\n총 ${classified.length.toLocaleString()}건 분류 완료\n`);

  const { mainStats, subStats, sourceByMain } = generateStats(classified);

  // 대분류 출력
  console.log('=== 대분류별 통계 ===\n');
  const sortedMain = Object.entries(mainStats).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedMain) {
    const pct = (count / classified.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / classified.length * 50));
    console.log(`${cat.padEnd(18)} ${String(count).padStart(6)}건 (${pct.padStart(5)}%) ${bar}`);
  }

  // 소분류 출력
  console.log('\n=== 소분류별 통계 ===\n');
  const sortedSub = Object.entries(subStats).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of sortedSub) {
    if (count >= 10) {
      const pct = (count / classified.length * 100).toFixed(1);
      console.log(`  ${cat.padEnd(40)} ${String(count).padStart(6)}건 (${pct.padStart(5)}%)`);
    }
  }

  // 분류 결과 저장
  const outputPath = path.join(__dirname, '..', 'data', 'classified_data.json');
  fs.writeFileSync(outputPath, JSON.stringify(classified, null, 2), 'utf-8');
  console.log(`\n분류 결과 저장: ${outputPath}`);

  // 카테고리별 샘플 저장
  const samplePath = path.join(__dirname, '..', 'data', 'classification_stats.json');
  fs.writeFileSync(samplePath, JSON.stringify({ mainStats, subStats, total: classified.length }, null, 2), 'utf-8');
  console.log(`통계 저장: ${samplePath}`);
}

main();
