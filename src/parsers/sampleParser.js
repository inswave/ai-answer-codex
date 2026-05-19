/**
 * dev-guide-sample XML 파서
 * WebSquare 컴포넌트 샘플 XML에서 Q&A 데이터 추출
 *
 * 파일명 패턴: [기능명]_[컴포넌트명].xml
 * 추출 대상:
 *   - 파일명 → 기능명, 컴포넌트명
 *   - w2:textbox label → 샘플 설명
 *   - <script> → JavaScript 코드
 *   - w2:* 컴포넌트 → 속성/설정 예시
 */

const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');
const { maskPersonalInfo } = require('../utils/masking');

class SampleParser {
  constructor() {
    this.parsedData = [];
  }

  /**
   * 단일 XML 파일 파싱
   */
  async parseFile(filePath) {
    const xml = await fs.readFile(filePath, 'utf8');
    const $ = cheerio.load(xml, { xmlMode: true });

    const fileName = path.basename(filePath, '.xml');
    const dirName = path.basename(path.dirname(filePath));
    const componentDir = this._findComponentDir(filePath);

    // 파일명에서 기능명/컴포넌트명 추출
    const { feature, component } = this._parseFileName(fileName, componentDir);

    // 설명 추출 (textbox label)
    const descriptions = [];
    $('w2\\:textbox, textbox').each((_, el) => {
      const label = $(el).attr('label') || '';
      const cleaned = label
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .trim();
      if (cleaned && cleaned.length > 5) {
        descriptions.push(cleaned);
      }
    });

    // JavaScript 코드 추출
    const scripts = [];
    $('script').each((_, el) => {
      let code = $(el).text().trim();
      // CDATA 래핑 제거
      code = code.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
      if (code && code.length > 20 && !code.includes('onpageload = function() {\n\t};')) {
        scripts.push(code);
      }
    });

    // 주요 w2 컴포넌트 속성 추출
    const componentAttrs = this._extractComponentAttrs($);

    // Q&A 구성
    const question = `${component} ${feature} 사용법`;

    let answer = '';
    if (descriptions.length > 0) {
      answer += descriptions.join('\n') + '\n\n';
    }
    if (componentAttrs) {
      answer += `### 컴포넌트 설정\n${componentAttrs}\n\n`;
    }
    if (scripts.length > 0) {
      answer += `### 코드\n`;
      for (const script of scripts) {
        answer += `\`\`\`javascript\n${script}\n\`\`\`\n\n`;
      }
    }

    answer = answer.trim();
    if (!answer || answer.length < 30) return null;

    return {
      category: component,
      subcategory: feature,
      question: maskPersonalInfo(question),
      answer: maskPersonalInfo(answer),
      source: '개발가이드 샘플',
      version: '',
      tags: [component, feature].filter(Boolean),
    };
  }

  /**
   * 파일명에서 기능명/컴포넌트명 분리
   * 패턴: featureName_ComponentName
   */
  _parseFileName(fileName, componentDir) {
    // 마지막 _이후가 컴포넌트명인 경우가 많음
    const parts = fileName.split('_');

    if (parts.length >= 2) {
      const component = parts[parts.length - 1] || componentDir;
      const feature = parts.slice(0, -1).join('_');
      return { feature, component };
    }

    return { feature: fileName, component: componentDir };
  }

  /**
   * 파일 경로에서 컴포넌트 디렉토리명 추출
   */
  _findComponentDir(filePath) {
    const baseDir = path.join(__dirname, '../../data/raw/dev-guide-sample');
    const relative = path.relative(baseDir, filePath);
    const topDir = relative.split(path.sep)[0];
    return topDir || '';
  }

  /**
   * 주요 w2 컴포넌트의 핵심 속성 추출
   */
  _extractComponentAttrs($) {
    const components = [];

    const targetTags = [
      'w2\\:gridView', 'w2\\:dataList', 'w2\\:submission',
      'w2\\:selectBox', 'w2\\:calendar', 'w2\\:input',
      'w2\\:checkBox', 'w2\\:textArea', 'w2\\:tab',
      'w2\\:accordion', 'w2\\:popup', 'w2\\:autoComplete',
      'w2\\:subTotal', 'w2\\:group',
    ];

    for (const tag of targetTags) {
      $(tag).each((_, el) => {
        const attrs = $(el).attr();
        if (!attrs) return;

        // style, id 등 공통 속성 제외
        const meaningful = {};
        for (const [key, value] of Object.entries(attrs)) {
          if (['style', 'xmlns', 'xmlns:w2', 'xmlns:xf', 'xmlns:ev'].includes(key)) continue;
          if (value && value !== '' && value !== 'false') {
            meaningful[key] = value;
          }
        }

        if (Object.keys(meaningful).length > 1) {
          const tagName = tag.replace('w2\\:', '');
          const attrStr = Object.entries(meaningful)
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ');
          components.push(`\`<${tagName} ${attrStr}>\``);
        }
      });
    }

    return components.length > 0 ? components.join('\n') : '';
  }

  /**
   * 전체 샘플 파싱
   */
  async parseAll(baseDir) {
    const xmlFiles = await this._findXmlFiles(baseDir);
    console.log(`[SampleParser] ${xmlFiles.length}개 XML 파일 발견`);

    for (const filePath of xmlFiles) {
      try {
        const qa = await this.parseFile(filePath);
        if (qa) {
          this.parsedData.push(qa);
        }
      } catch (err) {
        // 파싱 실패 무시 (일부 XML이 비표준일 수 있음)
      }
    }

    console.log(`[SampleParser] 전체 완료: ${this.parsedData.length}건`);
    return this.parsedData;
  }

  /**
   * XML 파일 재귀 탐색
   */
  async _findXmlFiles(dir) {
    const results = [];

    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        const subFiles = await this._findXmlFiles(fullPath);
        results.push(...subFiles);
      } else if (item.name.endsWith('.xml')) {
        results.push(fullPath);
      }
    }

    return results;
  }

  /**
   * 결과 저장
   */
  async save(outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'sample_qa.json');
    await fs.writeFile(outputPath, JSON.stringify(this.parsedData, null, 2), 'utf8');
    console.log(`[SampleParser] 저장 완료: ${outputPath}`);
  }
}

module.exports = SampleParser;

// CLI 직접 실행
if (require.main === module) {
  const baseDir = path.join(__dirname, '../../data/raw/dev-guide-sample');
  const outputDir = path.join(__dirname, '../../data/processed');

  const parser = new SampleParser();
  parser.parseAll(baseDir)
    .then(() => parser.save(outputDir))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('파싱 실패:', err);
      process.exit(1);
    });
}
