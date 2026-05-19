/**
 * WebSquare API 가이드 HTML 파서
 *
 * 두 가지 포맷 처리:
 *   - SP4/SP5 (레거시): table 기반, dt.apiname, table#ptable
 *   - AI (신규): semantic HTML, dt[id], ul.api_ul_parameter
 */

const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');
const { maskPersonalInfo } = require('../utils/masking');

class ApiGuideParser {
  constructor() {
    this.parsedData = [];
  }

  /**
   * HTML 파일 파싱 (포맷 자동 감지)
   */
  async parseFile(filePath, version) {
    const html = await fs.readFile(filePath, 'utf8');
    const $ = cheerio.load(html);

    // 포맷 감지: AI는 .api_container 클래스 사용
    const isAI = $('.api_container').length > 0;

    // 컴포넌트명 추출
    const componentName = isAI
      ? $('.api_component').first().text().trim()
      : $('#maintitle').text().trim() || $('title').text().trim();

    if (!componentName) return [];

    const methods = isAI
      ? this._parseAIFormat($, componentName)
      : this._parseLegacyFormat($, componentName);

    // Q&A 형태로 변환
    return methods.map((method) => this._methodToQA(method, componentName, version));
  }

  /**
   * SP4/SP5 레거시 포맷 파싱
   */
  _parseLegacyFormat($, componentName) {
    const methods = [];

    // Property Detail
    $('#defaultoptions dl dt.apiname, #defaultoptions dl dt[class*="apiname"]').each((_, dt) => {
      const prop = this._parseLegacyProperty($, $(dt), componentName);
      if (prop) methods.push(prop);
    });

    // Event Detail
    $('#eventdetail dl dt.apiname, #eventdetail dl dt[class*="apiname"]').each((_, dt) => {
      const event = this._parseLegacyMethod($, $(dt), 'event');
      if (event) methods.push(event);
    });

    // Method Detail
    $('#apidetail dl dt.apiname').each((_, dt) => {
      const method = this._parseLegacyMethod($, $(dt), 'method');
      if (method) methods.push(method);
    });

    return methods;
  }

  /**
   * 레거시 메서드/이벤트 파싱
   */
  _parseLegacyMethod($, $dt, type) {
    const name = $dt.text().trim().replace(/\s+/g, ' ');
    const $dd = $dt.next('dd');
    if (!$dd.length) return null;

    // 설명
    const description = $dd.find('.pdesc').first().text().trim();

    // 파라미터
    const params = [];
    $dd.find('table#ptable').each((_, table) => {
      const $table = $(table);
      const caption = $table.find('caption').text().trim();
      if (caption === 'Parameter') {
        $table.find('tr').each((i, tr) => {
          if (i === 0) return; // 헤더 skip
          const tds = $(tr).find('td');
          if (tds.length >= 4) {
            params.push({
              name: $(tds[0]).text().trim(),
              type: $(tds[1]).text().trim(),
              required: $(tds[2]).text().trim(),
              description: $(tds[3]).text().trim(),
            });
          }
        });
      }
    });

    // 리턴 타입
    let returnType = '';
    $dd.find('table#ptable').each((_, table) => {
      const $table = $(table);
      if ($table.find('caption').text().trim() === 'Return') {
        const tds = $table.find('tr:nth-child(2) td');
        if (tds.length >= 2) {
          returnType = `${$(tds[0]).text().trim()} - ${$(tds[1]).text().trim()}`;
        }
      }
    });

    // 코드 샘플
    const samples = [];
    $dd.find("xmp.js.sample, xmp[class*='sample']").each((_, xmp) => {
      const code = $(xmp).text().trim();
      if (code) samples.push(code);
    });

    return { name, type, description, params, returnType, samples };
  }

  /**
   * 레거시 프로퍼티 파싱
   */
  _parseLegacyProperty($, $dt, componentName) {
    const name = $dt.text().trim();
    const $dd = $dt.next('dd');
    const description = $dd.length ? $dd.find('.edesc, .pdesc').first().text().trim() : '';

    return { name, type: 'property', description, params: [], returnType: '', samples: [] };
  }

  /**
   * AI 신규 포맷 파싱
   */
  _parseAIFormat($, componentName) {
    const methods = [];

    // Property Detail
    $('.properties_section dl.api_dl dt[id]').each((_, dt) => {
      const item = this._parseAIItem($, $(dt), 'property');
      if (item) methods.push(item);
    });

    // Event Detail
    $('.event_section dl.api_dl dt[id]').each((_, dt) => {
      const item = this._parseAIItem($, $(dt), 'event');
      if (item) methods.push(item);
    });

    // Method Detail
    $('.method_section dl.api_dl dt[id]').each((_, dt) => {
      const item = this._parseAIItem($, $(dt), 'method');
      if (item) methods.push(item);
    });

    return methods;
  }

  /**
   * AI 포맷 개별 항목 파싱
   */
  _parseAIItem($, $dt, type) {
    const name = $dt.text().trim();
    const $dd = $dt.next('dd');
    if (!$dd.length) return null;

    // 설명: dd 내 첫 텍스트 노드
    const descNodes = $dd.contents().filter((_, node) => {
      return node.type === 'text' || (node.type === 'tag' && node.name === 'p');
    });
    const description = descNodes.first().text().trim();

    // 파라미터
    const params = [];
    $dd.find('ul.api_ul_parameter').each((_, ul) => {
      const $ul = $(ul);
      const param = {
        name: $ul.find('.api_name .cnt').text().trim(),
        type: $ul.find('.api_type .cnt').text().trim(),
        required: $ul.find('.api_require .cnt').text().trim(),
        description: $ul.find('.api_desc .cnt').text().trim(),
      };
      if (param.name) params.push(param);
    });

    // 리턴 타입
    let returnType = '';
    const $return = $dd.find('.api_tit_para').filter((_, el) => $(el).text().includes('Return'));
    if ($return.length) {
      const $returnUl = $return.next('ul.api_ul_parameter');
      if ($returnUl.length) {
        const rType = $returnUl.find('.api_type .cnt').text().trim();
        const rDesc = $returnUl.find('.api_desc .cnt').text().trim();
        returnType = rType + (rDesc ? ` - ${rDesc}` : '');
      }
    }

    // 코드 샘플
    const samples = [];
    $dd.find("xmp.js.sample, xmp[class*='sample']").each((_, xmp) => {
      const code = $(xmp).text().trim();
      if (code) samples.push(code);
    });

    return { name, type, description, params, returnType, samples };
  }

  /**
   * 파싱 결과를 Q&A 형태로 변환
   */
  _methodToQA(method, componentName, version) {
    const question = `${componentName} ${method.name} ${method.type === 'property' ? '속성' : method.type === 'event' ? '이벤트' : '사용법'}`;

    let answer = `## ${componentName}.${method.name}\n\n`;

    if (method.description) {
      answer += `${method.description}\n\n`;
    }

    if (method.params.length > 0) {
      answer += `### 파라미터\n| 이름 | 타입 | 필수 | 설명 |\n|------|------|------|------|\n`;
      for (const p of method.params) {
        answer += `| ${p.name} | ${p.type} | ${p.required} | ${p.description} |\n`;
      }
      answer += '\n';
    }

    if (method.returnType) {
      answer += `### 반환값\n${method.returnType}\n\n`;
    }

    if (method.samples.length > 0) {
      answer += `### 예시\n`;
      for (const sample of method.samples) {
        answer += `\`\`\`javascript\n${sample}\n\`\`\`\n\n`;
      }
    }

    return {
      category: componentName,
      subcategory: method.name.replace(/\(.*\)/, ''),
      question: maskPersonalInfo(question),
      answer: maskPersonalInfo(answer.trim()),
      source: `API 가이드 (${version})`,
      version,
      tags: [componentName, method.type],
    };
  }

  /**
   * 전체 API 가이드 파싱
   */
  async parseAll(baseDir) {
    const versions = {
      SP4: path.join(baseDir, 'SP4', 'html'),
      SP5: path.join(baseDir, 'SP5', 'html'),
      AI: path.join(baseDir, 'AI', 'html'),
    };

    for (const [version, htmlDir] of Object.entries(versions)) {
      try {
        const items = await fs.readdir(htmlDir);

        for (const item of items) {
          const itemPath = path.join(htmlDir, item);
          const stat = await fs.stat(itemPath);

          let htmlFiles = [];
          if (stat.isDirectory()) {
            // SP4/SP5: 컴포넌트별 폴더 안에 HTML
            const files = await fs.readdir(itemPath);
            htmlFiles = files
              .filter((f) => f.endsWith('.html'))
              .map((f) => path.join(itemPath, f));
          } else if (item.endsWith('.html') && !['index.html', 'full.html', 'api_left.html', 'indexlist.html'].includes(item)) {
            // AI: 직접 HTML 파일
            htmlFiles = [itemPath];
          }

          for (const htmlFile of htmlFiles) {
            try {
              const results = await this.parseFile(htmlFile, version);
              this.parsedData.push(...results);
            } catch (err) {
              console.warn(`[API Parser] 파싱 실패 (${path.basename(htmlFile)}):`, err.message);
            }
          }
        }

        console.log(`[API Parser] ${version}: ${this.parsedData.length}건 (누적)`);
      } catch (err) {
        console.warn(`[API Parser] ${version} 디렉토리 없음:`, err.message);
      }
    }

    console.log(`[API Parser] 전체 완료: ${this.parsedData.length}건`);
    return this.parsedData;
  }

  /**
   * 결과 저장
   */
  async save(outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'api_guide_qa.json');
    await fs.writeFile(outputPath, JSON.stringify(this.parsedData, null, 2), 'utf8');
    console.log(`[API Parser] 저장 완료: ${outputPath}`);
  }
}

module.exports = ApiGuideParser;

// CLI 직접 실행
if (require.main === module) {
  const baseDir = path.join(__dirname, '../../data/raw/wtech-guide/api-guide');
  const outputDir = path.join(__dirname, '../../data/processed');

  const parser = new ApiGuideParser();
  parser.parseAll(baseDir)
    .then(() => parser.save(outputDir))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('파싱 실패:', err);
      process.exit(1);
    });
}
