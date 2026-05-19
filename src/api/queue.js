/**
 * 검수 큐 데이터 관리 모듈
 * data/queue.json 읽기/쓰기/상태 변경
 */

const fs = require('fs');
const path = require('path');

const QUEUE_PATH = path.join(__dirname, '../../data/queue.json');

function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf8');
}

function generateId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(readQueue().filter(q =>
    q.id.startsWith(date)
  ).length + 1).padStart(3, '0');
  return `${date}-${seq}`;
}

/**
 * 큐에 답변 추가
 */
function addToQueue({ question, answer, classification, sources, filePath }) {
  const queue = readQueue();
  const item = {
    id: generateId(),
    question,
    answer,
    classification: classification || null,
    sources: sources || [],
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    filePath: filePath || null,
  };
  queue.unshift(item);
  writeQueue(queue);
  return item;
}

/**
 * 상태 변경 (pending → approved / rejected)
 */
function updateStatus(id, status) {
  const queue = readQueue();
  const item = queue.find(q => q.id === id);
  if (!item) return null;
  item.status = status;
  item.reviewedAt = new Date().toISOString();
  writeQueue(queue);
  return item;
}

/**
 * 답변 내용 수정
 */
function updateAnswer(id, answer) {
  const queue = readQueue();
  const item = queue.find(q => q.id === id);
  if (!item) return null;
  item.answer = answer;
  item.editedAt = new Date().toISOString();
  writeQueue(queue);
  return item;
}

/**
 * 큐 목록 조회 (status 필터 옵션)
 */
function listQueue(statusFilter) {
  const queue = readQueue();
  if (!statusFilter || statusFilter === 'all') return queue;
  return queue.filter(q => q.status === statusFilter);
}

/**
 * ID로 항목 조회
 */
function getById(id) {
  return readQueue().find(q => q.id === id) || null;
}

module.exports = { addToQueue, updateStatus, updateAnswer, listQueue, getById, readQueue };
