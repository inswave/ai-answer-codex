/**
 * WebSquare API/property verifier.
 *
 * The generator can mention API, event, and property names that do not exist in
 * the local RAG index. This verifier extracts likely names and checks whether
 * each one appears in the indexed documents.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolvePythonPath } = require('../utils/pythonPath');

const API_PATTERNS = [
  // Inline code spans: `useSaveGridView`, `getCurrentGridStyle()`.
  /`([A-Za-z_$][\w$./:-]{3,})(?:\(\))?`/g,
  // Function calls: getCellData(), setFocusedCell(), openPopup().
  /\b(get[A-Z]\w+|set[A-Z]\w+|remove[A-Z]\w+|add[A-Z]\w+|insert[A-Z]\w+|delete[A-Z]\w+|create[A-Z]\w+|execute[A-Z]\w+|open[A-Z]\w+|close[A-Z]\w+)\s*\(/g,
  // Events: oncellclick, onkeydown, onviewchange.
  /\b(on[a-z]{2,}(?:[a-z]*)?)\b/g,
  // XML/JSON attributes: enterKeyMove="...", focusMode: "...".
  /\b([a-z]+(?:[A-Z][a-z]+){1,})\s*[=:"]/g,
];

const QUESTION_PATTERNS = [
  ...API_PATTERNS,
  // Prose camelCase terms from the customer question.
  /\b([a-z]+(?:[A-Z][A-Za-z0-9]+){1,})\b/g,
];

const EXCLUDE_LIST = new Set([
  'addEventListener', 'removeEventListener', 'preventDefault', 'stopPropagation',
  'getElementById', 'querySelector', 'querySelectorAll', 'getAttribute', 'setAttribute',
  'appendChild', 'createElement', 'insertBefore', 'removeChild',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'parseInt', 'parseFloat', 'toString', 'indexOf', 'substring', 'replace',
  'onclick', 'onload', 'onchange', 'onsubmit', 'onfocus', 'onblur',
  'onkeydown', 'onkeyup', 'onkeypress', 'onmousedown', 'onmouseup', 'onmouseover',
  'console', 'document', 'window', 'JSON', 'encodeURIComponent',
  'textContent', 'innerHTML', 'fontWeight', 'fontSize', 'marginLeft',
  'backgroundColor', 'borderColor', 'textColor', 'borderBottom',
  'LocalStorage', 'localStorage', 'sessionStorage', 'WebSquare',
  'gridView', 'dataList', 'dataMap', 'true', 'false',
]);

class ApiVerifier {
  constructor() {
    this.searcherPath = path.join(__dirname, '../rag/searcher.py');
    this.pythonPath = resolvePythonPath();
  }

  extractApiNames(answerText, options = {}) {
    const found = new Set();
    const patterns = options.includeProseTerms ? QUESTION_PATTERNS : API_PATTERNS;

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(answerText || '')) !== null) {
        const name = String(match[1] || '').replace(/\(\)$/, '');
        if (name.length >= 4 && !EXCLUDE_LIST.has(name)) {
          found.add(name);
        }
      }
    }

    return [...found];
  }

  verifyOne(apiName) {
    const [result] = this.verifyBatch([apiName]);
    return result || { name: apiName, found: false };
  }

  verifyBatch(apiNames) {
    const names = [...new Set(apiNames || [])].filter(Boolean);
    if (names.length === 0) return [];

    const scriptPath = path.join(os.tmpdir(), `techassistant-verify-${process.pid}-${Date.now()}.py`);

    try {
      fs.writeFileSync(scriptPath, `
import sys, json
from pathlib import Path
import chromadb

client = chromadb.PersistentClient(path=str(Path('data') / 'chroma'))
collection = client.get_collection(name='techassistant_qa')
names = json.loads(sys.argv[1])
results = []

for name in names:
    try:
        r = collection.get(
            where_document={'$contains': name},
            limit=1,
            include=['metadatas']
        )
        if r.get('ids'):
            m = (r.get('metadatas') or [{}])[0] or {}
            results.append({'name': name, 'found': True, 'source': m.get('source','')})
        else:
            results.append({'name': name, 'found': False})
    except Exception as e:
        results.append({'name': name, 'found': False, 'error': str(e)})

print('VERIFY_RESULT:' + json.dumps(results, ensure_ascii=False))
`, 'utf8');

      const output = execFileSync(
        this.pythonPath,
        ['-u', scriptPath, JSON.stringify(names)],
        {
          encoding: 'utf8',
          timeout: 60000,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        }
      );

      const lines = output.trim().split('\n');
      for (const line of lines) {
        if (line.startsWith('VERIFY_RESULT:')) {
          return JSON.parse(line.substring('VERIFY_RESULT:'.length));
        }
      }
      return names.map(name => ({ name, found: false, error: 'parse_failed' }));
    } catch (err) {
      console.warn('[API verifier] batch verification failed:', err.message);
      return names.map(name => ({ name, found: false, error: err.message }));
    } finally {
      try { fs.unlinkSync(scriptPath); } catch {}
    }
  }

  verify(answerText) {
    const apiNames = this.extractApiNames(answerText);

    if (apiNames.length === 0) {
      return { verified: [], unverified: [], warnings: [], summary: 'No API/property names to verify' };
    }

    console.log(`[API verifier] verifying ${apiNames.length}: ${apiNames.join(', ')}`);
    const results = this.verifyBatch(apiNames);
    const verified = results.filter(r => r.found);
    const unverified = results.filter(r => !r.found);
    const warnings = unverified.map(r =>
      `"${r.name}" was not found in the local RAG index. Confirm it exists before using it.`
    );

    return {
      verified,
      unverified,
      warnings,
      summary: `Verified ${apiNames.length}: ${verified.length} found, ${unverified.length} unconfirmed`,
    };
  }

  verifyQuestionTerms(questionText) {
    const apiNames = this.extractApiNames(questionText, { includeProseTerms: true });
    const results = this.verifyBatch(apiNames);
    return {
      candidates: apiNames,
      verified: results.filter(r => r.found),
      unverified: results.filter(r => !r.found),
    };
  }
}

module.exports = ApiVerifier;
