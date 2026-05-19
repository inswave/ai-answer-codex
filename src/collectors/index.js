/**
 * 데이터 수집 통합 실행기
 * 9개 소스에서 기술지원 데이터를 자동 수집하여 통합 JSON으로 저장
 */

const GmailCollector = require('./gmailCollector');
const WTechCollector = require('./wtechCollector');
const { ConfluenceCollector } = require('./confluenceCollector');
const ApiGuideCollector = require('./apiGuideCollector');
const WTechFaqCollector = require('./wtechFaqCollector');
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
    { name: 'gmail', instance: new GmailCollector(), enabled: options.gmail !== false },
    { name: 'wtech', instance: new WTechCollector(), enabled: options.wtech !== false && !PUPPETEER_DISABLED },
    { name: 'confluence', instance: new ConfluenceCollector(), enabled: options.confluence !== false },
    { name: 'apiGuide', instance: new ApiGuideCollector(), enabled: options.apiGuide !== false },
    { name: 'wtechFaq', instance: new WTechFaqCollector(), enabled: options.wtechFaq !== false && !PUPPETEER_DISABLED },
  ];

  for (const { name, instance, enabled } of collectors) {
    if (!enabled) {
      console.log(`[수집] ${name} 건너뜀`);
      continue;
    }

    try {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`[수집] ${name} 시작...`);
      const collectOpts = {};
      if (options.since) collectOpts.since = options.since;

      // Gmail: config의 제외 키워드로 필터링 (포함 키워드 7개 대신)
      if (name === 'gmail') {
        const { loadConfig } = require('../utils/config');
        const gmailConfig = loadConfig().gmail;
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

  // 통합 데이터 생성
  const allData = Object.values(results).flat();
  const outputPath = path.join(PROCESSED_DIR, 'all_qa.json');
  await fs.writeFile(outputPath, JSON.stringify(allData, null, 2), 'utf8');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`[수집] 전체 완료: 총 ${allData.length}건`);
  console.log(`[수집] 통합 파일: ${outputPath}`);

  return allData;
}

module.exports = { collectAll };

// CLI 직접 실행
if (require.main === module) {
  collectAll()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('수집 실패:', err);
      process.exit(1);
    });
}
