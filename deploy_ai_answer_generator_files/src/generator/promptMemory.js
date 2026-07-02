const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_CHARS = 6000;

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function resolveMaybeRelative(filePath) {
  if (!filePath) return '';
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(__dirname, '../..', filePath);
}

function getConfiguredPaths(config = {}) {
  const answer = config.answer || {};
  const explicit = Array.isArray(answer.memoryPaths)
    ? answer.memoryPaths
    : [answer.memoryPath].filter(Boolean);

  const codexHome = config.codexExec?.env?.CODEX_HOME || process.env.CODEX_HOME;
  const defaults = [
    path.join(__dirname, '../../MEMORY.md'),
    codexHome ? path.join(codexHome, 'MEMORY.md') : '',
    codexHome ? path.join(codexHome, 'memories', 'MEMORY.md') : '',
    codexHome ? path.join(codexHome, 'memories', 'feedback.md') : '',
  ];

  return unique([...explicit, ...defaults].map(resolveMaybeRelative));
}

function readFirstExisting(paths) {
  for (const filePath of paths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size === 0) continue;
      return {
        path: filePath,
        content: fs.readFileSync(filePath, 'utf8'),
      };
    } catch (_) {
      // Memory is advisory. Ignore unreadable files and continue.
    }
  }
  return null;
}

function buildPromptMemory(config = {}) {
  const answer = config.answer || {};
  if (answer.memoryEnabled === false) return '';

  const found = readFirstExisting(getConfiguredPaths(config));
  if (!found) return '';

  const maxChars = Number(answer.memoryMaxChars || DEFAULT_MAX_CHARS);
  const content = found.content
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maxChars);

  if (!content) return '';

  return [
    '## Persistent User Feedback Memory',
    '',
    'Apply these feedback notes before all other style preferences. Do not quote this section in the final answer.',
    '',
    content,
  ].join('\n');
}

module.exports = {
  buildPromptMemory,
  getConfiguredPaths,
};
