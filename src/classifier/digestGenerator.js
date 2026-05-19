/**
 * 카테고리별 대표 Q&A 다이제스트 자동 생성기
 * 각 카테고리별 대표 Q&A 70개를 자동 선별하여 답변 시 즉시 참조 가능하도록 구성
 */

const fs = require('fs').promises;
const path = require('path');

const DIGEST_COUNT = 70;

class DigestGenerator {
  /**
   * 분류된 데이터로부터 카테고리별 다이제스트 생성
   * @param {Array} classifiedData - 분류 완료된 Q&A 배열
   * @returns {Object} - { categoryKey: [digest items] }
   */
  generate(classifiedData) {
    const grouped = this._groupByCategory(classifiedData);
    const digests = {};

    for (const [category, items] of Object.entries(grouped)) {
      digests[category] = this._selectRepresentative(items, DIGEST_COUNT);
      console.log(`[다이제스트] ${category}: ${digests[category].length}건 선별`);
    }

    return digests;
  }

  /**
   * 카테고리별 그룹핑
   */
  _groupByCategory(data) {
    const grouped = {};
    for (const item of data) {
      const key = item.categoryLabel || item.category || '기타';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }
    return grouped;
  }

  /**
   * 대표 Q&A 선별 기준:
   * 1. 답변 품질 (답변 길이, 코드 포함 여부)
   * 2. 다양성 (소분류 균등 분배)
   * 3. 최신성 (최근 데이터 우선)
   */
  _selectRepresentative(items, count) {
    // 품질 점수 계산
    const scored = items.map((item) => ({
      ...item,
      qualityScore: this._calculateQuality(item),
    }));

    // 소분류별 균등 분배
    const subGroups = {};
    for (const item of scored) {
      const subKey = item.subcategoryLabel || item.subcategory || '기타';
      if (!subGroups[subKey]) subGroups[subKey] = [];
      subGroups[subKey].push(item);
    }

    // 각 소분류 내 품질순 정렬
    for (const items of Object.values(subGroups)) {
      items.sort((a, b) => b.qualityScore - a.qualityScore);
    }

    // 라운드 로빈으로 균등 선별
    const selected = [];
    let round = 0;

    while (selected.length < count) {
      let added = false;
      for (const items of Object.values(subGroups)) {
        if (round < items.length && selected.length < count) {
          selected.push(items[round]);
          added = true;
        }
      }
      if (!added) break;
      round++;
    }

    // 다이제스트 형태로 변환
    return selected.map((item) => ({
      question: item.question,
      answer: this._summarizeAnswer(item.answer),
      category: item.categoryLabel || item.category,
      subcategory: item.subcategoryLabel || item.subcategory,
      source: item.source,
    }));
  }

  /**
   * 품질 점수 계산
   */
  _calculateQuality(item) {
    let score = 0;
    const answer = item.answer || '';

    // 답변 길이 (적정 길이 가산점)
    if (answer.length > 100) score += 1;
    if (answer.length > 300) score += 1;
    if (answer.length > 500) score += 1;

    // 코드 블록 포함
    if (/```/.test(answer)) score += 2;
    if (/<\/?[a-z]/i.test(answer)) score += 1;

    // 설정 경로 포함
    if (/\.xml|\.properties|\.json/i.test(answer)) score += 1;

    return score;
  }

  /**
   * 답변 요약 (다이제스트용, 최대 500자)
   */
  _summarizeAnswer(answer) {
    if (!answer) return '';
    if (answer.length <= 500) return answer;
    return answer.substring(0, 497) + '...';
  }

  /**
   * 다이제스트 저장
   */
  async save(digests, outputDir) {
    const outputPath = path.join(outputDir, 'category_digests.json');
    await fs.writeFile(outputPath, JSON.stringify(digests, null, 2), 'utf8');
    console.log(`[다이제스트] 저장 완료: ${outputPath}`);

    // 통계 출력
    let total = 0;
    for (const [category, items] of Object.entries(digests)) {
      total += items.length;
    }
    console.log(`[다이제스트] 전체 ${Object.keys(digests).length}개 카테고리, ${total}건`);
  }
}

module.exports = DigestGenerator;
