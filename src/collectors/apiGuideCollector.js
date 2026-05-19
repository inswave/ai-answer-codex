/**
 * WebSquare API 가이드 수집기
 * HTML → JSON 변환 방식
 */

const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');
const { loadConfig } = require('../utils/config');

class ApiGuideCollector {
  constructor(config) {
    this.config = config || loadConfig().apiGuide;
    this.collectedData = [];
  }

  /**
   * API 가이드 HTML 파일 파싱
   */
  async parseApiFile(filePath) {
    const html = await fs.readFile(filePath, 'utf8');
    const $ = cheerio.load(html);
    const apis = [];

    // 컴포넌트별 API 섹션 파싱
    $('.api-section, .method-detail').each((_, section) => {
      const $section = $(section);
      const componentName = $section.find('.component-name, h2').first().text().trim();
      const methodName = $section.find('.method-name, h3').first().text().trim();
      const description = $section.find('.description, .method-desc').first().text().trim();
      const syntax = $section.find('pre, code').first().text().trim();
      const params = [];

      $section.find('.param-row, tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        if (cells.length >= 3) {
          params.push({
            name: $(cells[0]).text().trim(),
            type: $(cells[1]).text().trim(),
            description: $(cells[2]).text().trim(),
          });
        }
      });

      const returnType = $section.find('.return-type, .returns').first().text().trim();
      const example = $section.find('.example pre, .code-example').first().text().trim();

      if (methodName) {
        apis.push({
          component: componentName,
          method: methodName,
          description,
          syntax,
          params,
          returnType,
          example,
        });
      }
    });

    return apis;
  }

  /**
   * API 데이터를 Q&A 형식으로 변환
   */
  convertToQA(apis) {
    return apis.map((api) => {
      const question = `${api.component} ${api.method} 사용법`;

      let answer = `## ${api.component}.${api.method}\n\n`;
      if (api.description) answer += `${api.description}\n\n`;
      if (api.syntax) answer += `### 구문\n\`\`\`\n${api.syntax}\n\`\`\`\n\n`;
      if (api.params.length > 0) {
        answer += `### 파라미터\n`;
        answer += `| 이름 | 타입 | 설명 |\n|------|------|------|\n`;
        for (const p of api.params) {
          answer += `| ${p.name} | ${p.type} | ${p.description} |\n`;
        }
        answer += '\n';
      }
      if (api.returnType) answer += `### 반환값\n${api.returnType}\n\n`;
      if (api.example) answer += `### 예시\n\`\`\`\n${api.example}\n\`\`\`\n`;

      return {
        category: api.component,
        subcategory: api.method,
        question,
        answer: answer.trim(),
        source: 'WebSquare API 가이드',
        version: '',
        tags: [api.component, api.method],
      };
    });
  }

  /**
   * 전체 수집 실행
   */
  async collect() {
    const sourceDir = this.config.sourceDir;
    const files = await fs.readdir(sourceDir);
    const htmlFiles = files.filter((f) => f.endsWith('.html') || f.endsWith('.htm'));

    for (const file of htmlFiles) {
      const filePath = path.join(sourceDir, file);
      const apis = await this.parseApiFile(filePath);
      const qaItems = this.convertToQA(apis);
      this.collectedData.push(...qaItems);
      console.log(`[API Guide] ${file}: ${apis.length}건 API 파싱`);
    }

    console.log(`[API Guide] 수집 완료: 총 ${this.collectedData.length}건`);
    return this.collectedData;
  }

  async save(outputDir) {
    const outputPath = path.join(outputDir, 'api_guide_qa.json');
    await fs.writeFile(outputPath, JSON.stringify(this.collectedData, null, 2), 'utf8');
    console.log(`[API Guide] 저장 완료: ${outputPath}`);
  }
}

module.exports = ApiGuideCollector;
