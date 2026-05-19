/**
 * W-Tech 가이드 통합 파서
 * html_search_[bookId].js 파일에서 Q&A 데이터 추출
 *
 * 대상: 개발 가이드, 릴리즈 노트, 컴포넌트 가이드, 스니핏, 퍼블리싱, 접근성, WRE 가이드
 * 모든 가이드가 동일한 JS 뷰어 아키텍처를 사용하므로 단일 파서로 처리
 *
 * JS 파일 구조:
 *   Html.addSearchContent('bookId', [ { id, title, href, elements: [{ id, text, plain }] } ])
 *
 *   - text: HTML 원본 (코드 블록, 테이블 포함)
 *   - plain: 정제된 텍스트 (검색용)
 */

const fs = require('fs').promises;
const path = require('path');
const { maskPersonalInfo } = require('../utils/masking');

// 가이드 소스 매핑
const GUIDE_SOURCES = {
  'dev-guide/SP2': '개발 가이드 (SP2)',
  'dev-guide/SP4': '개발 가이드 (SP4)',
  'dev-guide/SP5': '개발 가이드 (SP5)',
  'dev-guide/AI': '개발 가이드 (AI)',
  'release-notes/AI': '릴리즈 노트 (AI)',
  'release-notes/SP4': '릴리즈 노트 (SP4)',
  'release-notes/SP5': '릴리즈 노트 (SP5)',
  'release-notes/웹스퀘어2': '릴리즈 노트 (웹스퀘어2)',
  'component-guide': '컴포넌트 가이드',
  'snippet-guide': '스니핏 가이드',
  'publishing-guide': '퍼블리싱 가이드',
  'accessibility-guide': '접근성 가이드',
  'wre-guide': 'WRE 가이드',
};

class GuideParser {
  constructor() {
    this.parsedData = [];
  }

  /**
   * html_search_*.js 파일에서 JSON 배열 추출
   */
  async parseSearchFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');

    // JSON 배열 추출: Html.addSearchContent('id', [...]);
    const jsonStart = raw.indexOf('[');
    const jsonEnd = raw.lastIndexOf(']') + 1;

    if (jsonStart === -1 || jsonEnd <= jsonStart) {
      throw new Error(`JSON 배열을 찾을 수 없음: ${filePath}`);
    }

    return JSON.parse(raw.substring(jsonStart, jsonEnd));
  }

  /**
   * 챕터 데이터를 Q&A 형태로 변환
   * 챕터 title = question, elements 결합 = answer
   */
  chapterToQA(chapter, source) {
    const elements = chapter.elements || [];
    if (elements.length < 2) return null;

    const title = this._stripHtml(chapter.title || '');
    if (!title || title === '문서 이력') return null;

    // 답변 구성: plain 텍스트 + 코드 블록 추출
    const answerParts = [];
    for (const el of elements.slice(1)) { // 첫 element는 제목 반복이므로 skip
      const codeBlocks = this._extractCodeBlocks(el.text || '');
      const plainText = (el.plain || '').trim();

      if (codeBlocks.length > 0) {
        if (plainText) answerParts.push(plainText);
        for (const code of codeBlocks) {
          answerParts.push(`\`\`\`\n${code}\n\`\`\``);
        }
      } else if (plainText) {
        answerParts.push(plainText);
      }
    }

    const answer = answerParts.join('\n\n');
    if (!answer || answer.length < 30) return null;

    return {
      category: '',
      subcategory: '',
      question: maskPersonalInfo(title),
      answer: maskPersonalInfo(answer),
      source,
      version: this._extractVersion(source),
      tags: this._extractTags(title + ' ' + answer),
    };
  }

  /**
   * HTML에서 코드 블록 추출
   */
  _extractCodeBlocks(html) {
    const blocks = [];

    // <pre>, <code>, <xmp> 태그에서 코드 추출
    const patterns = [
      /<pre[^>]*class="[^"]*code[^"]*"[^>]*>([\s\S]*?)<\/pre>/gi,
      /<code[^>]*>([\s\S]*?)<\/code>/gi,
      /<xmp[^>]*>([\s\S]*?)<\/xmp>/gi,
      /<div[^>]*class="[^"]*element code[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const code = this._stripHtml(match[1]).trim();
        if (code.length > 10) {
          blocks.push(code);
        }
      }
    }

    return blocks;
  }

  /**
   * HTML 태그 제거
   */
  _stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<span[^>]*class="[^"]*part_title_n[^"]*"[^>]*>.*?<\/span>/gi, '')
      .replace(/<span[^>]*class="[^"]*chapter_title_n[^"]*"[^>]*>.*?<\/span>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/td>/gi, ' | ')
      .replace(/<\/th>/gi, ' | ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 소스명에서 버전 추출
   */
  _extractVersion(source) {
    const match = source.match(/\((SP\d|AI|웹스퀘어2)\)/);
    return match ? match[1] : '';
  }

  /**
   * 태그 추출
   */
  _extractTags(text) {
    const tagPatterns = [
      { pattern: /gridview/i, tag: 'GridView' },
      { pattern: /dataset|datalist/i, tag: 'DataCollection' },
      { pattern: /submission/i, tag: 'Submission' },
      { pattern: /wframe/i, tag: 'WFrame' },
      { pattern: /popup|window/i, tag: 'Popup' },
      { pattern: /tab/i, tag: 'Tab' },
      { pattern: /엑셀|excel/i, tag: 'Excel' },
      { pattern: /selectbox/i, tag: 'SelectBox' },
      { pattern: /calendar/i, tag: 'Calendar' },
      { pattern: /input/i, tag: 'Input' },
      { pattern: /스코프|scope/i, tag: 'Scope' },
    ];

    return tagPatterns
      .filter(({ pattern }) => pattern.test(text))
      .map(({ tag }) => tag);
  }

  /**
   * 전체 가이드 파싱 실행
   */
  async parseAll(baseDir) {
    const searchFiles = await this._findSearchFiles(baseDir);
    console.log(`[GuideParser] ${searchFiles.length}개 가이드 파일 발견`);

    for (const { filePath, source } of searchFiles) {
      try {
        const chapters = await this.parseSearchFile(filePath);
        let count = 0;

        for (const chapter of chapters) {
          const qa = this.chapterToQA(chapter, source);
          if (qa) {
            this.parsedData.push(qa);
            count++;
          }
        }

        console.log(`[GuideParser] ${source}: ${count}건 추출 (총 ${chapters.length} 챕터)`);
      } catch (err) {
        console.error(`[GuideParser] ${source} 파싱 실패:`, err.message);
      }
    }

    console.log(`[GuideParser] 전체 완료: ${this.parsedData.length}건`);
    return this.parsedData;
  }

  /**
   * html_search_*.js 파일 자동 탐색
   */
  async _findSearchFiles(baseDir) {
    const results = [];

    for (const [relativePath, source] of Object.entries(GUIDE_SOURCES)) {
      const scriptDir = path.join(baseDir, relativePath, 'resource', 'script');

      try {
        const files = await fs.readdir(scriptDir);
        const searchFile = files.find((f) => f.startsWith('html_search_') && f.endsWith('.js'));

        if (searchFile) {
          results.push({
            filePath: path.join(scriptDir, searchFile),
            source,
          });
        }
      } catch {
        // 디렉토리 없으면 skip
      }
    }

    return results;
  }

  /**
   * 파싱 결과 저장
   */
  async save(outputDir) {
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'guide_qa.json');
    await fs.writeFile(outputPath, JSON.stringify(this.parsedData, null, 2), 'utf8');
    console.log(`[GuideParser] 저장 완료: ${outputPath}`);
  }
}

module.exports = GuideParser;

// CLI 직접 실행
if (require.main === module) {
  const baseDir = path.join(__dirname, '../../data/raw/wtech-guide');
  const outputDir = path.join(__dirname, '../../data/processed');

  const parser = new GuideParser();
  parser.parseAll(baseDir)
    .then(() => parser.save(outputDir))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('파싱 실패:', err);
      process.exit(1);
    });
}
