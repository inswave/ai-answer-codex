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
const { loadConfig } = require('../utils/config');
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
  'gridView', 'dataList', 'dataMap', 'true', 'false', 'null', 'undefined',
]);

const DEFAULT_DOC_EXTENSIONS = new Set(['.html', '.htm', '.xml']);
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectDeclaredUserNames(text) {
  const declared = new Set();
  const source = String(text || '');
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g,
    /\bscwin\.([A-Za-z_$][\w$]*)\s*=/g,
    /\bscwin\.([A-Za-z_$][\w$]*)\s*=\s*function\b/g,
    /\b([A-Za-z_$][\w$]*)\s*[:=]\s*function\s*\(/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      declared.add(match[1]);
    }
  }

  return declared;
}

function normalizeCandidateName(name, declaredNames) {
  const value = String(name || '').replace(/\(\)$/, '');
  if (!value) return '';
  if (/^fn_[A-Za-z0-9_]+$/.test(value)) return '';
  if (/^[a-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/.test(value)) return '';
  if (declaredNames.has(value)) return '';

  const parts = value.split('.');
  if (parts.length > 1) {
    const first = parts[0];
    const last = parts[parts.length - 1];

    if (declaredNames.has(last)) return '';
    if (EXCLUDE_LIST.has(first)) return last;
    if (first === '$p' || declaredNames.has(first)) return last;
  }

  return value;
}

class ApiVerifier {
  constructor() {
    this.searcherPath = path.join(__dirname, '../rag/searcher.py');
    this.pythonPath = resolvePythonPath();
    const config = loadConfig();
    this.localDocConfig = config.apiVerifier || {};
    this.apiGuideConfig = config.apiGuide || {};
    this.localDocIndex = null;
  }

  extractApiNames(answerText, options = {}) {
    const found = new Set();
    const patterns = options.includeProseTerms ? QUESTION_PATTERNS : API_PATTERNS;
    const declaredNames = collectDeclaredUserNames(answerText);

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(answerText || '')) !== null) {
        const name = normalizeCandidateName(match[1], declaredNames);
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

    const localResults = this.verifyBatchInLocalDocs(names);
    const localByName = new Map(localResults.map((item) => [item.name, item]));
    const hasAuthoritativeLocalDocs = this.hasLocalDocs();

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
          const ragResults = JSON.parse(line.substring('VERIFY_RESULT:'.length));
          return this.mergeVerificationResults(names, ragResults, localByName, hasAuthoritativeLocalDocs);
        }
      }
      return this.mergeVerificationResults(
        names,
        names.map(name => ({ name, found: false, error: 'parse_failed' })),
        localByName,
        hasAuthoritativeLocalDocs
      );
    } catch (err) {
      console.warn('[API verifier] batch verification failed:', err.message);
      return this.mergeVerificationResults(
        names,
        names.map(name => ({ name, found: false, error: err.message })),
        localByName,
        hasAuthoritativeLocalDocs
      );
    } finally {
      try { fs.unlinkSync(scriptPath); } catch {}
    }
  }

  mergeVerificationResults(names, ragResults, localByName, hasAuthoritativeLocalDocs) {
    const ragByName = new Map((ragResults || []).map((item) => [item.name, item]));

    return names.map((name) => {
      const local = localByName.get(name);
      const rag = ragByName.get(name) || { name, found: false };

      if (local?.found) {
        return {
          ...rag,
          name,
          found: true,
          source: local.source,
          sourceType: 'local-docs',
          matchedFile: local.matchedFile,
          ragFound: !!rag.found,
        };
      }

      if (hasAuthoritativeLocalDocs) {
        return {
          ...rag,
          name,
          found: false,
          source: rag.source,
          sourceType: rag.found ? 'rag-only' : 'none',
          error: rag.error,
        };
      }

      return {
        ...rag,
        name,
        sourceType: rag.found ? 'rag' : 'none',
      };
    });
  }

  hasLocalDocs() {
    return this.getLocalDocIndex().length > 0;
  }

  getLocalDocDirs() {
    const dirs = [];
    const configured = this.localDocConfig.sourceDirs || this.localDocConfig.sourceDir;
    if (Array.isArray(configured)) dirs.push(...configured);
    else if (configured) dirs.push(configured);
    if (this.apiGuideConfig.sourceDir) dirs.push(this.apiGuideConfig.sourceDir);

    return [...new Set(dirs)]
      .map((dir) => path.isAbsolute(dir) ? dir : path.join(__dirname, '../..', dir))
      .filter((dir) => {
        try {
          return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
        } catch (_) {
          return false;
        }
      });
  }

  getLocalDocIndex() {
    if (this.localDocIndex) return this.localDocIndex;

    const extensions = new Set(
      (this.localDocConfig.extensions || [...DEFAULT_DOC_EXTENSIONS])
        .map((ext) => ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`)
    );
    const maxBytes = Number(this.localDocConfig.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
    const files = [];

    const visit = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(fullPath);
          continue;
        }
        if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > maxBytes) continue;
          files.push({
            path: fullPath,
            text: fs.readFileSync(fullPath, 'utf8'),
          });
        } catch (_) {
          // Skip unreadable docs.
        }
      }
    };

    for (const dir of this.getLocalDocDirs()) visit(dir);
    this.localDocIndex = files;
    return this.localDocIndex;
  }

  verifyBatchInLocalDocs(apiNames) {
    const docs = this.getLocalDocIndex();
    if (docs.length === 0) {
      return apiNames.map((name) => ({ name, found: false }));
    }

    return apiNames.map((name) => {
      const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(name)}([^A-Za-z0-9_$]|$)`);
      const match = docs.find((doc) => pattern.test(doc.text));
      if (!match) return { name, found: false };

      return {
        name,
        found: true,
        source: path.relative(path.join(__dirname, '../..'), match.path),
        matchedFile: match.path,
      };
    });
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
