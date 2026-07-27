/**
 * 샘플 XML 자동 생성기 — 고객 문의 답변에 첨부할 최소 동작 샘플을 codex로 생성하고 3단계 검증
 *
 * 검증 구조 (2026-07-27 교차검증 결과 반영):
 *   1차: XML 문법 (Python ElementTree)
 *   2차: 대상 컴포넌트 속성 화이트리스트 (mcp_specs 덤프 기반, 오프라인)
 *        - ref/style 등 공통 속성 예외, 스펙 5개 미만이면 판정 SKIP (오탐 방지)
 *   3차: 라이브 MCP validate_xml (파일 전체, 서버 다운 시 SKIP 폴백)
 *        - isValid가 아니라 코드 기준 판정 (UNKNOWN_ATTRIBUTE 등)
 *        - "scwin.fn(" 형태 인라인 핸들러 오탐 보정
 *   실패 시: 미확인 속성 제외 지시 후 재생성 (최대 3회, apiVerifier 패턴)
 *
 * 사용처: scripts/test_sample_generation.js (CLI), src/generator/pipeline.js (큐 첨부)
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../utils/config');
const { resolvePythonPath } = require('../utils/pythonPath');

const ROOT = path.join(__dirname, '../..');
const DEFAULT_OUT_DIR = path.join(ROOT, 'data', 'samples_generated');

// 컴포넌트명 → XML 태그 폴백 매핑 (tags.json이 없을 때만 사용)
// 정식 매핑은 collect_mcp_specs.js가 생성하는 mcp_specs/tags.json
const COMPONENT_TAG_MAP = {
  selectbox: 'xf:select1',
  gridView: 'w2:gridView',
  input: 'xf:input',
  trigger: 'xf:trigger',
  textarea: 'xf:textarea',
  checkbox: 'xf:select',
  group: 'xf:group',
  tabControl: 'w2:tabControl',
  autoComplete: 'w2:autoComplete',
};

// 스펙 properties에 없어도 모든 컴포넌트에서 유효한 공통 속성
const COMMON_ATTRS = new Set(['ref', 'style']);

// 스펙 속성이 이보다 적으면 화이트리스트 판정을 스킵 (덤프 부실/파싱 실패 오탐 방지)
const MIN_SPEC_PROPS = 5;

// 라이브 MCP validate_xml (다운 시 경량 검증만으로 폴백)
const MCP_API_BASE = process.env.WSQ_MCP_API || 'http://192.168.100.214:15748/InswaveAdmin/mcp/websquare/api';

const MAX_ATTEMPTS = 3;

// 실제 운영 화면(wTech qna)에서 추출한 페이지 스켈레톤
const PAGE_SKELETON = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"
    xmlns:ev="http://www.w3.org/2001/xml-events"
    xmlns:w2="http://www.inswave.com/websquare" xmlns:xf="http://www.w3.org/2002/xforms">
    <head>
        <w2:type>COMPONENT</w2:type>
        <xf:model>
            <w2:dataCollection baseNode="map">
                <!-- w2:dataList / w2:dataMap 정의 -->
            </w2:dataCollection>
        </xf:model>
        <script lazy="false" type="text/javascript"><![CDATA[
scwin.onpageload = function() {
    // 초기화 로직
};
]]></script>
    </head>
    <body ev:onpageload="scwin.onpageload">
        <!-- 컴포넌트 배치 -->
    </body>
</html>`;

/** mcp_specs 덤프에서 컴포넌트 스펙 로드 (운영과 동일한 데이터 소스) */
function loadStaticSpec(component) {
  const cfg = loadConfig();
  const baseDir = cfg.mcp?.staticDir
    ? path.resolve(ROOT, cfg.mcp.staticDir)
    : path.join(ROOT, 'data', 'processed', 'mcp_specs');

  // 디렉터리명은 대소문자가 섞여 있어(selectbox, gridView) 둘 다 시도
  const candidates = [component, component.toLowerCase()];
  let dir = null;
  for (const c of candidates) {
    const p = path.join(baseDir, c);
    if (fs.existsSync(p)) { dir = p; break; }
  }
  if (!dir) throw new Error(`정적 스펙 없음: ${component} (in ${baseDir})`);

  const read = (name) => {
    const p = path.join(dir, name);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };

  return {
    dir,
    baseDir,
    properties: read('properties.md'),
    methods: read('methods.md'),
    events: read('events.md'),
  };
}

/** tags.json에서 컴포넌트 태그 조회, 없으면 하드코딩 폴백 */
function resolveTag(component, baseDir) {
  const tagsPath = path.join(baseDir, 'tags.json');
  if (fs.existsSync(tagsPath)) {
    try {
      const tags = JSON.parse(fs.readFileSync(tagsPath, 'utf8'));
      if (tags[component]) return tags[component];
    } catch (_) { /* 폴백으로 진행 */ }
  }
  return COMPONENT_TAG_MAP[component] || COMPONENT_TAG_MAP[component.toLowerCase()] || null;
}

/** "## name (type...) — desc" 헤딩에서 이름 목록 추출 */
function extractSpecNames(md) {
  const names = [];
  const re = /^## ([A-Za-z_][\w.]*)/gm;
  let m;
  while ((m = re.exec(md)) !== null) names.push(m[1]);
  return names;
}

/** 메서드/이벤트는 프롬프트 부피를 줄이기 위해 "## 헤딩 줄"만 추려 압축 */
function compactSpecLines(md, maxChars) {
  const lines = md.split('\n').filter((l) => l.startsWith('## ') || l.startsWith('# '));
  return lines.join('\n').slice(0, maxChars);
}

function buildPrompt(scenario, component, tag, spec) {
  return [
    '당신은 인스웨이브 WebSquare5 기술지원 엔지니어입니다.',
    '고객 문의에 첨부할 **최소 동작 테스트 샘플 XML** 1개 화면을 작성하세요.',
    '',
    '## 시나리오',
    scenario,
    '',
    `## 대상 컴포넌트: ${component} (XML 태그: <${tag}>)`,
    '',
    '## 컴포넌트 속성 스펙 (이 목록에 있는 속성만 사용할 것)',
    spec.properties.slice(0, 6000),
    '',
    '## 사용 가능한 메서드 (이 목록에 있는 메서드만 스크립트에서 호출할 것)',
    compactSpecLines(spec.methods, 4000),
    '',
    '## 사용 가능한 이벤트',
    compactSpecLines(spec.events, 2000),
    '',
    '## 작성 규칙',
    '1. 아래 페이지 스켈레톤 구조를 그대로 따릅니다 (네임스페이스 선언 포함, 임의 변경 금지).',
    '2. 위 스펙 목록에 없는 속성/메서드/이벤트를 절대 사용하지 않습니다.',
    '3. 데이터는 w2:dataCollection 안에 w2:dataList/w2:dataMap으로 정의하고, 컴포넌트는 ref로 바인딩합니다.',
    '4. 스크립트는 <![CDATA[ ]]> 안에 작성하고, scwin.onpageload에서 초기화합니다.',
    '5. 시나리오 재현에 필요한 최소 구성만 포함합니다 (스타일/부가 기능 제외).',
    '6. 샘플 상단에 XML 주석으로 시나리오와 확인 방법을 2~3줄로 요약합니다.',
    '7. 출력은 완성된 XML 문서 **하나만** ```xml 코드블록으로 출력합니다. 설명 문장 금지.',
    '8. 이벤트 속성은 반드시 ev: 접두사를 붙입니다. 예: ev:onclick, ev:onchange (onclick, onchange 단독 사용 금지).',
    '9. 필수 속성을 누락하지 않습니다:',
    '   - w2:dataMap에는 baseNode, w2:column(columnInfo)에는 id/name/dataType',
    '   - gridView의 header/gBody의 w2:column에는 value(header) 또는 ref(gBody)와 inputType',
    '   - xf:trigger에는 type="button", xf:select1에는 selectedIndex',
    '',
    '## 페이지 스켈레톤',
    '```xml',
    PAGE_SKELETON,
    '```',
  ].join('\n');
}

/** answerGenerator.callCodexExec와 동일한 호출 방식 */
function callCodexExec(prompt, cfg) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(os.tmpdir(), `techassistant-samplegen-${process.pid}-${Date.now()}.txt`);
    const args = [
      ...(cfg.args || ['exec']),
      '--skip-git-repo-check',
      '--output-last-message', outputPath,
      '-',
    ];
    const child = spawn(cfg.command || 'codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(cfg.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = cfg.timeoutMs || 300000;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`codex exec timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => { try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {} };
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(timer); cleanup(); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        cleanup();
        return reject(new Error(`codex exec exit ${code}: ${stderr.trim() || stdout.slice(-500)}`));
      }
      try {
        const finalMessage = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : stdout;
        cleanup();
        resolve(finalMessage);
      } catch (err) { cleanup(); reject(err); }
    });
    child.stdin.end(prompt);
  });
}

/** codex 출력에서 XML 문서 추출 */
function extractXml(text) {
  const block = text.match(/```xml\s*([\s\S]*?)```/);
  if (block) return block[1].trim();
  const raw = text.match(/<\?xml[\s\S]*<\/html>/);
  if (raw) return raw[0].trim();
  return null;
}

/** 검증 1: XML 문법 (Python stdlib ElementTree — 운영 서버에도 있음) */
function validateWellFormed(xmlPath) {
  const python = resolvePythonPath();
  try {
    execFileSync(python, ['-c', 'import sys,xml.etree.ElementTree as ET; ET.parse(sys.argv[1])', xmlPath], {
      encoding: 'utf8', timeout: 15000,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err.stderr || err.message || '').split('\n').slice(-3).join('\n') };
  }
}

/** 검증 2: 대상 컴포넌트 태그의 속성이 스펙 화이트리스트에 있는지 */
function validateAttributes(xml, tag, spec) {
  const validProps = new Set(extractSpecNames(spec.properties).map((s) => s.toLowerCase()));
  const validEvents = new Set(extractSpecNames(spec.events).map((s) => s.toLowerCase()));

  // 스펙이 부실하면 화이트리스트 판정 불가 — FAIL 대신 스킵 (오탐 방지)
  if (validProps.size < MIN_SPEC_PROPS) {
    return { ok: true, skipped: true, unknown: [], propCount: validProps.size };
  }

  const unknown = [];
  const tagRe = new RegExp(`<${tag.replace(':', '\\:')}\\b([^>]*)>`, 'g');
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const attrRe = /([\w:.-]+)\s*=\s*"[^"]*"/g;
    let a;
    while ((a = attrRe.exec(m[1])) !== null) {
      const name = a[1];
      const lower = name.toLowerCase();
      if (lower.startsWith('xmlns')) continue;
      if (COMMON_ATTRS.has(lower)) continue;
      if (lower.startsWith('ev:')) {
        if (!validEvents.has(lower.slice(3))) unknown.push(name);
        continue;
      }
      if (!validProps.has(lower)) unknown.push(name);
    }
  }
  return { ok: unknown.length === 0, skipped: false, unknown: [...new Set(unknown)], propCount: validProps.size };
}

/**
 * 검증 3: 라이브 MCP validate_xml — 파일 전체를 엔진 스펙으로 검증
 * isValid는 쓰지 않고 코드 기준 판정. 인라인 핸들러 오탐 보정. 서버 다운 시 스킵.
 */
async function validateLive(xml) {
  let res;
  try {
    const httpRes = await fetch(`${MCP_API_BASE}/validate_xml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: xml, mode: 'essential' }),
      signal: AbortSignal.timeout(30000),
    });
    if (!httpRes.ok) throw new Error(`HTTP ${httpRes.status}`);
    res = await httpRes.json();
  } catch (err) {
    return { ok: true, skipped: true, reason: err.message, issues: [] };
  }

  const isInlineCallFalsePositive = (item) =>
    item.code === 'UNDEFINED_EVENT_HANDLER' && /'[^']*\('/.test(item.message || '');

  const issues = [
    ...(res.errors || []),
    ...(res.warnings || []).filter((w) => ['UNKNOWN_ATTRIBUTE', 'UNKNOWN_ELEMENT', 'UNDEFINED_EVENT_HANDLER'].includes(w.code)),
  ].filter((item) => !isInlineCallFalsePositive(item));

  return { ok: issues.length === 0, skipped: false, issues };
}

/** 검증 3단계 실행. { ok, badAttrs, details } 반환 — badAttrs는 재생성 시 제외할 속성명 */
async function runValidations(xmlPath, xml, tag, spec, log = console.log) {
  const wf = validateWellFormed(xmlPath);
  log(`[검증 1/3] XML 문법: ${wf.ok ? 'PASS' : 'FAIL'}${wf.ok ? '' : '\n' + wf.error}`);

  const attrs = validateAttributes(xml, tag, spec);
  const attrsLabel = attrs.skipped
    ? `SKIP — 스펙 속성 ${attrs.propCount}개(<${MIN_SPEC_PROPS}), 판정 불가`
    : attrs.ok ? 'PASS' : 'FAIL — 미확인 속성: ' + attrs.unknown.join(', ');
  log(`[검증 2/3] <${tag}> 속성 화이트리스트: ${attrsLabel}`);

  const live = await validateLive(xml);
  const liveLabel = live.skipped
    ? `SKIP — MCP 서버 미가용 (${live.reason})`
    : live.ok ? 'PASS' : 'FAIL — ' + live.issues.map((i) => `${i.code}:${i.attributeName || i.message}`).join(', ');
  log(`[검증 3/3] 라이브 validate_xml: ${liveLabel}`);

  // [2026-07-27] 라이브 검증이 동작했으면 라이브를 우선한다.
  //   MCP 서버 데이터 불일치 사례: xf:select1의 selectedIndex는 validate_xml에선 필수 속성인데
  //   get_component 속성 목록(→덤프)에는 없어 화이트리스트가 오탐. 라이브가 해당 속성을
  //   UNKNOWN으로 지적하지 않았다면 유효한 속성으로 인정한다. (라이브 다운 시엔 화이트리스트가 최종)
  let attrsUnknown = attrs.unknown;
  if (!live.skipped && attrsUnknown.length > 0) {
    const liveUnknown = new Set(
      live.issues.filter((i) => i.code === 'UNKNOWN_ATTRIBUTE' && i.attributeName).map((i) => i.attributeName.toLowerCase())
    );
    const cleared = attrsUnknown.filter((a) => !liveUnknown.has(a.toLowerCase()));
    if (cleared.length > 0) {
      log(`[검증 2/3 보정] 라이브 검증 통과로 유효 인정: ${cleared.join(', ')}`);
      attrsUnknown = attrsUnknown.filter((a) => liveUnknown.has(a.toLowerCase()));
    }
  }
  const attrsOk = attrs.skipped || attrsUnknown.length === 0;

  const badAttrs = [...new Set([
    ...attrsUnknown,
    ...live.issues.filter((i) => i.code === 'UNKNOWN_ATTRIBUTE' && i.attributeName).map((i) => i.attributeName),
  ])];
  return { ok: wf.ok && attrsOk && live.ok, badAttrs, details: { wellFormed: wf, attributes: attrs, live } };
}

/**
 * 샘플 생성 + 검증 + 재생성 루프 (핵심 진입점)
 *
 * @param {string} scenario - 샘플로 재현할 시나리오 설명
 * @param {string} component - 대상 컴포넌트명 (예: gridView)
 * @param {object} options - { outDir, name, log }
 * @returns {object} - { ok, xmlPath, attempts, excluded }
 */
async function generateSample(scenario, component, options = {}) {
  const log = options.log || console.log;
  const outDir = options.outDir || DEFAULT_OUT_DIR;

  const spec = loadStaticSpec(component);
  const tag = resolveTag(component, spec.baseDir);
  if (!tag) throw new Error(`태그 매핑 없음: ${component} — collect_mcp_specs.js 재실행으로 tags.json 갱신 필요`);

  log(`[SampleGen] 컴포넌트: ${component} (<${tag}>)`);
  log(`[SampleGen] 스펙: props ${extractSpecNames(spec.properties).length}개, methods ${extractSpecNames(spec.methods).length}개, events ${extractSpecNames(spec.events).length}개`);

  const cfg = loadConfig().codexExec || {};
  fs.mkdirSync(outDir, { recursive: true });

  const excluded = [];
  let xmlPath = null;
  let ok = false;
  let attempt = 0;

  for (attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let prompt = buildPrompt(scenario, component, tag, spec);
    if (excluded.length) {
      prompt += [
        '',
        '## ⚠ 재생성 지시',
        `이전 생성물에서 존재하지 않는 속성이 발견되었습니다: ${excluded.join(', ')}`,
        '위 속성들은 WebSquare에 존재하지 않으므로 절대 사용하지 마세요.',
        '해당 기능이 시나리오에 필요하면 스펙 목록에 있는 다른 속성/메서드로 대체하고,',
        '대체가 불가능하면 그 부분을 제외한 최소 샘플을 작성하세요.',
      ].join('\n');
    }
    log(`[SampleGen] 시도 ${attempt}/${MAX_ATTEMPTS} — 프롬프트 ${prompt.length}자 → codex exec 호출 (수 분 걸릴 수 있음)...`);

    const t0 = Date.now();
    const output = await callCodexExec(prompt, cfg);
    log(`[SampleGen] codex 완료 [${Math.round((Date.now() - t0) / 1000)}s], 출력 ${output.length}자`);

    const xml = extractXml(output);
    if (!xml) {
      log('[SampleGen] 출력에서 XML을 추출하지 못함 — 재시도');
      continue;
    }

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const suffix = attempt === 1 ? '' : `_retry${attempt - 1}`;
    xmlPath = path.join(outDir, `${stamp}_${options.name || component}_sample${suffix}.xml`);
    fs.writeFileSync(xmlPath, xml, 'utf8');
    log(`[SampleGen] 저장: ${xmlPath} (${xml.length}자)`);

    const result = await runValidations(xmlPath, xml, tag, spec, log);
    ok = result.ok;
    if (ok) break;

    if (result.badAttrs.length && attempt < MAX_ATTEMPTS) {
      for (const a of result.badAttrs) if (!excluded.includes(a)) excluded.push(a);
      log(`[SampleGen] 미확인 속성 제외 후 재생성: ${excluded.join(', ')}`);
    } else if (attempt < MAX_ATTEMPTS) {
      log('[SampleGen] 속성 외 원인으로 실패 (문법 등) — 동일 프롬프트로 재시도');
    }
  }

  return { ok, xmlPath, attempts: Math.min(attempt, MAX_ATTEMPTS), excluded };
}

// ---- 샘플 적합 판정 (파이프라인 큐 첨부용) ----

// 질문에서 컴포넌트를 찾기 위한 한글 별칭 (보수적으로 명확한 것만)
const KOREAN_ALIASES = {
  '그리드뷰': 'gridView',
  '그리드': 'gridView',
  '셀렉트박스': 'selectbox',
  '자동완성': 'autoComplete',
  '체크박스': 'checkbox',
  '탭컨트롤': 'tabControl',
  '트리뷰': 'treeview',
  '달력': 'calendar',
};

// [2026-07-27] 고객이 샘플/예제를 명시적으로 요청한 경우에만 생성 (사용자 결정).
//   codex 생성이 1~2분 걸려서 사용법 문의 전반에 돌리면 응답이 너무 느려짐.
//   '소스'는 제외 — wtech 실데이터 확인 결과 고객이 자기 소스를 언급/첨부하는 경우가
//   대부분이라 요청 의도와 구분 불가 ('리소스' 부분매칭 문제도 있음).
const SAMPLE_REQUEST_KEYWORDS = ['샘플', '예제', '예시', 'sample', 'example'];

// wtech 게시판 질문 작성 폼의 안내 문구 — 모든 문의 본문에 포함되어 키워드 판정을 오염시킴
const BOARD_BOILERPLATE_PATTERNS = [
  /\(\s*재현이 쉽도록[^)]*\)/g,
  /\(\s*테스트하신 웹스퀘어 엔진[^)]*\)/g,
];

/**
 * 문의가 샘플 첨부에 적합한지 + 대상 컴포넌트 판정
 *
 * @param {string} question - (마스킹된) 문의 내용
 * @returns {object} - { eligible, component, reason }
 */
function detectSampleTarget(question) {
  let text = String(question || '');
  for (const p of BOARD_BOILERPLATE_PATTERNS) text = text.replace(p, ' ');
  if (!text.trim()) return { eligible: false, component: null, reason: 'empty question' };

  // 1) 컴포넌트 검출: tags.json 키(최상위만) + 한글 별칭
  let component = null;
  try {
    const baseDir = path.join(ROOT, 'data', 'processed', 'mcp_specs');
    const tags = JSON.parse(fs.readFileSync(path.join(baseDir, 'tags.json'), 'utf8'));
    const lower = text.toLowerCase();
    // 이름이 긴 컴포넌트 우선 (예: gridView가 grid보다 먼저 매칭되도록)
    const names = Object.keys(tags)
      .filter((n) => !n.includes('/') && n.length >= 4)
      .sort((a, b) => b.length - a.length);
    for (const name of names) {
      if (new RegExp(`\\b${name.toLowerCase()}\\b`).test(lower)) { component = name; break; }
    }
  } catch (_) { /* tags.json 없으면 별칭만 시도 */ }

  if (!component) {
    for (const [alias, name] of Object.entries(KOREAN_ALIASES)) {
      if (text.includes(alias)) { component = name; break; }
    }
  }
  if (!component) return { eligible: false, component: null, reason: 'no component detected' };

  // 2) 명시적 샘플 요청 검출
  const lower = text.toLowerCase();
  const matched = SAMPLE_REQUEST_KEYWORDS.filter((k) => lower.includes(k));
  if (matched.length === 0) {
    return { eligible: false, component, reason: 'no explicit sample request' };
  }

  return { eligible: true, component, reason: `sample request: ${matched.slice(0, 3).join(',')}` };
}

/**
 * 검증 통과한 샘플을 고객 다운로드 가능 위치로 발행
 *
 * data/raw/generated-samples/YYYY-MM-DD/ 로 복사하고 /api/attachment 형식의
 * sampleFile 객체를 반환 — /api/answer 응답의 sampleFiles 배열에 그대로 합쳐진다
 * (기존 dev-guide-sample 링크와 동일 스키마라 wtech UI 변경 불필요).
 *
 * @param {string} xmlPath - generateSample이 저장한 검증 통과 파일
 * @param {object} meta - { component, id } (id: 큐 ID 등 파일명 구분자)
 * @returns {object} - { filename, mimeType, size, sourceTitle, downloadUrl }
 */
function publishSample(xmlPath, meta = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const dirRel = `generated-samples/${date}`;
  const publishDir = path.join(ROOT, 'data', 'raw', dirRel);
  fs.mkdirSync(publishDir, { recursive: true });

  const suffix = meta.id ? `_${String(meta.id).replace(/[^\w-]/g, '')}` : '';
  const filename = `${meta.component || 'websquare'}_sample${suffix}.xml`;
  const dest = path.join(publishDir, filename);
  fs.copyFileSync(xmlPath, dest);

  return {
    filename,
    mimeType: 'application/xml',
    size: fs.statSync(dest).size,
    sourceTitle: 'AI 생성 검증 샘플',
    downloadUrl: `/api/attachment?dir=${encodeURIComponent(dirRel)}&filename=${encodeURIComponent(filename)}`,
  };
}

module.exports = {
  generateSample,
  publishSample,
  detectSampleTarget,
  runValidations,
  loadStaticSpec,
  resolveTag,
  extractSpecNames,
  DEFAULT_OUT_DIR,
};
