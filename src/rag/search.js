/**
 * RAG 의미 기반 검색
 * 사용법: node rag/search.js "검색어" [결과수]
 *
 * 키워드가 정확히 안 맞아도 의미가 유사하면 찾아줍니다!
 * 예: "셀 합치기" → "셀 병합" 관련 문서 검색
 */
const { LocalIndex } = require('vectra');
const { pipeline } = require('@xenova/transformers');
const path = require('path');

const INDEX_DIR = path.join(__dirname, 'vector_index');

let embedder = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  }
  return embedder;
}

async function search(query, topK = 10) {
  const emb = await getEmbedder();
  const output = await emb(query, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data);

  const index = new LocalIndex(INDEX_DIR);
  const allResults = await index.queryItems(vector, topK);
  // 유사도 30% 이상만 필터링
  const results = allResults.filter(r => r.score >= 0.3);

  return results;
}

function formatResults(results, query) {
  const lines = [];
  lines.push(`검색어: "${query}"`);
  lines.push(`결과: ${results.length}건\n`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const m = r.item.metadata;
    const similarity = (r.score * 100).toFixed(1);

    lines.push('─'.repeat(70));
    lines.push(`[${i + 1}] ${m.title}`);
    lines.push(`    유사도: ${similarity}% | 소스: ${m.source} | 날짜: ${m.date}`);
    if (m.url) lines.push(`    URL: ${m.url}`);

    if (m.question) {
      lines.push(`\n  [질문] ${m.question.substring(0, 400)}`);
    }
    if (m.answer) {
      lines.push(`\n  [답변] ${m.answer.substring(0, 800)}`);
      if (m.answer.length > 800) lines.push('  ... (생략)');
    }
    lines.push('');
  }

  lines.push('─'.repeat(70));
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node rag/search.js "검색어" [결과수]');
    console.log('');
    console.log('의미 기반 검색 예시:');
    console.log('  node rag/search.js "셀 합치기"           ← "셀 병합" 검색됨!');
    console.log('  node rag/search.js "화면이 느려요"        ← 성능 관련 검색');
    console.log('  node rag/search.js "엑셀 저장하면 깨져요"  ← 엑셀 오류 검색');
    console.log('  node rag/search.js "그리드에서 행 지우기"  ← 행 삭제 검색');
    process.exit(0);
  }

  const query = args[0];
  const topK = parseInt(args[1]) || 10;

  console.log('모델 로딩 중...\n');
  const results = await search(query, topK);
  console.log(formatResults(results, query));
}

// 외부에서 사용 가능하도록 export
module.exports = { search, getEmbedder };

// CLI로 직접 실행할 때만 main() 호출
if (require.main === module) {
  main().catch(console.error);
}
