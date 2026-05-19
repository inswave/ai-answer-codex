/**
 * Confluence 문서 크롤러
 * Atlassian Cloud REST API + Basic Auth(API Token) 기반
 *
 * 대상 5개 스페이스: UXDB, PA, W5C, DB, TechDBinside
 */

const { maskPersonalInfo } = require('../utils/masking');
const { loadConfig } = require('../utils/config');
const fs = require('fs').promises;
const path = require('path');

// Node 16 호환: built-in fetch 없으면 node-fetch 폴리필 사용
const fetch = globalThis.fetch || require('node-fetch');

// 수집 대상 스페이스 (2026-04 기준 사이트 실제 존재 확인됨)
const SPACES = {
  uxdb: { key: 'UXDB', label: 'Confluence UXDB' },
  pa: { key: 'PA', label: 'Confluence PA' },
  w5c: { key: 'W5C', label: 'Confluence W5C' },
  db: { key: 'DB', label: 'Confluence 기술지식DB' },
  techdbinside: { key: 'TechDBinside', label: 'Confluence 기술지식DB(내부용)' },
};

const PAGE_LIMIT = 100;
const REQUEST_DELAY_MS = 50;

class ConfluenceCollector {
  constructor(config) {
    this.config = config || loadConfig().confluence;
    this.collectedData = [];

    const { email, apiToken } = this.config.auth || {};
    if (!email || !apiToken) {
      throw new Error(
        'Confluence 설정 누락: config.confluence.auth.email / apiToken 필요. ' +
        'API 토큰 발급: https://id.atlassian.com/manage-profile/security/api-tokens'
      );
    }
    this.authHeader = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
    this.baseUrl = this.config.baseUrl.replace(/\/$/, '');
  }

  async _request(path) {
    const url = path.startsWith('http') ? path : this.baseUrl + path;
    const res = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`HTTP ${res.status} ${url}: ${body.substring(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 특정 스페이스의 페이지 ID/제목 목록 조회 (페이지네이션)
   */
  async getPageList(spaceKey) {
    const pages = [];
    let start = 0;

    while (true) {
      const data = await this._request(
        `/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&limit=${PAGE_LIMIT}&start=${start}&expand=metadata.labels`
      );
      const results = data.results || [];
      if (results.length === 0) break;

      pages.push(...results.map((p) => ({
        id: p.id,
        title: p.title,
        url: `${this.baseUrl}${p._links?.webui || ''}`,
      })));

      if (results.length < PAGE_LIMIT) break;
      start += results.length;
    }

    return pages;
  }

  /**
   * 개별 페이지 본문 수집
   */
  async collectPageContent(pageInfo, spaceLabel) {
    try {
      const data = await this._request(
        `/rest/api/content/${pageInfo.id}?expand=body.storage,version`
      );
      const html = data?.body?.storage?.value;
      if (!html) return null;

      const text = this._htmlToText(html);
      if (!text || text.length < 50) return null;

      return {
        id: pageInfo.id,
        category: '',
        subcategory: '',
        question: maskPersonalInfo(pageInfo.title),
        answer: maskPersonalInfo(text),
        source: spaceLabel,
        date: data?.version?.when || '',
        tags: [],
      };
    } catch (err) {
      console.warn(`[Confluence] 페이지 수집 실패 (${pageInfo.title}):`, err.message);
      return null;
    }
  }

  _htmlToText(html) {
    if (!html) return '';
    return html
      .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '')
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 전체 수집 실행
   * @param {Object|string[]} [options] - { spaceKeys?: string[], maxPagesPerSpace?: number } 또는 레거시 배열 형태
   */
  async collect(options = {}) {
    let targetKeys;
    let maxPagesPerSpace = Infinity;

    if (Array.isArray(options)) {
      targetKeys = options;
    } else {
      targetKeys = options.spaceKeys || Object.keys(SPACES);
      if (options.maxPagesPerSpace) maxPagesPerSpace = options.maxPagesPerSpace;
    }

    for (const key of targetKeys) {
      const space = SPACES[key];
      if (!space) {
        console.warn(`[Confluence] 알 수 없는 스페이스: ${key}`);
        continue;
      }

      console.log(`[Confluence] ${space.label} (${space.key}) 수집 시작...`);
      let pageList;
      try {
        pageList = await this.getPageList(space.key);
      } catch (err) {
        console.error(`[Confluence] ${space.key} 페이지 목록 조회 실패:`, err.message);
        continue;
      }

      const target = pageList.slice(0, maxPagesPerSpace);
      console.log(`[Confluence] ${space.label}: ${target.length}/${pageList.length} 페이지 본문 수집 중...`);

      let collected = 0;
      for (let i = 0; i < target.length; i++) {
        const content = await this.collectPageContent(target[i], space.label);
        if (content) {
          this.collectedData.push(content);
          collected++;
        }
        if (REQUEST_DELAY_MS) await this._sleep(REQUEST_DELAY_MS);

        if ((i + 1) % 50 === 0) {
          console.log(`[Confluence] ${space.label}: ${i + 1}/${target.length} 진행...`);
        }
      }

      console.log(`[Confluence] ${space.label} 완료: ${target.length}건 중 ${collected}건 수집`);
    }

    console.log(`[Confluence] 전체 수집 완료: 총 ${this.collectedData.length}건`);
    return this.collectedData;
  }

  async save(outputDir) {
    const outputPath = path.join(outputDir, 'confluence_qa.json');
    await fs.writeFile(outputPath, JSON.stringify(this.collectedData, null, 2), 'utf8');
    console.log(`[Confluence] 저장 완료: ${outputPath}`);
  }
}

module.exports = { ConfluenceCollector, SPACES };
