/**
 * RAG 벡터 인덱스 구축
 * 13,512건의 기술문의 데이터를 벡터 임베딩으로 변환하여 저장
 *
 * 사용법: node rag/build_index.js
 */
const { LocalIndex } = require('vectra');
const { pipeline } = require('@xenova/transformers');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INDEX_DIR = path.join(__dirname, 'vector_index');

// === 데이터 로드 ===
function loadAllData() {
  const items = [];

  // W-Tech QNA
  console.log('W-Tech QNA 로드...');
  const qna = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtech', 'qna_data.json'), 'utf-8'));
  for (const item of qna) {
    const answers = (item.comments || []).map(c => c.content || '').filter(c => c.length > 10).join('\n');
    items.push({
      id: `qna_${item.num}`,
      text: `${item.title || ''} ${item.question || ''} ${answers}`.substring(0, 1500),
      metadata: {
        source: 'W-Tech QNA',
        title: item.title || '',
        date: item.date || '',
        status: item.status || '',
        question: (item.question || '').substring(0, 500),
        answer: answers.substring(0, 1000),
      },
    });
  }

  // Gmail
  console.log('Gmail 로드...');
  const emails = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'email', 'email_technical_qna.json'), 'utf-8'));
  for (const item of emails) {
    const parts = (item.content || '').split(/\n\s*A:\s*/);
    items.push({
      id: `email_${item.threadId || items.length}`,
      text: `${item.subject || ''} ${item.content || ''}`.substring(0, 1500),
      metadata: {
        source: 'Gmail',
        title: item.subject || '',
        date: item.date || '',
        status: '',
        question: (parts[0]?.replace(/^Q:\s*/, '') || '').substring(0, 500),
        answer: (parts.slice(1).join('\n') || '').substring(0, 1000),
      },
    });
  }

  // Confluence
  const confFiles = [
    ['confluence_inside_data.json', 'Confluence Inside'],
    ['confluence_db_data.json', 'Confluence 기술DB'],
    ['confluence_uxdb_data.json', 'Confluence UXDB'],
    ['confluence_pa_data.json', 'Confluence PA'],
    ['confluence_w5c_data.json', 'Confluence W5C'],
  ];
  for (const [file, source] of confFiles) {
    console.log(`${source} 로드...`);
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'confluence', file), 'utf-8'));
    for (const item of data) {
      items.push({
        id: `${source.replace(/\s/g, '_')}_${item.pageId || items.length}`,
        text: `${item.title || ''} ${(item.content || '').substring(0, 1200)}`,
        metadata: {
          source,
          title: item.title || '',
          date: item.lastModified || '',
          status: '',
          question: '',
          answer: (item.content || '').substring(0, 1000),
          url: item.url || '',
        },
      });
    }
  }

  // FAQ
  console.log('FAQ 로드...');
  const faq = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wtech', 'faq_data.json'), 'utf-8'));
  for (const item of faq) {
    items.push({
      id: `faq_${item.num || items.length}`,
      text: `${item.title || ''} ${item.answer || ''}`.substring(0, 1500),
      metadata: {
        source: 'FAQ',
        title: item.title || '',
        date: '',
        status: '',
        question: item.title || '',
        answer: (item.answer || '').substring(0, 1000),
      },
    });
  }

  // API Guide
  console.log('API Guide 로드...');
  const api = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'api', 'ws5_api_guide.json'), 'utf-8'));
  for (const item of api) {
    items.push({
      id: `api_${item.component || items.length}`,
      text: `${item.component || ''} ${item.title || ''} ${(item.content || '').substring(0, 1200)}`,
      metadata: {
        source: 'API Guide',
        title: item.title || '',
        date: '',
        status: '',
        question: '',
        answer: (item.content || '').substring(0, 1000),
      },
    });
  }

  console.log(`\n총 ${items.length.toLocaleString()}건 로드 완료\n`);
  return items;
}

// === 메인 ===
async function main() {
  console.log('=== RAG 벡터 인덱스 구축 ===\n');

  // 임베딩 모델 로드 (한국어 지원 다국어 모델)
  console.log('임베딩 모델 로드 중... (최초 실행 시 다운로드)');
  console.log('모델: Xenova/paraphrase-multilingual-MiniLM-L12-v2\n');

  const embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');

  // 임베딩 함수
  async function getEmbedding(text) {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  // 벡터 인덱스 초기화
  console.log('벡터 인덱스 초기화...');
  if (fs.existsSync(INDEX_DIR)) {
    fs.rmSync(INDEX_DIR, { recursive: true });
  }

  const index = new LocalIndex(INDEX_DIR);
  await index.createIndex();

  // 데이터 로드
  const items = loadAllData();

  // 배치 임베딩 & 저장
  console.log('벡터 임베딩 & 인덱싱 시작...\n');
  const BATCH = 50;
  const startTime = Date.now();
  let indexed = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);

    for (const item of batch) {
      try {
        const vector = await getEmbedding(item.text);
        await index.insertItem({
          vector,
          metadata: item.metadata,
        });
        indexed++;
      } catch (err) {
        // skip
      }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const progress = Math.min(i + BATCH, items.length);
    const speed = progress / elapsed;
    const eta = (items.length - progress) / speed;

    process.stdout.write(
      `\r  ${progress.toLocaleString()}/${items.length.toLocaleString()} ` +
      `(${(progress / items.length * 100).toFixed(1)}%) | ` +
      `${speed.toFixed(0)}건/초 | 남은시간: ${Math.ceil(eta)}초`
    );
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n=== 완료 ===`);
  console.log(`인덱싱: ${indexed.toLocaleString()}건`);
  console.log(`소요시간: ${totalTime}초`);
  console.log(`인덱스 경로: ${INDEX_DIR}`);
}

main().catch(err => {
  console.error('오류:', err);
  process.exit(1);
});
