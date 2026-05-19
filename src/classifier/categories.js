/**
 * 13 × 56 자동 분류 체계 정의
 * 대분류 13개, 소분류 56개
 */

const CATEGORIES = {
  gridview: {
    label: 'GridView',
    subcategories: {
      cell_column: '셀/컬럼 설정',
      excel_download: '엑셀 다운로드',
      excel_upload: '엑셀 업로드',
      sort_filter: '정렬/필터',
      merge: '셀 병합',
      event: '이벤트',
      style: '스타일/CSS',
      data_binding: '데이터 바인딩',
      paging: '페이징',
      selection: '선택/체크',
      edit: '편집',
      etc: '기타',
    },
    patterns: [
      /grid\s*view/i, /gridview/i, /그리드\s*뷰/,
      /셀\s*병합/, /merge\s*cell/i,
      /컬럼\s*설정/, /column/i,
      /행\s*추가/, /행\s*삭제/,
    ],
  },

  engine: {
    label: '엔진/설정',
    subcategories: {
      version: '버전/업그레이드',
      studio: 'Studio',
      config: '환경설정',
      build: '빌드/배포',
      performance: '성능',
      error: '오류/에러',
      migration: '마이그레이션',
      etc: '기타',
    },
    patterns: [
      /엔진/, /engine/i, /websquare/i, /웹스퀘어/,
      /설정/, /config/i, /studio/i,
      /버전/, /version/i, /업그레이드/, /upgrade/i,
      /빌드/, /배포/, /deploy/i,
    ],
  },

  input: {
    label: '입력 컴포넌트',
    subcategories: {
      input: 'Input',
      selectbox: 'SelectBox',
      calendar: 'Calendar',
      checkbox: 'CheckBox/Radio',
      textarea: 'TextArea',
      autocomplete: 'AutoComplete',
      etc: '기타',
    },
    patterns: [
      /input\s*box/i, /inputbox/i, /입력/,
      /select\s*box/i, /selectbox/i, /셀렉트/,
      /calendar/i, /캘린더/, /달력/, /날짜/,
      /check\s*box/i, /checkbox/i, /체크\s*박스/,
      /radio/i, /라디오/,
      /text\s*area/i, /textarea/i,
      /auto\s*complete/i, /자동\s*완성/,
    ],
  },

  layout: {
    label: '레이아웃/화면',
    subcategories: {
      popup: 'Popup/Window',
      tab: 'Tab',
      generator: 'Generator',
      page_navigation: '페이지 이동',
      responsive: '반응형',
      etc: '기타',
    },
    patterns: [
      /popup/i, /팝업/, /window\s*open/i,
      /tab\s*control/i, /탭/,
      /generator/i, /제너레이터/,
      /layout/i, /레이아웃/,
      /화면\s*이동/, /페이지\s*이동/,
    ],
  },

  data: {
    label: '데이터 처리',
    subcategories: {
      dataset: 'DataSet/DataList',
      submission: 'Submission',
      ajax: 'Ajax/통신',
      json: 'JSON 처리',
      xml: 'XML 처리',
      etc: '기타',
    },
    patterns: [
      /data\s*set/i, /dataset/i, /데이터\s*셋/,
      /data\s*list/i, /datalist/i,
      /submission/i, /서브미션/,
      /ajax/i, /통신/, /요청/,
      /json/i, /xml/i,
    ],
  },

  excel: {
    label: '엑셀 처리',
    subcategories: {
      download: '다운로드',
      upload: '업로드',
      format: '서식/포맷',
      poi: 'POI 관련',
      error: '오류',
      etc: '기타',
    },
    patterns: [
      /엑셀/, /excel/i, /xlsx/i, /xls/i,
      /poi/i, /export\s*excel/i,
      /다운로드.*엑셀/, /엑셀.*다운로드/,
      /업로드.*엑셀/, /엑셀.*업로드/,
    ],
  },

  license: {
    label: '라이선스',
    subcategories: {
      apply: '적용/설치',
      renewal: '갱신',
      error: '오류',
      demo: '데모/평가',
      etc: '기타',
    },
    patterns: [
      /라이선스/, /license/i, /라이센스/,
      /인증/, /키\s*발급/, /평가\s*판/,
    ],
  },

  security: {
    label: '보안',
    subcategories: {
      xss: 'XSS/보안필터',
      auth: '인증/세션',
      encryption: '암호화',
      etc: '기타',
    },
    patterns: [
      /보안/, /security/i, /xss/i,
      /세션/, /session/i, /인증/, /auth/i,
      /암호화/, /encrypt/i,
    ],
  },

  hybrid: {
    label: '하이브리드/모바일',
    subcategories: {
      app: '앱 연동',
      webview: 'WebView',
      device: '디바이스',
      etc: '기타',
    },
    patterns: [
      /하이브리드/, /hybrid/i, /모바일/, /mobile/i,
      /webview/i, /웹뷰/, /앱\s*연동/,
      /android/i, /ios/i, /안드로이드/,
    ],
  },

  publishing: {
    label: '퍼블리싱/접근성',
    subcategories: {
      css: 'CSS/스타일',
      accessibility: '접근성(WAI-ARIA)',
      crossbrowser: '크로스브라우저',
      etc: '기타',
    },
    patterns: [
      /퍼블리싱/, /css/i, /스타일/,
      /접근성/, /accessibility/i, /wai/i, /aria/i,
      /크로스\s*브라우저/, /ie/i, /브라우저\s*호환/,
    ],
  },

  servlet: {
    label: 'Servlet/서버',
    subcategories: {
      jakarta: 'Jakarta(servlet5)',
      fileupload: '파일업로드',
      filter: '필터/인터셉터',
      etc: '기타',
    },
    patterns: [
      /servlet/i, /서블릿/, /jakarta/i,
      /파일\s*업로드/, /file\s*upload/i,
      /commons-fileupload/i, /multipart/i,
      /필터/, /filter/i, /인터셉터/, /interceptor/i,
    ],
  },

  chart: {
    label: '차트/리포트',
    subcategories: {
      chart: '차트',
      report: '리포트/인쇄',
      etc: '기타',
    },
    patterns: [
      /차트/, /chart/i, /그래프/, /graph/i,
      /리포트/, /report/i, /인쇄/, /print/i,
    ],
  },

  etc: {
    label: '기타',
    subcategories: {
      general: '일반 문의',
      etc: '기타',
    },
    patterns: [],
  },
};

module.exports = CATEGORIES;
