#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildPromptMemory } = require('../src/generator/promptMemory');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techassistant-memory-'));
const memoryPath = path.join(tmpDir, 'MEMORY.md');

fs.writeFileSync(
  memoryPath,
  [
    '# Feedback',
    '- 답변은 짧고 명확하게 작성한다.',
    '- 확인되지 않은 API를 지어내지 않는다.',
  ].join('\n'),
  'utf8'
);

const promptMemory = buildPromptMemory({
  answer: {
    memoryEnabled: true,
    memoryPath,
    memoryMaxChars: 2000,
  },
});

assert.match(promptMemory, /Persistent User Feedback Memory/);
assert.match(promptMemory, /답변은 짧고 명확하게/);
assert.match(promptMemory, /확인되지 않은 API/);

const disabled = buildPromptMemory({
  answer: {
    memoryEnabled: false,
    memoryPath,
  },
});
assert.strictEqual(disabled, '');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('promptMemory tests passed');
