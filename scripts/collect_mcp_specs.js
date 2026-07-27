/**
 * MCP 라이브 서버에서 WebSquare 컴포넌트 스펙 전체를 덤프
 *
 * 배경 (2026-07-27 교차검증 결과):
 *   - 기존 data/processed/mcp_specs/ 덤프는 수집 시점에 따라 포맷이 섞여 있어
 *     (## name vs ### name) 경량 검증기의 헤딩 파싱이 일부 컴포넌트에서 실패 → 오탐 발생
 *   - 라이브 get_component 응답은 "## name" 통일 포맷 + 개요에 XML 태그명 포함
 *   - 재수집으로 포맷 통일 + COMPONENT_TAG_MAP 수동 관리 제거(tags.json 생성)
 *
 * 사용법:
 *   node scripts/collect_mcp_specs.js                # 전체 재수집
 *   node scripts/collect_mcp_specs.js --only group   # 특정 컴포넌트만
 *   node scripts/collect_mcp_specs.js --dry-run      # 대상 목록만 출력
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'processed', 'mcp_specs');
const API_BASE = process.env.WSQ_MCP_API || 'http://192.168.100.214:15748/InswaveAdmin/mcp/websquare/api';
const CONCURRENCY = 4;
const SECTIONS = ['properties', 'methods', 'events'];

function parseArgs(argv) {
  const args = { only: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function callApi(endpoint, body, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/** list_components 마크다운에서 컴포넌트명 추출 ("- name" / "  - parent/sub") */
function parseComponentList(md) {
  const names = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*- ([\w$/]+)\s*$/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** 개요 마크다운에서 "- **태그**: xf:group" 추출 */
function parseTag(overviewMd) {
  const m = overviewMd.match(/^- \*\*태그\*\*:\s*(\S+)/m);
  return m ? m[1] : null;
}

async function collectOne(name) {
  const dir = path.join(OUT_DIR, ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });

  const result = { name, tag: null, counts: {}, errors: [] };

  let overview = null;
  try {
    overview = await callApi('get_component', { component: name });
    fs.writeFileSync(path.join(dir, 'overview.md'), overview, 'utf8');
    result.tag = parseTag(overview);
  } catch (err) {
    result.errors.push(`overview: ${err.message}`);
  }

  for (const section of SECTIONS) {
    try {
      const md = await callApi('get_component', { component: name, section });
      fs.writeFileSync(path.join(dir, `${section}.md`), md, 'utf8');
      result.counts[section] = (md.match(/^## /gm) || []).length;
    } catch (err) {
      result.errors.push(`${section}: ${err.message}`);
    }
  }
  return result;
}

async function main() {
  const { only, dryRun } = parseArgs(process.argv);

  console.log(`[SpecDump] list_components 조회 (${API_BASE})...`);
  const listMd = await callApi('list_components', { category: 'all' });
  let names = parseComponentList(listMd);
  if (only) names = names.filter((n) => n === only || n.startsWith(only + '/'));
  console.log(`[SpecDump] 대상 ${names.length}개`);

  if (dryRun) {
    console.log(names.join('\n'));
    return;
  }

  // 기존 덤프 백업 (1회만 유지)
  const backupDir = OUT_DIR + '_backup';
  if (fs.existsSync(OUT_DIR) && !fs.existsSync(backupDir) && !only) {
    fs.cpSync(OUT_DIR, backupDir, { recursive: true });
    console.log(`[SpecDump] 기존 덤프 백업: ${backupDir}`);
  }

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < names.length) {
      const name = names[idx++];
      const r = await collectOne(name);
      results.push(r);
      const status = r.errors.length ? `⚠ ${r.errors.join('; ')}` : 'OK';
      console.log(`[${results.length}/${names.length}] ${name} — props ${r.counts.properties ?? '-'}, methods ${r.counts.methods ?? '-'}, events ${r.counts.events ?? '-'} ${status}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // 태그 매핑 저장 (COMPONENT_TAG_MAP 대체)
  const tags = {};
  for (const r of results.filter((r) => r.tag)) tags[r.name] = r.tag;
  const tagsPath = path.join(OUT_DIR, 'tags.json');
  fs.writeFileSync(tagsPath, JSON.stringify(tags, null, 2), 'utf8');

  const failed = results.filter((r) => r.errors.length);
  const sparse = results.filter((r) => !r.errors.length && (r.counts.properties ?? 0) < 5 && !r.name.includes('/'));
  console.log(`\n[SpecDump] 완료: ${results.length}개 (실패 ${failed.length}, 태그 ${Object.keys(tags).length}개 → ${tagsPath})`);
  if (failed.length) console.log('실패 목록:\n' + failed.map((r) => `  - ${r.name}: ${r.errors.join('; ')}`).join('\n'));
  if (sparse.length) console.log('속성 5개 미만(스펙 자체가 작거나 서버 데이터 부실):\n' + sparse.map((r) => `  - ${r.name} (props ${r.counts.properties ?? 0})`).join('\n'));
}

main().catch((err) => {
  console.error('[SpecDump] 오류:', err.message);
  process.exit(1);
});
