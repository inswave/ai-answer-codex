/**
 * Optional WebSquare MCP context provider.
 *
 * The answer pipeline must keep working when the internal MCP server is
 * unavailable, so every failure is converted into a status object instead of
 * throwing.
 */

const { execFileSync, spawn } = require('child_process');
const fetch = require('node-fetch');
const { loadConfig } = require('../utils/config');
const { maskSensitiveInfo } = require('../utils/masking');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ITEMS = 5;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const MCP_CACHE = new Map();

const COMPONENT_ALIASES = [
  { pattern: /\bgrid\s*view\b|\bgridview\b|\bgridView\b|그리드/i, component: 'gridView' },
  { pattern: /\bgridView\/column\b|\bcolumn\b|컬럼/i, component: 'gridView/column' },
  { pattern: /\bdata\s*list\b|\bdataList\b|데이터리스트/i, component: 'dataList' },
  { pattern: /\bdata\s*map\b|\bdataMap\b|데이터맵/i, component: 'dataMap' },
  { pattern: /\bsubmission\b|서브미션/i, component: 'Submission' },
  { pattern: /\$p\b|openPopup|executeSubmission/i, component: '$p' },
  { pattern: /\bWebSquare\.net\b|\bWebSquare\/net\b/i, component: 'WebSquare/net' },
  { pattern: /\binputCalendar\b|인풋캘린더/i, component: 'inputCalendar' },
  { pattern: /\bautoComplete\b|자동완성/i, component: 'autoComplete' },
  { pattern: /\btabControl\b|탭컨트롤/i, component: 'tabControl' },
  { pattern: /\bwindowContainer\b|윈도우컨테이너|MDI/i, component: 'windowContainer' },
  { pattern: /\bscheduleCalendar\b|스케줄캘린더/i, component: 'scheduleCalendar' },
  { pattern: /\btextarea\b|textArea|텍스트에어리어/i, component: 'textarea' },
  { pattern: /\btextbox\b|textBox|텍스트박스/i, component: 'textbox' },
  { pattern: /\btrigger\b|버튼/i, component: 'trigger' },
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
    const term = searchTerms.find((item) => text.toLowerCase().includes(item.toLowerCase()));
    queries.push({ component, search: term || undefined });
  }

  if (queries.length === 0) {
    for (const term of searchTerms) {
      queries.push({ component: 'gridView', search: term });
    }
  }

  return queries.slice(0, maxItems);
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
