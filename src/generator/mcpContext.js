/**
 * Optional WebSquare MCP context provider.
 *
 * The answer pipeline must keep working when the internal MCP server is
 * unavailable, so every failure is converted into a status object instead of
 * throwing.
 */

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { loadConfig } = require('../utils/config');
const { maskSensitiveInfo } = require('../utils/masking');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ITEMS = 5;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const MCP_CACHE = new Map();

const COMPONENT_ALIASES = [
  { pattern: /\bgrid\s*view\b|\bgridview\b|\bgridView\b|그리드뷰|그리드/i, component: 'gridView' },
  { pattern: /\bgridView\/column\b|\bcolumn\b|컬럼/i, component: 'gridView/column' },
  { pattern: /\bdata\s*list\b|\bdataList\b|데이터리스트/i, component: 'dataList' },
  { pattern: /\bdata\s*map\b|\bdataMap\b|데이터맵/i, component: 'dataMap' },
  { pattern: /\bsubmission\b|서브미션|서버\s*요청/i, component: 'Submission' },
  { pattern: /\bWebSquare\.net\b|\bWebSquare\/net\b/i, component: 'WebSquare/net' },
  { pattern: /\binputCalendar\b|인풋캘린더|캘린더/i, component: 'inputCalendar' },
  { pattern: /\bautoComplete\b|autocomplate|자동완성/i, component: 'autoComplete' },
  { pattern: /\btabControl\b|tabcontrol|tac_layout|탭컨트롤|탭 컨트롤|메뉴탭/i, component: 'tabControl' },
  { pattern: /\bwindowContainer\b|윈도우컨테이너|MDI/i, component: 'windowContainer' },
  { pattern: /\bscheduleCalendar\b|스케줄캘린더/i, component: 'scheduleCalendar' },
  { pattern: /\btextarea\b|textArea|텍스트에어리어/i, component: 'textarea' },
  { pattern: /\btextbox\b|textBox|텍스트박스/i, component: 'textbox' },
  { pattern: /\btrigger\b|버튼/i, component: 'trigger' },
  // 추가 — 5/26 Phase 2 수집된 컴포넌트
  { pattern: /\bselect\s*box\b|\bselectbox\b|\bselectBox\b|셀렉트박스|셀렉트 박스/i, component: 'selectbox' },
  { pattern: /\btree\s*view\b|\btreeview\b|\btreeView\b|트리뷰|트리 뷰/i, component: 'treeview' },
  { pattern: /\bmulti\s*upload\b|\bmultiupload\b|\bmultiUpload\b|멀티업로드|다중\s*업로드/i, component: 'multiupload' },
  { pattern: /\bwframe\b|\bwFrame\b|\bWFrame\b|와이프레임/i, component: 'wframe' },
  // alias 누락 보강 — 평가에서 미매칭이었던 케이스 대응
  { pattern: /\bgroup\b|그룹\s*(컴포넌트)?|grp_/i, component: 'group' },
  { pattern: /\bfusionchart\b|퓨전차트|퓨전\s*차트/i, component: 'fusionchart' },
  { pattern: /\beditor\b|CKfinder|CKEditor|에디터/i, component: 'editor' },
  // 유틸리티 클래스 — showModal/showProcessMessage 등은 실제로 $p에 속함
  { pattern: /\bWebSquare\.layer\b|\bWebSquare\/layer\b/i, component: 'WebSquare/layer' },
  { pattern: /\bWebSquare\.util\b|\bWebSquare\/util\b/i, component: 'WebSquare/util' },
  { pattern: /\bWebSquare\.xml\b|\bWebSquare\/xml\b/i, component: 'WebSquare/xml' },
  { pattern: /\bWebSquare\.date\b|\bWebSquare\/date\b/i, component: 'WebSquare/date' },
  // Phase 3 (5/27) 추가 — 유틸 4개
  { pattern: /\bWebSquare\.json\b|\bWebSquare\/json\b/i, component: 'WebSquare/json' },
  { pattern: /\bWebSquare\.cookie\b|\bWebSquare\/cookie\b|쿠키/i, component: 'WebSquare/cookie' },
  { pattern: /\bWebSquare\.logger\b|\bWebSquare\/logger\b|로거/i, component: 'WebSquare/logger' },
  { pattern: /\bWebSquare\.style\b|\bWebSquare\/style\b/i, component: 'WebSquare/style' },
  { pattern: /\$p\.data\b|\$p\/data\b/i, component: '$p/data' },
  // Phase 3 (5/27) 추가 — 입력 8개
  { pattern: /\bcheckbox\b|체크박스|체크 박스/i, component: 'checkbox' },
  { pattern: /\bradio\b|라디오\s*(버튼)?/i, component: 'radio' },
  { pattern: /\bmultiselect\b|multiSelect|멀티셀렉트|다중\s*선택/i, component: 'multiselect' },
  { pattern: /\bsearchbox\b|searchBox|서치박스|검색박스/i, component: 'searchbox' },
  { pattern: /\bsecret\b|시크릿|비밀번호\s*(입력)?|패스워드/i, component: 'secret' },
  { pattern: /\bfloatingLayer\b|floating\s*layer|플로팅\s*레이어|플로팅레이어/i, component: 'floatingLayer' },
  // input은 'input' 단어가 너무 흔해 위험. inputType/input box는 제외하고 컴포넌트 명시만 매칭
  { pattern: /<(?:xf:|w2:)input\b|\binput\s*컴포넌트|\binput[12]\b/i, component: 'input' },
  // Phase 3 (5/27) 추가 — 컨테이너 3개
  { pattern: /\bnameLayer\b|nameLayer|네임\s*레이어|선택영역|nameLayer 영역/i, component: 'nameLayer' },
  { pattern: /\bgridLayout\b|gridLayout|그리드\s*레이아웃/i, component: 'gridLayout' },
  { pattern: /\bscrollView\b|scrollView|스크롤\s*뷰/i, component: 'scrollView' },
  // Phase 3 (5/27) 추가 — 캘린더 2개 (scheduleCalendar는 위쪽에 이미 있음)
  { pattern: /\bdatePicker\b|datePicker|날짜\s*선택기|데이트피커/i, component: 'datePicker' },
  { pattern: /\bcalendar\b(?!.*input|.*schedule)|캘린더(?!\s*(인풋|스케줄))/i, component: 'calendar' },
  // Phase 3 (5/27) 추가 — 차트 8개
  // 주의: fw*Chart 들은 'chart' 단어를 포함하므로, 구체적인 fw*Chart alias가 먼저 매칭되도록 순서 중요
  { pattern: /\bmapchart\b|mapChart|지도\s*차트|맵\s*차트/i, component: 'mapchart' },
  { pattern: /\bfwGanttChart\b|fwGantt|간트\s*차트|gantt\s*chart/i, component: 'fwGanttChart' },
  { pattern: /\bfwBulletChart\b|fwBullet|불릿\s*차트|bullet\s*chart/i, component: 'fwBulletChart' },
  { pattern: /\bfwFunnelChart\b|fwFunnel|퍼널\s*차트|funnel\s*chart/i, component: 'fwFunnelChart' },
  { pattern: /\bfwGaugeChart\b|fwGauge|게이지\s*차트|gauge\s*chart/i, component: 'fwGaugeChart' },
  { pattern: /\bfwPyramidChart\b|fwPyramid|피라미드\s*차트|pyramid\s*chart/i, component: 'fwPyramidChart' },
  { pattern: /\bfwRealtimeChart\b|fwRealtime|실시간\s*차트|realtime\s*chart/i, component: 'fwRealtimeChart' },
  { pattern: /\bfwSparkChart\b|fwSpark|스파크\s*차트|spark\s*chart/i, component: 'fwSparkChart' },
  // 서브컴포넌트
  { pattern: /\bgridView\/column\b|gridView\s*컬럼/i, component: 'gridView/column' },
  { pattern: /\bdataList\/column\b|dataList\s*컬럼/i, component: 'dataList/column' },
  { pattern: /\bgridView\/header\b|gridView\s*헤더/i, component: 'gridView/header' },
  { pattern: /\bgridView\/footer\b|gridView\s*푸터/i, component: 'gridView/footer' },
  { pattern: /\bgridView\/row\b|gridView\s*(행|로우)/i, component: 'gridView/row' },
  { pattern: /\bgridView\/filterColumn\b|filterColumn/i, component: 'gridView/filterColumn' },
  { pattern: /\bgridView\/subTotal\b|subTotal|부분합/i, component: 'gridView/subTotal' },
  { pattern: /\bgridView\/gBody\b|gBody/i, component: 'gridView/gBody' },
  // '$p'는 가장 generic이라 맨 아래(구체 alias 뒤)에 위치 — $p/data 등이 먼저 매칭되도록.
  // [2026-06-01] 5/27에 상세 $p alias를 "이동"하려다 "삭제"만 된 회귀 복원(버그 A: 메서드 키워드 매칭 소실).
  { pattern: /\$p\b|openPopup|executeSubmission|openMenu|getParameter|setParameter|getValueObj|showProcessMessage|showModal|hideProcessMessage|hideModal/i, component: '$p' },
];

const STOP_TERMS = new Set([
  'WebSquare', 'GridView', 'DataList', 'DataMap', 'String', 'Number',
  'Boolean', 'Object', 'Array', 'JSON', 'XML',
]);

function isEnabled(value) {
  if (value === true) return true;
  if (typeof value === 'string') return /^(1|true|yes|on)$/i.test(value);
  return false;
}

function getMcpConfig(options = {}) {
  const fullConfig = loadConfig();
  const config = {
    ...(fullConfig.mcp || {}),
    ...(options.mcp || {}),
  };

  const envEnabled = process.env.ENABLE_MCP_CONTEXT;
  if (envEnabled !== undefined) config.enabled = isEnabled(envEnabled);
  if (process.env.MCP_CONTEXT_PROVIDER) config.provider = process.env.MCP_CONTEXT_PROVIDER;
  if (process.env.MCP_CONTEXT_COMMAND) config.command = process.env.MCP_CONTEXT_COMMAND;
  if (process.env.MCP_CONTEXT_ENDPOINT) config.endpoint = process.env.MCP_CONTEXT_ENDPOINT;

  config.enabled = isEnabled(config.enabled);
  config.provider = config.provider || 'stdio';
  config.timeoutMs = Number(config.timeoutMs || DEFAULT_TIMEOUT_MS);
  config.maxItems = Number(config.maxItems || DEFAULT_MAX_ITEMS);
  config.cacheTtlMs = Number(config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  return config;
}

function extractComponents(text) {
  const found = [];
  const seen = new Set();

  for (const alias of COMPONENT_ALIASES) {
    if (alias.pattern.test(text) && !seen.has(alias.component)) {
      seen.add(alias.component);
      found.push(alias.component);
    }
  }

  return found;
}

function extractSearchTerms(text) {
  const found = [];
  const seen = new Set();
  const patterns = [
    /\b([a-z][A-Za-z0-9_]{3,})\s*\(/g,
    /\b(inputType|expression|spanAll|showDepth|drilldown|displayFormatter|customFormatter|rowIndex|getRealRowIndex)\b/g,
    /inputType\s*=\s*["']?([a-zA-Z]+)["']?/g,
    /\b([a-z]+(?:[A-Z][A-Za-z0-9]+){1,})\b/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1];
      if (!term || STOP_TERMS.has(term) || seen.has(term)) continue;
      seen.add(term);
      found.push(term);
    }
  }

  return found.slice(0, 8);
}

function buildQueries(question, ragCases, maxItems) {
  const ragText = Array.isArray(ragCases)
    ? ragCases.slice(0, 3).map((item) => [item.title, item.content].filter(Boolean).join('\n')).join('\n\n')
    : '';
  const text = [question, ragText].filter(Boolean).join('\n\n');
  const components = extractComponents(text);
  const searchTerms = extractSearchTerms(text);
  const queries = [];

  for (const component of components) {
    // 검색어가 컴포넌트명 자체와 같으면(또는 컴포넌트명을 포함하면) 의미 없으므로 제외
    const compLower = component.toLowerCase();
    const compLast = compLower.split('/').pop();
    const term = searchTerms.find((item) => {
      const it = item.toLowerCase();
      if (it === compLower || it === compLast) return false;
      return text.toLowerCase().includes(it);
    });
    queries.push({ component, search: term || undefined });
  }

  // 컴포넌트 매칭 0건일 때:
  //  - 옛 동작: 무조건 gridView로 fallback (다른 컴포넌트 질문에 잘못된 매칭)
  //  - 새 동작: RAG top1 source에서 컴포넌트 추정. 추정 못 하면 빈 결과 반환 (graceful).
  if (queries.length === 0 && Array.isArray(ragCases) && ragCases.length > 0) {
    const inferred = inferComponentFromRagSource(ragCases[0]);
    if (inferred) {
      const term = searchTerms.find((item) => {
        const it = item.toLowerCase();
        return it !== inferred.toLowerCase() && text.toLowerCase().includes(it);
      });
      queries.push({ component: inferred, search: term || undefined });
    }
  }

  return queries.slice(0, maxItems);
}

/**
 * RAG top1 case의 source/title에서 컴포넌트명 추정.
 * 예: source="WebSquare API Guide (AI)" + title="gridView.setCellData ..." → 'gridView'
 */
function inferComponentFromRagSource(ragCase) {
  if (!ragCase) return null;
  const haystack = [ragCase.title, ragCase.source, ragCase.content?.slice(0, 200)]
    .filter(Boolean)
    .join(' ');
  for (const alias of COMPONENT_ALIASES) {
    if (alias.pattern.test(haystack)) return alias.component;
  }
  return null;
}

function parseProviderResponse(output) {
  const text = String(output || '').trim();
  if (!text) return '';

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed.content)) {
      return parsed.content.map((item) => item.text || '').filter(Boolean).join('\n\n');
    }
    if (Array.isArray(parsed)) {
      return parsed.map((item) => item.text || item.content || '').filter(Boolean).join('\n\n');
    }
    return parsed.text || parsed.content || text;
  } catch {
    return text;
  }
}

function queryByCommand(config, request) {
  if (!config.command) {
    return { ok: false, error: 'MCP command is not configured.' };
  }

  const args = Array.isArray(config.args) ? [...config.args] : [];
  args.push(JSON.stringify(request));

  const output = execFileSync(config.command, args, {
    encoding: 'utf8',
    timeout: config.timeoutMs,
    env: { ...process.env },
  });

  return { ok: true, text: parseProviderResponse(output) };
}

function encodeMcpMessage(payload) {
  return Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
}

function extractMcpMessages(buffer) {
  const messages = [];
  let rest = buffer;

  while (rest.length > 0) {
    const lineEnd = rest.indexOf('\n');
    if (lineEnd === -1) break;
    const line = rest.slice(0, lineEnd).toString('utf8').replace(/\r$/, '').trim();
    rest = rest.slice(lineEnd + 1);
    if (!line) continue;
    try {
      messages.push(JSON.parse(line));
      continue;
    } catch {
      // Fall through to the content-length parser for older transports.
      rest = Buffer.concat([Buffer.from(`${line}\n`, 'utf8'), rest]);
      break;
    }
  }

  if (messages.length > 0) {
    return { messages, rest };
  }

  while (rest.length > 0) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = rest.slice(0, headerEnd).toString('utf8');
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      const nextHeader = rest.indexOf('Content-Length:', 1, 'utf8');
      if (nextHeader === -1) break;
      rest = rest.slice(nextHeader);
      continue;
    }

    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (rest.length < bodyEnd) break;

    const rawBody = rest.slice(bodyStart, bodyEnd).toString('utf8');
    try {
      messages.push(JSON.parse(rawBody));
    } catch {
      // Ignore malformed frames and keep parsing subsequent frames.
    }
    rest = rest.slice(bodyEnd);
  }

  return { messages, rest };
}

function normalizeMcpToolText(result) {
  const content = result?.content || result?.result?.content;
  if (Array.isArray(content)) {
    return content.map((item) => item.text || '').filter(Boolean).join('\n\n');
  }
  return parseProviderResponse(result?.text || result?.content || result);
}

function callStdioMcp(config, request) {
  return new Promise((resolve) => {
    if (!config.command) {
      resolve({ ok: false, error: 'MCP stdio command is not configured.' });
      return;
    }

    const child = spawn(config.command, Array.isArray(config.args) ? config.args : [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    });

    let stdoutBuffer = Buffer.alloc(0);
    let stderr = '';
    let nextId = 1;
    let stage = 'initialize';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
      resolve(result);
    };

    const send = (method, params, id) => {
      const payload = id
        ? { jsonrpc: '2.0', id, method, params }
        : { jsonrpc: '2.0', method, params };
      child.stdin.write(encodeMcpMessage(payload));
    };

    const initializeId = nextId++;
    const toolCallId = nextId++;
    const timer = setTimeout(() => {
      finish({ ok: false, error: `MCP stdio timeout after ${config.timeoutMs}ms${stderr ? `: ${stderr.slice(0, 300)}` : ''}` });
    }, config.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
      const parsed = extractMcpMessages(stdoutBuffer);
      stdoutBuffer = parsed.rest;

      for (const message of parsed.messages) {
        if (message.id === initializeId && stage === 'initialize') {
          stage = 'tool';
          send('notifications/initialized', {});
          send('tools/call', {
            name: request.tool,
            arguments: request.arguments || {},
          }, toolCallId);
          continue;
        }

        if (message.id === toolCallId) {
          if (message.error) {
            finish({ ok: false, error: message.error.message || JSON.stringify(message.error) });
            return;
          }
          finish({ ok: true, text: normalizeMcpToolText(message.result) });
          return;
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      finish({ ok: false, error: err.message });
    });

    child.on('exit', (code) => {
      if (!settled) {
        finish({ ok: false, error: `MCP stdio process exited with ${code}${stderr ? `: ${stderr.slice(0, 300)}` : ''}` });
      }
    });

    send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'techassistant',
        version: '1.0.0',
      },
    }, initializeId);
  });
}

async function queryByHttp(config, request) {
  if (!config.endpoint) {
    return { ok: false, error: 'MCP endpoint is not configured.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.headers || {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `MCP HTTP ${response.status}` };
    }

    return { ok: true, text: parseProviderResponse(await response.text()) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Static-file provider: 사내 MCP 서버에서 미리 수집한 스펙을
 * data/processed/mcp_specs/{component}/{section}.md 파일로 읽어 반환.
 *
 * - sourceDir: 기본 ./data/processed/mcp_specs
 * - search 키워드가 있으면 해당 메서드/속성/이벤트 섹션만 추출
 * - 없으면 methods.md 전체 (단, maxBytes로 제한)
 */
function queryByStatic(config, request) {
  const baseDir = config.staticDir
    ? path.resolve(config.staticDir)
    : path.resolve(__dirname, '../../data/processed/mcp_specs');
  const maxBytes = Number(config.staticMaxBytes || 4000);
  const component = String(request.arguments?.component || '').trim();
  const search = String(request.arguments?.search || '').trim();
  if (!component) return { ok: false, error: 'static: empty component' };

  // search 키워드가 컴포넌트명 자체면 무시 (일반 overview 반환)
  const effectiveSearch = search && search.toLowerCase() !== component.toLowerCase()
    ? search
    : '';

  const componentDir = path.join(baseDir, component);
  if (!fs.existsSync(componentDir)) {
    return { ok: false, error: `static: no spec for ${component}` };
  }

  const sectionFiles = ['methods.md', 'properties.md', 'events.md'];
  const candidates = [];
  for (const f of sectionFiles) {
    const p = path.join(componentDir, f);
    if (fs.existsSync(p)) candidates.push({ section: f.replace('.md', ''), path: p });
  }
  if (candidates.length === 0) {
    return { ok: false, error: `static: no spec files in ${componentDir}` };
  }

  const blocks = [];
  for (const cand of candidates) {
    const content = fs.readFileSync(cand.path, 'utf8');
    if (effectiveSearch) {
      // 검색어 들어간 섹션(`## name` 또는 `### name`)만 추출
      // - Agent 압축 시 일부 컴포넌트는 ### 헤더로 저장됨
      const sectionRe = /(^#{2,3} [^\n]+\n[\s\S]*?)(?=^#{2,3} |^---\n*$|\Z)/gm;
      let m;
      while ((m = sectionRe.exec(content)) !== null) {
        const block = m[1];
        // 헤더 또는 본문 처음 500자에 검색어 있으면 매칭
        const header = block.split('\n', 1)[0].toLowerCase();
        const headBody = block.slice(0, 500).toLowerCase();
        if (header.includes(effectiveSearch.toLowerCase())
            || headBody.includes(effectiveSearch.toLowerCase())) {
          blocks.push(`[${component}.${cand.section}]\n${block.slice(0, 1500).trim()}`);
          if (blocks.length >= 3) break;
        }
      }
      if (blocks.length >= 3) break;
    } else {
      // search 없으면 첫 N자만
      blocks.push(`[${component}.${cand.section}]\n${content.slice(0, maxBytes).trim()}`);
    }
  }

  if (blocks.length === 0) {
    return { ok: false, error: `static: no match for "${effectiveSearch}" in ${component}` };
  }

  return { ok: true, text: blocks.join('\n\n').slice(0, 12000) };
}

async function queryMcp(config, query) {
  const request = {
    tool: 'get_component',
    arguments: {
      component: query.component,
      search: query.search,
    },
  };
  const cacheKey = JSON.stringify({
    provider: config.provider,
    command: config.command,
    endpoint: config.endpoint,
    request,
  });
  const cached = MCP_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  let result;
  if (config.provider === 'stdio') {
    result = await callStdioMcp(config, request);
  } else if (config.provider === 'http') {
    result = await queryByHttp(config, request);
  } else if (config.provider === 'static') {
    result = queryByStatic(config, request);
  } else {
    result = queryByCommand(config, request);
  }

  if (result.ok && config.cacheTtlMs > 0) {
    MCP_CACHE.set(cacheKey, {
      expiresAt: Date.now() + config.cacheTtlMs,
      result,
    });
  }
  return result;
}

function formatContext(items) {
  if (!items.length) return '';

  const parts = items.map((item) => {
    const title = item.search
      ? `${item.component}.${item.search}`
      : item.component;
    return [
      `--- MCP 공식 스펙 [${title}] ---`,
      maskSensitiveInfo(item.text).slice(0, 2000),
    ].join('\n');
  });

  return ['## WebSquare MCP 공식 스펙', ...parts].join('\n\n');
}

async function buildMcpContext(question, ragCases = [], options = {}) {
  const config = getMcpConfig(options);
  if (!config.enabled) {
    return {
      enabled: false,
      available: false,
      context: '',
      items: [],
      errors: [],
      sources: [],
    };
  }

  const queries = buildQueries(question, ragCases, config.maxItems);
  if (queries.length === 0) {
    return {
      enabled: true,
      available: false,
      context: '',
      items: [],
      errors: ['No MCP lookup candidates found.'],
      sources: [],
    };
  }

  const items = [];
  const errors = [];

  for (const query of queries) {
    try {
      const result = await queryMcp(config, query);
      if (result.ok && result.text) {
        items.push({ ...query, text: result.text });
      } else if (result.error) {
        errors.push(result.error);
      }
    } catch (err) {
      errors.push(err.message);
    }
  }

  return {
    enabled: true,
    available: items.length > 0,
    context: formatContext(items),
    items: items.map(({ text, ...item }) => item),
    errors,
    sources: items.length > 0 ? ['MCP'] : [],
  };
}

module.exports = {
  buildMcpContext,
  buildQueries,
  extractComponents,
  extractSearchTerms,
};
