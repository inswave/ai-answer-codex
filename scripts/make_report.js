#!/usr/bin/env node
/**
 * make_report.js — README.md 를 자체 완결형 HTML 보고서로 변환.
 * marked(Node에서 마크다운→HTML) + mermaid(파일에 내장, 브라우저에서 다이어그램 렌더).
 * 외부 네트워크 없이 어디서든 열린다.
 *
 *   node scripts/make_report.js [입력.md] [출력.html]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = process.argv[2] || path.join(ROOT, 'README.md');
const OUTPUT = process.argv[3] || path.join(ROOT, 'docs', 'project-report.html');

// marked / mermaid 라이브러리 (다운로드본 우선, 없으면 node_modules)
function loadLib(tmpName, modName) {
  const candidates = [path.join(ROOT, '.libcache', tmpName), path.join('/tmp', tmpName)];
  for (const c of candidates) { if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8'); }
  try { return fs.readFileSync(require.resolve(modName), 'utf8'); } catch { return null; }
}
const markedSrc = loadLib('marked.min.js', 'marked/marked.min.js');
const mermaidSrc = loadLib('mermaid.min.js', 'mermaid/dist/mermaid.min.js');
if (!markedSrc) { console.error('marked 라이브러리를 찾을 수 없습니다 (/tmp/marked.min.js)'); process.exit(1); }
if (!mermaidSrc) { console.error('mermaid 라이브러리를 찾을 수 없습니다 (/tmp/mermaid.min.js)'); process.exit(1); }

// marked 를 Node 에서 로드
const Module = require('module');
const m = new Module('marked');
m._compile(markedSrc, '/tmp/marked.min.js');
const marked = m.exports.marked || m.exports;

const md = fs.readFileSync(INPUT, 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ```mermaid 블록을 분리해 <pre class="mermaid">로, 나머지는 marked 로 변환
const parts = [];
const re = /```mermaid\s*\n([\s\S]*?)```/g;
let last = 0, m2;
while ((m2 = re.exec(md)) !== null) {
  if (m2.index > last) parts.push({ type: 'md', text: md.slice(last, m2.index) });
  parts.push({ type: 'mermaid', text: m2[1] });
  last = re.lastIndex;
}
if (last < md.length) parts.push({ type: 'md', text: md.slice(last) });

const body = parts.map((p) =>
  p.type === 'mermaid'
    ? `<pre class="mermaid">${esc(p.text.trim())}</pre>`
    : marked.parse(p.text)
).join('\n');

const today = new Date().toISOString().slice(0, 10);
const title = 'TechAssistant — 프로젝트 보고서';

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --fg:#1f2328; --muted:#656d76; --border:#d0d7de; --bg:#fff; --accent:#0969da; --code-bg:#f6f8fa; }
  * { box-sizing: border-box; }
  body { margin:0; background:#eef1f4; color:var(--fg);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic","맑은 고딕",Helvetica,Arial,sans-serif;
    line-height:1.65; font-size:16px; }
  .page { max-width:980px; margin:32px auto; background:var(--bg); padding:56px 64px;
    border:1px solid var(--border); border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.06); }
  .report-head { border-bottom:3px solid var(--accent); padding-bottom:16px; margin-bottom:28px; }
  .report-head .meta { color:var(--muted); font-size:13px; margin-top:6px; }
  h1,h2,h3,h4 { line-height:1.3; font-weight:700; }
  h1 { font-size:30px; margin:0; }
  h2 { font-size:23px; margin:34px 0 14px; padding-bottom:7px; border-bottom:1px solid var(--border); }
  h3 { font-size:18px; margin:24px 0 10px; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  p,ul,ol { margin:10px 0; }
  hr { border:0; border-top:1px solid var(--border); margin:28px 0; }
  code { background:var(--code-bg); padding:.15em .4em; border-radius:5px; font-size:85%;
    font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; }
  pre { background:var(--code-bg); padding:16px; border-radius:8px; overflow:auto; border:1px solid var(--border); }
  pre code { background:none; padding:0; font-size:85%; }
  table { border-collapse:collapse; width:100%; margin:14px 0; font-size:14.5px; display:block; overflow-x:auto; }
  th,td { border:1px solid var(--border); padding:8px 12px; text-align:left; vertical-align:top; }
  th { background:var(--code-bg); font-weight:600; }
  tr:nth-child(even) td { background:#fbfcfd; }
  blockquote { margin:14px 0; padding:6px 16px; color:var(--muted); border-left:4px solid var(--border); background:#fafbfc; }
  pre.mermaid { background:#fff; border:1px solid var(--border); text-align:center; padding:20px; }
  .toc { background:var(--code-bg); border:1px solid var(--border); border-radius:8px; padding:14px 20px; margin:20px 0; font-size:14.5px; }
  .toc strong { display:block; margin-bottom:6px; }
  @media print { body{background:#fff;} .page{box-shadow:none;border:0;margin:0;max-width:100%;padding:0;} }
  @media (max-width:720px){ .page{padding:28px 18px;margin:0;border-radius:0;} }
</style>
</head>
<body>
<div class="page">
  <div class="report-head">
    <h1>${title}</h1>
    <div class="meta">AI 기술문의 자동 답변 시스템 · 생성일 ${today} · README.md 기반</div>
  </div>
  ${body}
</div>
<script>${mermaidSrc}</script>
<script>
  mermaid.initialize({ startOnLoad:true, securityLevel:'loose', theme:'default',
    flowchart:{ htmlLabels:true, curve:'basis', useMaxWidth:true } });
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, html, 'utf8');
console.log('생성 완료:', OUTPUT);
console.log('크기:', (Buffer.byteLength(html) / 1024 / 1024).toFixed(2), 'MB');
console.log('다이어그램(mermaid 블록):', parts.filter((p) => p.type === 'mermaid').length, '개');
