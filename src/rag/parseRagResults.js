const { maskSensitiveInfo } = require('../utils/masking');

const DEFAULT_MIN_MATCH = 45;
const MAX_CONTEXT_CHARS_PER_CASE = 1200;

/**
 * Python searcher.py 출력 파싱 공용 모듈
 *
 * 입력: Python stdout 원본 텍스트
 * 출력: cases 배열 [{rank, title, source, similarity, match, content}]
 */

function parseRagResults(output) {
  if (!output) return [];

  const cases = [];
  const pattern = /^#(\d+)\s+\[(?:최종|유사도):\s*([\d.]+)[^\]]*\]\s*(.*)$/gm;
  let match;

  while ((match = pattern.exec(output)) !== null) {
    const rank = parseInt(match[1], 10);
    const similarityRaw = parseFloat(match[2]);
    const source = match[3].trim();

    const startIdx = match.index + match[0].length;
    const nextMatch = output.indexOf('\n#', startIdx);
    const block = output.slice(startIdx, nextMatch === -1 ? undefined : nextMatch).trim();

    const lines = block.split('\n');
    let title = '';
    let url = '';
    let attachmentDir = '';
    let attachments = [];
    const contentLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('질문:')) {
        title = trimmed.replace('질문:', '').trim();
      } else if (trimmed.startsWith('URL:')) {
        url = trimmed.replace('URL:', '').trim();
      } else if (trimmed.startsWith('AttachmentDir:')) {
        attachmentDir = trimmed.replace('AttachmentDir:', '').trim();
      } else if (trimmed.startsWith('Attachments:')) {
        try {
          attachments = JSON.parse(trimmed.replace('Attachments:', '').trim());
          if (!Array.isArray(attachments)) attachments = [];
        } catch {
          attachments = [];
        }
      } else if (trimmed.startsWith('답변:')) {
        contentLines.push(trimmed.replace('답변:', '').trim());
      } else if (trimmed && trimmed !== '---') {
        contentLines.push(trimmed);
      }
    }

    cases.push({
      rank,
      title: title || `사례 ${rank}`,
      source,
      similarity: `${(similarityRaw * 100).toFixed(1)}%`,
      match: Math.round(similarityRaw * 100),
      url,
      attachmentDir,
      attachments,
      content: contentLines.join('\n').trim() || title,
    });
  }

  return cases;
}

/**
 * 데이터 소스 → W-Tech type 코드 매핑
 */
function getSourceType(source) {
  if (!source) return 'doc';
  const lower = source.toLowerCase();
  if (lower.includes('qna')) return 'board';
  if (lower.includes('faq')) return 'faq';
  if (source.includes('Gmail') || source.includes('메일') || source.includes('이메일')) return 'email';
  if (lower.includes('confluence')) return 'wiki';
  if (lower.includes('api guide') || source.includes('API 가이드') || lower.includes('api')) return 'api-guide';
  if (source.includes('릴리즈') || lower.includes('release')) return 'release-note';
  if (source.includes('가이드') || lower.includes('guide')) return 'guide';
  return 'doc';
}

const DOCS_HOST = 'https://docs.inswave.com/websquare/websquare.html?w2xPath=';

const API_GUIDE_URLS = {
  ai: 'https://docs.inswave.com/support/api/ws5_ai/6.0_0.1550R.20260417.145224/index.html',
  sp5: `${DOCS_HOST}/support/api/ws5_sp5/api.xml`,
  sp4: `${DOCS_HOST}/support/api/ws5_sp4/api.xml`,
  sp3: `${DOCS_HOST}/support/api/ws5_sp3/api.xml`,
  sp2: `${DOCS_HOST}/support/api/w5_sp2/api.xml`,
  sp1: `${DOCS_HOST}/support/api/w5/api.xml`,
  ws2: `${DOCS_HOST}/support/api/w2/api.xml`,
};

const RELEASE_NOTE_URLS = {
  ai: 'https://docs1.inswave.com/ai_release_note',
  sp5: 'https://docs1.inswave.com/sp5_release_note',
  sp4: 'https://docs1.inswave.com/sp4_release_note',
  sp3: 'https://docs1.inswave.com/sp3_release_note',
  sp2: 'https://docs1.inswave.com/sp2_release_note',
  sp1: 'https://docs1.inswave.com/sp1_release_note',
  ws2: 'https://docs1.inswave.com/ws2_release_note',
};

const DEV_GUIDE_URLS = {
  ai: 'https://docs1.inswave.com/ai_user_guide',
  sp5: 'https://docs1.inswave.com/sp5_user_guide',
  sp4: 'https://docs1.inswave.com/sp4_user_guide',
  sp3: 'https://docs1.inswave.com/sp3_user_guide',
  sp2: 'https://docs1.inswave.com/sp2_user_guide',
};

const OTHER_GUIDE_URLS = {
  component: 'https://docs1.inswave.com/component_user_guide',
  wre: 'https://docs1.inswave.com/component_for_wre',
  snippet: 'https://docs1.inswave.com/sp5_snippet_guide',
  publishing: 'https://docs1.inswave.com/sp5_publishing_guide',
  accessibility: 'https://docs1.inswave.com/accessibility',
};

function extractVersion(source) {
  const s = String(source || '');
  if (/websquare2|websquare 2|웹스퀘어2|ws2|w2/i.test(s)) return 'ws2';
  if (/\bAI\b|ws5_ai/i.test(s)) return 'ai';
  if (/SP5|ws5_sp5/i.test(s)) return 'sp5';
  if (/SP4|ws5_sp4/i.test(s)) return 'sp4';
  if (/SP3|ws5_sp3/i.test(s)) return 'sp3';
  if (/SP2|w5_sp2/i.test(s)) return 'sp2';
  if (/SP1|w5\/api|w5_api/i.test(s)) return 'sp1';
  return null;
}

function getDocsUrl(source) {
  const s = String(source || '');
  const lower = s.toLowerCase();
  const version = extractVersion(s);

  if (lower.includes('accessibility') || s.includes('접근성')) return OTHER_GUIDE_URLS.accessibility;
  if (lower.includes('publishing') || s.includes('퍼블리싱')) return OTHER_GUIDE_URLS.publishing;
  if (lower.includes('snippet') || s.includes('스니핏')) return OTHER_GUIDE_URLS.snippet;
  if (lower.includes('wre')) return OTHER_GUIDE_URLS.wre;
  if (lower.includes('component') || s.includes('컴포넌트')) return OTHER_GUIDE_URLS.component;
  if (lower.includes('release') || s.includes('릴리즈')) return RELEASE_NOTE_URLS[version] || '';
  if (lower.includes('api')) return API_GUIDE_URLS[version] || API_GUIDE_URLS.sp5;
  if (lower.includes('guide') || s.includes('가이드')) return DEV_GUIDE_URLS[version] || '';
  return '';
}

function getSourceTitle(c) {
  const type = getSourceType(c.source);
  if (type === 'board') return 'W-Tech';
  if (type === 'faq') return 'W-Tech FAQ';

  const rawTitle = String(c.title || '').trim();
  if (rawTitle && !/^(사례|\?щ?)\s*\d+$/i.test(rawTitle)) {
    return rawTitle;
  }
  return getSafeSourceTitle(c);
}

function maskSourceUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const allowedHosts = [
      'docs.inswave.com',
      'docs1.inswave.com',
      'inswave01.atlassian.net',
    ];

    if (allowedHosts.includes(host)) {
      return value;
    }
  } catch {
    return '';
  }

  return maskSensitiveInfo(value);
}

function getSafeSourceTitle(c) {
  const type = getSourceType(c.source);
  const labelByType = {
    board: 'W-Tech QNA 참고 사례',
    email: '메일 참고 사례',
    wiki: 'Confluence 참고 문서',
    faq: 'FAQ 참고 문서',
    'api-guide': 'API 가이드 참고 문서',
    'release-note': '릴리즈 노트 참고 문서',
    guide: '개발 가이드 참고 문서',
    doc: '참고 문서',
  };

  return labelByType[type] || '참고 문서';
}

/**
 * cases 배열 → W-Tech 표준 sources 구조로 변환
 * [{title, meta, match, url, type}]
 *
 * match: 0-100 정수 (유사도 %)
 * url: 가능한 경우 원본 링크. 현재 searcher.py가 id/url을 노출 안 해서 빈 문자열.
 *      추후 indexer/searcher가 metadata에 id+url을 넣으면 채울 수 있음.
 */
function toSources(cases, options = {}) {
  const includeAttachments = options.includeAttachments === true;

  return cases.map(c => {
    const url = c.url || getDocsUrl(c.source);
    const out = {
      title: maskSensitiveInfo(getSourceTitle(c)),
      meta: maskSensitiveInfo(c.source),
      match: c.match,
      url: maskSourceUrl(url),
      type: getSourceType(c.source),
    };
    // 검증된 개발가이드 샘플만 첨부로 노출한다. Gmail 고객 첨부는 노출하지 않는다.
    if (includeAttachments && isSampleAttachmentCase(c) && Array.isArray(c.attachments) && c.attachments.length > 0) {
      out.attachments = c.attachments.map((a) => ({
        filename: maskSensitiveInfo(a.filename || '', { maskFilenames: false }),
        mimeType: a.mimeType || '',
        size: a.size || 0,
        // 다운로드 URL: /api/attachment?dir={attachmentDir}&filename={filename}
        downloadUrl: c.attachmentDir
          ? `/api/attachment?dir=${encodeURIComponent(c.attachmentDir)}&filename=${encodeURIComponent(a.filename)}`
          : '',
      }));
    }
    return out;
  });
}

function isSampleAttachmentCase(c) {
  return typeof c.attachmentDir === 'string'
    && c.attachmentDir.replace(/\\/g, '/').startsWith('dev-guide-sample/');
}

function toSampleFiles(cases) {
  if (!Array.isArray(cases)) return [];

  const seen = new Set();
  const files = [];

  for (const c of cases) {
    if (!isSampleAttachmentCase(c) || !Array.isArray(c.attachments)) continue;

    for (const a of c.attachments) {
      if (!a || !a.filename) continue;

      const key = `${c.attachmentDir}/${a.filename}`;
      if (seen.has(key)) continue;
      seen.add(key);

      files.push({
        filename: a.filename,
        mimeType: a.mimeType || '',
        size: a.size || 0,
        sourceTitle: getSafeSourceTitle(c),
        downloadUrl: `/api/attachment?dir=${encodeURIComponent(c.attachmentDir)}&filename=${encodeURIComponent(a.filename)}`,
      });
    }
  }

  return files;
}

function filterRagCases(cases, minMatch = DEFAULT_MIN_MATCH) {
  if (!Array.isArray(cases)) return [];
  return cases.filter((c) => Number(c.match || 0) >= minMatch);
}

function buildRagContext(cases, options = {}) {
  const minMatch = options.minMatch ?? DEFAULT_MIN_MATCH;
  const filtered = filterRagCases(cases, minMatch);

  if (filtered.length === 0) {
    return '';
  }

  return filtered.map((c) => {
    const title = getSafeSourceTitle(c);
    const source = maskSensitiveInfo(c.source || '');
    const content = maskSensitiveInfo(c.content || '').slice(0, MAX_CONTEXT_CHARS_PER_CASE);
    return [
      `--- 참고 사례 [유사도: ${c.match}% | 출처: ${source}] ---`,
      `질문: ${title}`,
      `내용: ${content}`,
    ].join('\n');
  }).join('\n\n');
}

/**
 * 신뢰도 계산 — Top-3 유사도 평균
 *
 * @param {Array} cases - parseRagResults 결과
 * @returns {number} 0~100 정수
 */
function calculateConfidence(cases) {
  if (!cases || cases.length === 0) return 0;

  const top3 = cases.slice(0, 3);
  const sum = top3.reduce((acc, c) => acc + c.match, 0);
  return Math.round(sum / top3.length);
}

module.exports = {
  parseRagResults,
  toSources,
  toSampleFiles,
  calculateConfidence,
  getSourceType,
  getSafeSourceTitle,
  filterRagCases,
  buildRagContext,
  DEFAULT_MIN_MATCH,
};
