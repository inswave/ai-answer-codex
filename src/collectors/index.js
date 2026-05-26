/**
 * 데이터 수집 통합 실행기
 * 선택된 소스의 collector만 로드해 불필요한 의존성 오류를 피한다.
 */

const fs = require('fs').promises;
const path = require('path');

const RAW_DIR = path.join(__dirname, '../../data/raw');
const PROCESSED_DIR = path.join(__dirname, '../../data/processed');

// Puppeteer 환경(Chromium 라이브러리)이 없는 서버에서는 W-Tech, W-Tech FAQ 자동 스킵
const PUPPETEER_DISABLED = ['1', 'true'].includes(String(process.env.DISABLE_PUPPETEER).toLowerCase());

async function ensureDirs() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
}

function createCollector(name) {
  if (name === 'gmail') {
    const GmailCollector = require('./gmailCollector');
    return new GmailCollector();
  }
  if (name === 'wtech') {
    const WTechCollector = require('./wtechCollector');
    return new WTechCollector();
  }
  if (name === 'confluence') {
    const { ConfluenceCollector } = require('./confluenceCollector');
    return new ConfluenceCollector();
  }
  if (name === 'apiGuide') {
    const ApiGuideCollector = require('./apiGuideCollector');
    return new ApiGuideCollector();
  }
  if (name === 'wtechFaq') {
    const WTechFaqCollector = require('./wtechFaqCollector');
    return new WTechFaqCollector();
  }
  throw new Error(`Unknown collector: ${name}`);
}

/**
 * 전체 소스 수집 실행
 */
async function collectAll(options = {}) {
  await ensureDirs();

  const results = {
    gmail: [],
    wtech: [],
    confluence: [],
    apiGuide: [],
    wtechFaq: [],
  };

  const collectors = [
    { name: 'gmail', enabled: options.gmail !== false },
    { name: 'wtech', enabled: options.wtech !== false && !PUPPETEER_DISABLED },
    { name: 'confluence', enabled: options.confluence !== false },
    { name: 'apiGuide', enabled: options.apiGuide !== false },
    { name: 'wtechFaq', enabled: options.wtechFaq !== false && !PUPPETEER_DISABLED },
  ];

  for (const { name, enabled } of collectors) {
    if (!enabled) {
      console.log(`[수집] ${name} 건너뜀`);
      continue;
    }

    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`[수집] ${name} 시작...`);
      const instance = createCollector(name);
      const collectOpts = {};
      if (options.since) collectOpts.since = options.since;

      // Gmail: config의 제외 검색어를 rawQuery로 전달한다.
      if (name === 'gmail') {
        const { loadConfig } = require('../utils/config');
        const gmailConfig = loadConfig().gmail || {};
        const excludeFilter = (gmailConfig.searchQueries || []).join(' ');
        if (excludeFilter) {
          let rawQuery = excludeFilter;
          if (options.since) rawQuery += ` after:${options.since.replace(/-/g, '/')}`;
          collectOpts.rawQuery = rawQuery;
        }
      }

      results[name] = await instance.collect(collectOpts);
      await instance.save(RAW_DIR);
    } catch (err) {
      console.error(`[수집] ${name} 실패:`, err.message);
    }
  }

  const allData = Object.values(results).flat();
  const outputPath = path.join(PROCESSED_DIR, 'all_qa.json');
  await fs.writeFile(outputPath, JSON.stringify(allData, null, 2), 'utf8');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`[수집] 전체 완료: 총 ${allData.length}건`);
  console.log(`[수집] 통합 파일: ${outputPath}`);

  return allData;
}

module.exports = { collectAll };

if (require.main === module) {
  collectAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('수집 실패:', err);
      process.exit(1);
    });
}
