/**
 * 샘플 XML 자동 생성 CLI (핵심 로직은 src/generator/sampleGenerator.js)
 *
 * 사용법:
 *   node scripts/test_sample_generation.js "<시나리오 설명>" --component selectbox
 *   node scripts/test_sample_generation.js "<시나리오>" --component gridView --out data/samples_generated
 *   node scripts/test_sample_generation.js --validate <xml경로> --component gridView   # 기존 파일 검증만
 */

const fs = require('fs');
const path = require('path');
const {
  generateSample,
  runValidations,
  loadStaticSpec,
  resolveTag,
  DEFAULT_OUT_DIR,
} = require('../src/generator/sampleGenerator');

function parseArgs(argv) {
  const args = { scenario: null, component: null, outDir: DEFAULT_OUT_DIR, name: null, validate: null };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--component') args.component = argv[++i];
    else if (argv[i] === '--out') args.outDir = path.resolve(argv[++i]);
    else if (argv[i] === '--name') args.name = argv[++i];
    else if (argv[i] === '--validate') args.validate = path.resolve(argv[++i]);
    else rest.push(argv[i]);
  }
  args.scenario = rest.join(' ').trim();
  return args;
}

async function main() {
  const { scenario, component, outDir, name, validate } = parseArgs(process.argv);

  // 검증 전용 모드: 기존 XML 파일을 3단계 검증만 수행
  if (validate) {
    if (!component) {
      console.error('사용법: node scripts/test_sample_generation.js --validate <xml경로> --component gridView');
      process.exit(1);
    }
    const spec = loadStaticSpec(component);
    const tag = resolveTag(component, spec.baseDir);
    if (!tag) {
      console.error(`태그 매핑 없음: ${component} — collect_mcp_specs.js 재실행으로 tags.json 갱신 필요`);
      process.exit(1);
    }
    const xml = fs.readFileSync(validate, 'utf8');
    console.log(`[SampleGen] 검증 전용: ${validate} (${component} <${tag}>)`);
    const { ok } = await runValidations(validate, xml, tag, spec);
    console.log(`\n[SampleGen] 최종: ${ok ? '✅ 검증 통과' : '❌ 검증 실패'}`);
    process.exit(ok ? 0 : 3);
  }

  if (!scenario || !component) {
    console.error('사용법: node scripts/test_sample_generation.js "<시나리오>" --component selectbox');
    process.exit(1);
  }

  const result = await generateSample(scenario, component, { outDir, name });
  console.log(`\n[SampleGen] 최종: ${result.ok ? '✅ 검증 통과 — 첨부 가능 수준' : `❌ 검증 실패 — 첨부 부적합 (${result.attempts}회 시도)`}${result.xmlPath ? '\n[SampleGen] 최종 파일: ' + result.xmlPath : ''}`);
  process.exit(result.ok ? 0 : 3);
}

main().catch((err) => {
  console.error('[SampleGen] 오류:', err.message);
  process.exit(1);
});
