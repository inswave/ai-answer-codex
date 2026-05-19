/**
 * 13 × 56 자동 분류 엔진
 * 정규식 기반 룰 엔진으로 기술문의를 자동 분류
 */

const CATEGORIES = require('./categories');
const fs = require('fs').promises;
const path = require('path');

class Classifier {
  constructor() {
    this.categories = CATEGORIES;
    this.stats = {};
  }

  /**
   * 단건 분류
   * @param {object} item - { question, answer, ... }
   * @returns {object} - { category, subcategory, confidence }
   */
  classify(item) {
    const text = `${item.question || ''} ${item.answer || ''}`.toLowerCase();
    const scores = {};

    for (const [key, cat] of Object.entries(this.categories)) {
      if (key === 'etc') continue;

      let score = 0;
      for (const pattern of cat.patterns) {
        const matches = text.match(new RegExp(pattern.source, pattern.flags + 'g'));
        if (matches) {
          score += matches.length;
        }
      }

      if (score > 0) {
        scores[key] = score;
      }
    }

    // 최고 점수 카테고리 선택
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
      return { category: 'etc', categoryLabel: '기타', subcategory: 'general', subcategoryLabel: '일반 문의', confidence: 0 };
    }

    const [bestKey, bestScore] = sorted[0];
    const bestCat = this.categories[bestKey];

    // 소분류 결정
    const subcategory = this._classifySubcategory(text, bestKey);

    return {
      category: bestKey,
      categoryLabel: bestCat.label,
      subcategory: subcategory.key,
      subcategoryLabel: subcategory.label,
      confidence: Math.min(bestScore / 5, 1),
    };
  }

  /**
   * 소분류 결정 (키워드 매칭)
   */
  _classifySubcategory(text, categoryKey) {
    const subcategories = this.categories[categoryKey]?.subcategories || {};

    // 카테고리별 소분류 키워드 매핑
    const subPatterns = this._getSubcategoryPatterns(categoryKey);

    for (const [subKey, patterns] of Object.entries(subPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return { key: subKey, label: subcategories[subKey] || subKey };
        }
      }
    }

    return { key: 'etc', label: subcategories.etc || '기타' };
  }

  /**
   * 소분류별 패턴 정의
   */
  _getSubcategoryPatterns(categoryKey) {
    const patterns = {
      gridview: {
        excel_download: [/엑셀\s*다운/, /excel.*download/i, /export\s*excel/i],
        excel_upload: [/엑셀\s*업/, /excel.*upload/i, /import\s*excel/i],
        merge: [/셀\s*병합/, /merge\s*cell/i, /span/i],
        sort_filter: [/정렬/, /sort/i, /필터/, /filter/i],
        cell_column: [/셀\s*설정/, /컬럼\s*설정/, /column/i, /cell/i],
        event: [/이벤트/, /event/i, /onclick/i, /onchange/i],
        style: [/스타일/, /style/i, /css/i],
        paging: [/페이징/, /paging/i, /page/i],
        selection: [/선택/, /체크/, /check/i, /select/i],
        edit: [/편집/, /edit/i, /수정/],
        data_binding: [/바인딩/, /binding/i, /데이터\s*연동/],
      },
      excel: {
        download: [/다운로드/, /download/i, /export/i],
        upload: [/업로드/, /upload/i, /import/i],
        poi: [/poi/i],
        format: [/서식/, /포맷/, /format/i],
        error: [/오류/, /에러/, /error/i],
      },
      engine: {
        version: [/버전/, /version/i, /업그레이드/, /upgrade/i],
        studio: [/studio/i, /스튜디오/],
        config: [/설정/, /config/i, /속성/, /property/i],
        build: [/빌드/, /build/i, /배포/, /deploy/i],
        performance: [/성능/, /performance/i, /속도/, /느림/],
        error: [/오류/, /에러/, /error/i, /exception/i],
        migration: [/마이그레이션/, /migration/i, /이전/],
      },
    };

    return patterns[categoryKey] || {};
  }

  /**
   * 배치 분류
   */
  classifyAll(items) {
    const classified = items.map((item) => {
      const result = this.classify(item);
      return {
        ...item,
        category: result.category,
        categoryLabel: result.categoryLabel,
        subcategory: result.subcategory,
        subcategoryLabel: result.subcategoryLabel,
        confidence: result.confidence,
      };
    });

    this._updateStats(classified);
    return classified;
  }

  /**
   * 분류 통계 업데이트
   */
  _updateStats(classified) {
    this.stats = {};
    for (const item of classified) {
      const key = item.categoryLabel;
      this.stats[key] = (this.stats[key] || 0) + 1;
    }
  }

  /**
   * 분류 통계 출력
   */
  printStats() {
    console.log('\n[분류 통계]');
    const sorted = Object.entries(this.stats).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((sum, [, count]) => sum + count, 0);

    for (const [label, count] of sorted) {
      const pct = ((count / total) * 100).toFixed(1);
      console.log(`  ${label}: ${count}건 (${pct}%)`);
    }
    console.log(`  합계: ${total}건`);
  }

  /**
   * 분류 결과 저장
   */
  async save(classified, outputDir) {
    const outputPath = path.join(outputDir, 'classified_qa.json');
    await fs.writeFile(outputPath, JSON.stringify(classified, null, 2), 'utf8');
    console.log(`[분류] 저장 완료: ${outputPath}`);
  }
}

module.exports = Classifier;
