/**
 * 최근 W-Tech 문의(latest_wtech_20)에 대한 샘플 XML 자동 생성 배치 테스트
 *
 * - 샘플 제작이 의미 있는 케이스만 선별 (환경 의존/안내성 문의 제외)
 * - 케이스별로 test_sample_generation.js를 순차 실행
 * - 결과 요약을 docs/answer-test-results/에 저장
 *
 * 사용법: node scripts/test_sample_batch.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { maskSensitiveInfo } = require('../src/utils/masking');

const ROOT = path.join(__dirname, '..');
const EVAL_FILE = path.join(ROOT, 'data', 'eval', 'latest_wtech_20.json');
const OUT_DIR = path.join(ROOT, 'docs', 'answer-test-results');
const GEN_SCRIPT = path.join(__dirname, 'test_sample_generation.js');

// 선별 기준: 컴포넌트 동작 재현형 문의만. (교육/엔진오류/설정파일/DRM/리소스 문의 제외)
const CASES = [
  { match: '그리드뷰 데이터 복사', component: 'gridView', name: 'grid-copy' },
  { match: 'footer row 조건', component: 'gridView', name: 'grid-footer' },
  { match: '메뉴탭에 단축키', component: 'tabControl', name: 'tab-hotkey' },
  { match: 'group 컴포넌트의 class', component: 'group', name: 'group-class' },
  { match: 'shift키를 통한 다중 선택', component: 'gridView', name: 'grid-shift-check' },
  { match: '그리드 저장 기능', component: 'gridView', name: 'grid-save' },
  { match: 'fixedRightColumn', component: 'gridView', name: 'grid-fixed-right' },
  { match: '자동완성 컴포넌트', component: 'autoComplete', name: 'autocomplete' },
  { match: 'checkboxLabelColumn', component: 'gridView', name: 'grid-checkbox-label' },
];

function buildScenario(item) {
  const q = maskSensitiveInfo(String(item.question || '')).slice(0, 800);
  return [
    `고객 문의 제목: ${item.title}`,
    '',
    '고객 문의 내용(발췌):',
    q,
    '',
    '위 문의 상황을 재현하거나 해결 방법을 시연하는 최소 동작 테스트 샘플을 만드세요.',
  ].join('\n');
}

function main() {
  const data = JSON.parse(fs.readFileSync(EVAL_FILE, 'utf8'));
  const items = Array.isArray(data) ? data : (data.items || data.cases || []);

  const results = [];
  for (const c of CASES) {
    const item = items.find((it) => (it.title || '').includes(c.match));
    if (!item) {
      results.push({ ...c, status: 'SKIP', reason: '문의 매칭 실패' });
      console.log(`[Batch] SKIP (${c.name}): "${c.match}" 매칭 실패`);
      continue;
    }

    console.log(`\n[Batch] ===== ${c.name} (${c.component}) — ${item.title} =====`);
    const t0 = Date.now();
    const r = spawnSync('node', [GEN_SCRIPT, buildScenario(item), '--component', c.component, '--name', c.name], {
      encoding: 'utf8',
      timeout: 420000,
      cwd: ROOT,
    });
    const sec = Math.round((Date.now() - t0) / 1000);
    const out = (r.stdout || '') + (r.stderr || '');
    console.log(out.trim().split('\n').map((l) => '  ' + l).join('\n'));

    const saved = (out.match(/저장: (.+\.xml)/) || [])[1] || null;
    const wf = /\[검증 1\/2\] XML 문법: PASS/.test(out);
    const attr = /\[검증 2\/2\].*: PASS/.test(out);
    const unknownAttrs = (out.match(/미확인 속성: (.+)/) || [])[1] || '';
    results.push({
      ...c,
      title: item.title,
      status: r.status === 0 ? 'PASS' : 'FAIL',
      wellFormed: wf,
      attrsOk: attr,
      unknownAttrs,
      seconds: sec,
      file: saved,
    });
  }

  // 요약 저장
  const stamp = new Date().toISOString().slice(0, 10);
  const lines = [
    `# 샘플 XML 자동 생성 배치 테스트 (${stamp})`,
    '',
    '- 조건: 운영 동일 (MCP 정적 덤프 + codex exec), 경량 검증(문법+속성 화이트리스트)',
    `- 대상: latest_wtech_20 중 샘플 적합 ${CASES.length}건`,
    '',
    '| 케이스 | 컴포넌트 | 결과 | 문법 | 속성 | 소요(s) | 비고 |',
    '|---|---|---|---|---|---:|---|',
    ...results.map((r) =>
      `| ${r.name} | ${r.component} | ${r.status} | ${r.wellFormed ? 'O' : 'X'} | ${r.attrsOk ? 'O' : 'X'} | ${r.seconds || ''} | ${r.unknownAttrs || r.reason || ''} |`),
    '',
    '## 생성 파일',
    ...results.filter((r) => r.file).map((r) => `- ${r.name}: ${r.file}`),
    '',
  ];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mdPath = path.join(OUT_DIR, `${stamp}_sample_generation_batch.md`);
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');

  const pass = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n[Batch] 완료: ${pass}/${results.length} PASS — 요약: ${mdPath}`);
}

main();
