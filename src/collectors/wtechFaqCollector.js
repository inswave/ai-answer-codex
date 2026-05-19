/**
 * W-Tech FAQ 크롤러
 * Puppeteer 기반 자주 찾는 질문 수집
 */

const puppeteer = require('puppeteer');
const { maskPersonalInfo } = require('../utils/masking');
const { loadConfig } = require('../utils/config');
const fs = require('fs').promises;
const path = require('path');

class WTechFaqCollector {
  constructor(config) {
    this.config = config || loadConfig().wtechFaq;
    this.browser = null;
    this.collectedData = [];
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  async login(page) {
    await page.goto(this.config.loginUrl, { waitUntil: 'networkidle2' });
    await page.type(this.config.selectors.username, this.config.credentials.username);
    await page.type(this.config.selectors.password, this.config.credentials.password);
    await page.click(this.config.selectors.loginButton);
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('[W-Tech FAQ] 로그인 성공');
  }

  async collectFaqItems(page) {
    await page.goto(this.config.faqUrl, { waitUntil: 'networkidle2' });

    const items = await page.evaluate((selectors) => {
      const faqs = document.querySelectorAll(selectors.faqItem);
      return Array.from(faqs).map((faq) => ({
        question: faq.querySelector(selectors.question)?.textContent?.trim() || '',
        answer: faq.querySelector(selectors.answer)?.innerHTML || '',
        category: faq.querySelector(selectors.category)?.textContent?.trim() || '',
      }));
    }, this.config.selectors);

    return items.filter((item) => item.question);
  }

  _htmlToText(html) {
    if (!html) return '';
    return html
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async collect() {
    try {
      await this.init();
      const page = await this.browser.newPage();
      await this.login(page);

      const items = await this.collectFaqItems(page);

      this.collectedData = items.map((item) => ({
        category: item.category,
        subcategory: '',
        question: maskPersonalInfo(item.question),
        answer: maskPersonalInfo(this._htmlToText(item.answer)),
        source: 'W-Tech FAQ',
        date: '',
        tags: [],
      }));

      console.log(`[W-Tech FAQ] 수집 완료: ${this.collectedData.length}건`);
      return this.collectedData;
    } finally {
      await this.close();
    }
  }

  async save(outputDir) {
    const outputPath = path.join(outputDir, 'wtech_faq.json');
    await fs.writeFile(outputPath, JSON.stringify(this.collectedData, null, 2), 'utf8');
    console.log(`[W-Tech FAQ] 저장 완료: ${outputPath}`);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = WTechFaqCollector;
