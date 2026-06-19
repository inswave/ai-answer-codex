/**
 * Answer generation pipeline.
 * Input question -> classify -> RAG search -> LLM answer -> API verification -> save.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const Classifier = require('../classifier/classifier');
const AnswerGenerator = require('./answerGenerator');
const ApiVerifier = require('./apiVerifier');
const { addToQueue } = require('../api/queue');
const { parseRagResults, buildRagContext } = require('../rag/parseRagResults');
const { maskSensitiveInfo } = require('../utils/masking');
const {
  MODES,
  evaluateAnswerPolicy,
  appendPolicyNotice,
} = require('./answerPolicy');
const { buildQuestionAttachmentContext } = require('./attachmentContext');
const { buildMcpContext } = require('./mcpContext');
const { resolvePythonPath } = require('../utils/pythonPath');
const {
  extractEntities,
  evaluateRagConfidence,
  buildRefinementCandidates,
  mergeRagCases,
} = require('./queryRefinement');
const { loadConfig } = require('../utils/config');

const REFINEMENT_DEFAULTS = {
  enabled: true,
  confidenceThreshold: 0.6,
  maxRefinementSearches: 2,
};

// [2026-06-19] 상주 RAG 검색 서버 (방안2). 임베딩 모델을 매 요청 콜드로딩하던 ~18초를 제거.
//   서버가 없거나 실패하면 _searchRAG가 기존 Python subprocess 방식으로 자동 폴백한다.
const RAG_SERVER_DEFAULTS = {
  enabled: true,
  host: '127.0.0.1',
  port: 8765,
  // 정상이면 수백 ms. 이를 넘으면 빠르게 폴백하도록 짧게 둔다(폴백 실효성 확보).
  timeoutMs: 15000,
};

// 상주 RAG 서버에 검색 요청 → CLI와 동일한 텍스트(stdout 포맷) 반환.
function httpRagSearch(config, query, options) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;       // 이중 settle(타임아웃→destroy→error) 방어
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    const body = JSON.stringify({
      query,
      topK: options.topK || 8,
      category: options.categoryFilter || null,
    });
    const req = http.request(
      {
        host: config.host,
        port: config.port,
        path: '/search',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: config.timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) done(null, data);
          else done(new Error(`RAG server status ${res.statusCode}: ${data.slice(0, 200)}`));
        });
      }
    );
    req.on('error', (err) => done(err));
    req.on('timeout', () => { req.destroy(new Error('RAG server timeout')); });
    req.write(body);
    req.end();
  });
}

// [2026-06-19] 답변 캐시 (방안1-D): 동일 질문 재요청 시 codex/RAG 스킵하고 즉시 반환.
//   - 추가 비용 0원, 디스크 JSON 파일 1개로 프로세스 재시작 후에도 유지.
//   - config.answerCache 로 끄거나 TTL 조정 가능. 첨부가 있는 질문은 캐시 제외(OCR 결과 가변).
const ANSWER_CACHE_DEFAULTS = {
  enabled: true,
  ttlMs: 30 * 24 * 60 * 60 * 1000, // 30일
  maxEntries: 500,
};
const ANSWER_CACHE_PATH = path.join(__dirname, '../../data/cache/answer-cache.json');

function normalizeQuestionForCache(question) {
  // 기술 질문은 괄호/점/언더스코어 등이 의미 구별자(예: grid.setEnable(true))이므로 제거하지 않는다.
  // 공백 정규화 + 소문자화만 적용해 의미가 다른 질문이 같은 키를 갖지 않도록 한다.
  return String(question || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAnswerCacheKey(question, options = {}) {
  const basis = JSON.stringify({
    q: normalizeQuestionForCache(question),
    v: options.version || '',
    l: JSON.stringify(options.libraries ?? null),
    c: options.categoryFilter || '',
  });
  return crypto.createHash('sha1').update(basis).digest('hex');
}

function readAnswerCache() {
  try {
    if (!fs.existsSync(ANSWER_CACHE_PATH)) return {};
    return JSON.parse(fs.readFileSync(ANSWER_CACHE_PATH, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function writeAnswerCache(store, maxEntries) {
  try {
    let entries = Object.entries(store);
    // 오래된 항목부터 잘라 maxEntries 유지
    if (entries.length > maxEntries) {
      entries = entries
        .sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0))
        .slice(0, maxEntries);
    }
    fs.mkdirSync(path.dirname(ANSWER_CACHE_PATH), { recursive: true });
    fs.writeFileSync(ANSWER_CACHE_PATH, JSON.stringify(Object.fromEntries(entries), null, 2), 'utf8');
  } catch (err) {
    console.warn('[Pipeline] answer cache write failed:', err.message);
  }
}

function buildQuestionTermContext(questionTermVerification) {
  const unverified = questionTermVerification?.unverified || [];
  if (unverified.length === 0) return '';

  return [
    '## Customer-mentioned API/property verification',
    '',
    'The following names appeared in the customer question but were not found in the local RAG/API index.',
    'Do not treat them as official WebSquare APIs/properties unless another provided source confirms them.',
    'If they are central to the question, answer concisely and state that they may be a project custom setting or a typo.',
    '',
    ...unverified.map(item => `- ${item.name}`),
  ].join('\n');
}

class AnswerPipeline {
  constructor() {
    this.classifier = new Classifier();
    this.generator = new AnswerGenerator();
    this.verifier = new ApiVerifier();
    this.ragSearcherPath = path.join(__dirname, '../rag/searcher.py');

    const cfg = loadConfig();
    this.refinementConfig = {
      ...REFINEMENT_DEFAULTS,
      ...(cfg.refinement || {}),
    };
    this.answerCacheConfig = {
      ...ANSWER_CACHE_DEFAULTS,
      ...(cfg.answerCache || {}),
    };
    this.ragServerConfig = {
      ...RAG_SERVER_DEFAULTS,
      ...(cfg.ragServer || {}),
    };
    if (process.env.RAG_SERVER_PORT) {
      this.ragServerConfig.port = Number(process.env.RAG_SERVER_PORT);
    }
  }

  /**
   * Run the full answer pipeline.
   *
   * @param {string} question - customer support question
   * @param {object} options - { version, libraries, topK, categoryFilter }
   * @returns {object} - { answer, classification, ragResults, usage }
   */
  async process(question, options = {}) {
    console.log('[Pipeline] start');
    const __t0 = Date.now();

    const safeQuestion = maskSensitiveInfo(question);

    // [2026-06-19] 캐시 조회 (방안1-D). 첨부 없는 질문만 대상.
    const cacheEligible = this.answerCacheConfig.enabled && (options.attachments || []).length === 0;
    const cacheKey = cacheEligible ? buildAnswerCacheKey(safeQuestion, options) : null;
    if (cacheEligible) {
      const store = readAnswerCache();
      const hit = store[cacheKey];
      if (hit && (Date.now() - (hit.savedAt || 0)) < this.answerCacheConfig.ttlMs) {
        console.log(`[Pipeline] cache hit → codex/RAG 스킵, 즉시 반환 [done in ${Date.now() - __t0}ms, cache]`);
        return { ...hit.result, fromCache: true };
      }
    }

    const classification = this.classifier.classify({ question: safeQuestion, answer: '' });
    console.log(`[Pipeline] classification: ${classification.categoryLabel} > ${classification.subcategoryLabel}`);

    // [2026-06-01] 서비스 요청(라이선스/데모/엔진·플러그인 파일 제공/계약·권한 등)은 기술 답변(RAG/Claude) 대상이 아님.
    //   질문 기준으로 먼저 판정해 BLOCKED면 RAG/LLM 스킵 + 참고자료 없이 담당자 안내 템플릿만 반환.
    const precheck = evaluateAnswerPolicy({ question: safeQuestion, cases: [] });
    if (precheck.answerMode === MODES.BLOCKED) {
      console.log('[Pipeline] BLOCKED 서비스 요청 → RAG/LLM 스킵, 템플릿 응답(참고자료 없음)');
      // 일반 답변과 동일한 인사말/맺음말을 쓰도록 config.answer 템플릿을 코드로 적용 (LLM 안 거치므로 직접 치환)
      const answerCfg = (loadConfig() || {}).answer || {};
      const responderName = answerCfg.responderName || 'AI 답변';
      const answerTemplate = answerCfg.template
        || '안녕하세요.\n인스웨이브 기술지원팀 {{name}}입니다.\n\n{{content}}\n\n감사합니다.';
      const blockedBody = '문의해 주신 내용은 담당 엔지니어 확인이 필요한 사안입니다.\n엔지니어 추가 답변 요청을 부탁드립니다.';
      const blockedAnswer = answerTemplate
        .replace('{{name}}', responderName)
        .replace('{{topic}}', '요청하신 사항')
        .replace('{{content}}', blockedBody);
      console.log(`[Pipeline] done in ${Date.now() - __t0}ms (blocked)`);
      return {
        question: safeQuestion,
        classification,
        ragResults: { context: '', resultCount: 0, cases: [] },
        mcpContext: { enabled: false, available: false, items: [], sources: [], errors: [] },
        attachmentContext: { context: '', summary: { total: 0 }, policyText: '' },
        answer: blockedAnswer,
        hasRagResults: false,
        sources: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        model: null,
        verification: { verified: [], unverified: [], summary: 'skipped (blocked service request)' },
        questionTermVerification: { verified: [], unverified: [] },
        answerPolicy: precheck,
        answerMode: precheck.answerMode,
        riskLevel: precheck.riskLevel,
        needsHumanReview: precheck.needsHumanReview,
        reviewReasons: precheck.reviewReasons,
        requiredInfo: precheck.requiredInfo,
        savedPath: null,
      };
    }

    const __tRag = Date.now();
    const ragResult = await this._searchRAGMultiStep(safeQuestion, options);
    const safeRagContext = maskSensitiveInfo(ragResult.context);
    console.log(`[Pipeline] RAG results: ${ragResult.resultCount}${ragResult.refinementUsed ? ' (with refinement)' : ''} [${Date.now() - __tRag}ms]`);
    const mcpContext = await buildMcpContext(safeQuestion, ragResult.cases, options);
    if (mcpContext.enabled) {
      console.log(`[Pipeline] MCP context: ${mcpContext.available ? `${mcpContext.items.length} items` : 'unavailable'}`);
      if (mcpContext.errors.length > 0) {
        console.warn(`[Pipeline] MCP warnings: ${mcpContext.errors.join('; ')}`);
      }
    }
    const attachmentContext = buildQuestionAttachmentContext(options.attachments || []);
    if (attachmentContext.summary.total > 0) {
      console.log(`[Pipeline] attachments: ${attachmentContext.summary.total}, OCR: ${attachmentContext.summary.imageOcrCount}/${attachmentContext.summary.imagePayloadCount}`);
    }
    const questionTermVerification = this.verifier.verifyQuestionTerms(safeQuestion);
    const questionTermContext = buildQuestionTermContext(questionTermVerification);
    if (questionTermVerification.unverified.length > 0) {
      console.warn(`[Pipeline] unverified question terms: ${questionTermVerification.unverified.map(r => r.name).join(', ')}`);
    }
    const generationContext = [safeRagContext, mcpContext.context, attachmentContext.context, questionTermContext]
      .filter(Boolean)
      .join('\n\n');
    const sources = [
      safeRagContext ? 'RAG' : null,
      ...mcpContext.sources,
    ].filter(Boolean);
    // [2026-06-02] 위험도 격상은 사용자 질문(+첨부)만 기준으로 판정한다.
    //   RAG 이웃 사례 본문을 cases로 넘기면 사례에 섞인 패치/접근성 등 키워드가
    //   멀쩡한 질문을 human_review/blocked로 오격상시키므로 cases를 넘기지 않는다.
    const answerPolicy = evaluateAnswerPolicy({
      question: [safeQuestion, attachmentContext.policyText].filter(Boolean).join('\n\n'),
    });
    console.log(`[Pipeline] answer policy: ${answerPolicy.answerMode} (${answerPolicy.riskLevel})`);

    const MAX_RETRIES = 1;
    const __tGen = Date.now();
    let result = await this.generator.generate(safeQuestion, generationContext, {
      version: options.version,
      libraries: options.libraries,
      answerPolicy,
      questionTermVerification,
    });
    result.answer = maskSensitiveInfo(result.answer, { maskFilenames: false });
    console.log(`[Pipeline] answer generated (${result.usage.inputTokens + result.usage.outputTokens} tokens) [${Date.now() - __tGen}ms]`);

    let verification = this.verifier.verify(result.answer);
    console.log(`[Pipeline] ${verification.summary}`);

    let retryCount = 0;
    while (verification.unverified.length > 0 && retryCount < MAX_RETRIES) {
      retryCount++;
      const invalidApis = verification.unverified.map((r) => r.name);
      console.log(`[Pipeline] unverified APIs, regenerating (${retryCount}/${MAX_RETRIES}): ${invalidApis.join(', ')}`);

      result = await this.generator.regenerate(
        safeQuestion,
        generationContext,
        result.answer,
        invalidApis,
        { version: options.version, libraries: options.libraries, answerPolicy, questionTermVerification }
      );
      result.answer = maskSensitiveInfo(result.answer, { maskFilenames: false });
      console.log(`[Pipeline] regenerated (${result.usage.inputTokens + result.usage.outputTokens} tokens)`);

      verification = this.verifier.verify(result.answer);
      console.log(`[Pipeline] ${verification.summary}`);
    }

    if (verification.unverified.length > 0) {
      result.answer += '\n\n---\n**검증 경고**: 아래 API/속성은 내부 데이터에서 확인되지 않았습니다. 실제 존재 여부를 확인해주세요.\n';
      for (const item of verification.unverified) {
        result.answer += `- \`${item.name}\`\n`;
      }
    }
    result.answer = appendPolicyNotice(result.answer, answerPolicy);
    result.sources = sources;

    const savedPath = this._saveAnswer(safeQuestion, result, classification);
    if (savedPath) {
      console.log(`[Pipeline] answer saved: ${savedPath}`);
    }

    try {
      const queueItem = addToQueue({
        question: safeQuestion,
        answer: result.answer,
        classification,
        sources,
        filePath: savedPath,
      });
      console.log(`[Pipeline] queued: ${queueItem.id}`);
    } catch (err) {
      console.warn('[Pipeline] queue add failed:', err.message);
    }

    const response = {
      question: safeQuestion,
      classification,
      ragResults: { ...ragResult, context: safeRagContext },
      mcpContext,
      attachmentContext,
      answer: result.answer,
      hasRagResults: result.hasRagResults,
      sources,
      usage: result.usage,
      model: result.model,
      verification,
      questionTermVerification,
      answerPolicy,
      answerMode: answerPolicy.answerMode,
      riskLevel: answerPolicy.riskLevel,
      needsHumanReview: answerPolicy.needsHumanReview,
      reviewReasons: answerPolicy.reviewReasons,
      requiredInfo: answerPolicy.requiredInfo,
      savedPath,
    };

    // [2026-06-19] 캐시 저장 (방안1-D). BLOCKED/early-return 경로는 위에서 이미 빠져 캐시 안 함.
    //   디스크 평문 저장이므로 무마스킹 원문(rawContext)·MCP 원문(items)·첨부 OCR 본문은 제외하고
    //   재현에 필요한 마스킹 완료 필드만 저장한다.
    if (cacheEligible && cacheKey) {
      const cacheable = {
        ...response,
        ragResults: {
          context: response.ragResults?.context || '',
          resultCount: response.ragResults?.resultCount || 0,
        },
        mcpContext: {
          enabled: !!response.mcpContext?.enabled,
          available: !!response.mcpContext?.available,
          sources: response.mcpContext?.sources || [],
        },
        attachmentContext: {
          summary: response.attachmentContext?.summary || { total: 0 },
        },
      };
      const store = readAnswerCache();
      store[cacheKey] = { savedAt: Date.now(), result: cacheable };
      writeAnswerCache(store, this.answerCacheConfig.maxEntries);
    }

    console.log(`[Pipeline] done in ${Date.now() - __t0}ms (total, retries=${retryCount})`);
    return response;
  }

  /**
   * Follow-up answer generation using original question, previous answer, and new question.
   *
   * @param {object} context - { originalQuestion, previousAnswer, followUp }
   * @param {object} options - { version, libraries, topK }
   * @returns {object} - { answer, ragResults, usage, model, verification, savedPath }
   */
  async processFollowUp(context, options = {}) {
    const safeOriginalQuestion = maskSensitiveInfo(context.originalQuestion);
    const safePreviousAnswer = maskSensitiveInfo(context.previousAnswer);
    const safeFollowUp = maskSensitiveInfo(context.followUp);

    console.log('[Pipeline] follow-up start');
    const __t0 = Date.now();

    const ragResult = await this._searchRAGMultiStep(safeFollowUp, options);
    const safeRagContext = maskSensitiveInfo(ragResult.context);
    console.log(`[Pipeline] follow-up RAG results: ${ragResult.resultCount}${ragResult.refinementUsed ? ' (with refinement)' : ''}`);
    const mcpContext = await buildMcpContext(safeFollowUp, ragResult.cases, options);
    if (mcpContext.enabled) {
      console.log(`[Pipeline] follow-up MCP context: ${mcpContext.available ? `${mcpContext.items.length} items` : 'unavailable'}`);
      if (mcpContext.errors.length > 0) {
        console.warn(`[Pipeline] follow-up MCP warnings: ${mcpContext.errors.join('; ')}`);
      }
    }
    const attachmentContext = buildQuestionAttachmentContext(options.attachments || []);
    if (attachmentContext.summary.total > 0) {
      console.log(`[Pipeline] follow-up attachments: ${attachmentContext.summary.total}, OCR: ${attachmentContext.summary.imageOcrCount}/${attachmentContext.summary.imagePayloadCount}`);
    }
    const questionTermVerification = this.verifier.verifyQuestionTerms([safeOriginalQuestion, safeFollowUp].join('\n\n'));
    const questionTermContext = buildQuestionTermContext(questionTermVerification);
    if (questionTermVerification.unverified.length > 0) {
      console.warn(`[Pipeline] unverified follow-up terms: ${questionTermVerification.unverified.map(r => r.name).join(', ')}`);
    }
    const generationContext = [safeRagContext, mcpContext.context, attachmentContext.context, questionTermContext]
      .filter(Boolean)
      .join('\n\n');
    const sources = [
      safeRagContext ? 'RAG' : null,
      ...mcpContext.sources,
    ].filter(Boolean);
    // [2026-06-02] follow-up도 동일하게 질문(원질문+추가질문+첨부)만 기준으로 판정한다.
    const answerPolicy = evaluateAnswerPolicy({
      question: [safeOriginalQuestion, safeFollowUp, attachmentContext.policyText].filter(Boolean).join('\n\n'),
    });
    console.log(`[Pipeline] follow-up answer policy: ${answerPolicy.answerMode} (${answerPolicy.riskLevel})`);

    let result = await this.generator.followUp(
      safeOriginalQuestion,
      safePreviousAnswer,
      safeFollowUp,
      generationContext,
      { version: options.version, libraries: options.libraries, answerPolicy, questionTermVerification }
    );
    result.answer = maskSensitiveInfo(result.answer, { maskFilenames: false });
    console.log(`[Pipeline] follow-up generated (${result.usage.inputTokens + result.usage.outputTokens} tokens)`);

    let verification = this.verifier.verify(result.answer);
    console.log(`[Pipeline] ${verification.summary}`);

    const MAX_RETRIES = 1;
    let retryCount = 0;
    while (verification.unverified.length > 0 && retryCount < MAX_RETRIES) {
      retryCount++;
      const invalidApis = verification.unverified.map((r) => r.name);
      console.log(`[Pipeline] unverified follow-up APIs, regenerating (${retryCount}/${MAX_RETRIES}): ${invalidApis.join(', ')}`);

      result = await this.generator.regenerate(
        safeFollowUp,
        generationContext,
        result.answer,
        invalidApis,
        { version: options.version, libraries: options.libraries, answerPolicy, questionTermVerification }
      );
      result.answer = maskSensitiveInfo(result.answer, { maskFilenames: false });
      verification = this.verifier.verify(result.answer);
      console.log(`[Pipeline] ${verification.summary}`);
    }

    if (verification.unverified.length > 0) {
      result.answer += '\n\n---\n**검증 경고**: 아래 API/속성은 내부 데이터에서 확인되지 않았습니다. 실제 존재 여부를 확인해주세요.\n';
      for (const item of verification.unverified) {
        result.answer += `- \`${item.name}\`\n`;
      }
    }
    result.answer = appendPolicyNotice(result.answer, answerPolicy);
    result.sources = sources;

    const savedPath = this._saveAnswer(
      safeFollowUp,
      result,
      this.classifier.classify({ question: safeFollowUp, answer: '' })
    );
    if (savedPath) {
      console.log(`[Pipeline] follow-up saved: ${savedPath}`);
    }

    console.log(`[Pipeline] done in ${Date.now() - __t0}ms (follow-up)`);
    return {
      followUp: safeFollowUp,
      ragResults: { ...ragResult, context: safeRagContext },
      mcpContext,
      attachmentContext,
      answer: result.answer,
      hasRagResults: result.hasRagResults,
      sources,
      usage: result.usage,
      model: result.model,
      verification,
      questionTermVerification,
      answerPolicy,
      answerMode: answerPolicy.answerMode,
      riskLevel: answerPolicy.riskLevel,
      needsHumanReview: answerPolicy.needsHumanReview,
      reviewReasons: answerPolicy.reviewReasons,
      requiredInfo: answerPolicy.requiredInfo,
      savedPath,
    };
  }

  /**
   * RAG 검색. 상주 서버(HTTP) 우선, 실패 시 Python subprocess 폴백.
   */
  async _searchRAG(query, options) {
    // 1) 상주 RAG 서버 우선 (콜드스타트 없음)
    if (this.ragServerConfig.enabled) {
      try {
        const output = await httpRagSearch(this.ragServerConfig, query, options);
        return this._parseRagOutput(output, options);
      } catch (err) {
        console.warn('[Pipeline] RAG server 사용 불가, subprocess 폴백:', err.message);
      }
    }

    // 2) 폴백: 기존 Python 1회 실행 (느리지만 안전)
    try {
      const topK = options.topK || 8;
      const pythonPath = resolvePythonPath();
      const args = [
        this.ragSearcherPath,
        query,
        '--top-k', String(topK),
      ];

      if (options.categoryFilter) {
        args.push('--category', options.categoryFilter);
      }

      const output = execFileSync(pythonPath, args, {
        encoding: 'utf8',
        timeout: 180000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });

      return this._parseRagOutput(output, options);
    } catch (err) {
      console.warn('[Pipeline] RAG search failed:', err.message);
      return { context: '', resultCount: 0, cases: [] };
    }
  }

  /**
   * RAG 검색기 출력(CLI/서버 공통 텍스트) → cases/context 구조로 변환.
   */
  _parseRagOutput(output, options = {}) {
    const cases = parseRagResults(output);
    const fallbackCount = (output.match(/^#\d+\s/mg) || []).length;
    const filteredContext = buildRagContext(cases, {
      minMatch: options.minMatch,
    });
    return {
      context: filteredContext,
      rawContext: output,
      resultCount: cases.length || fallbackCount,
      cases,
    };
  }

  /**
   * 다단계 RAG 검색
   *
   * 1차 검색 → 신뢰도 평가 → 낮으면 규칙 기반 키워드 추출 후 보강 검색 → 결과 병합.
   * API 응답 스키마는 _searchRAG와 동일 (cases/context/resultCount).
   * 추가 필드 (confidence, refinementUsed)는 내부 로깅용.
   */
  async _searchRAGMultiStep(question, options) {
    const primary = await this._searchRAG(question, options);

    // refinement 비활성 또는 1차에서 cases 없음 → 그대로 반환
    if (!this.refinementConfig.enabled || primary.cases.length === 0) {
      return { ...primary, refinementUsed: false };
    }

    const entities = extractEntities(question);
    const confidence = evaluateRagConfidence({ cases: primary.cases }, entities);
    console.log(
      `[Pipeline] RAG primary: ${primary.cases.length} cases, confidence=${confidence.score}`
        + ` (top1=${confidence.breakdown.top1Score}, src=${confidence.breakdown.sourceQuality},`
        + ` kw=${confidence.breakdown.keywordMatch}, dens=${confidence.breakdown.resultDensity})`
    );

    if (confidence.score >= this.refinementConfig.confidenceThreshold) {
      return {
        ...primary,
        confidence,
        entities,
        refinementUsed: false,
      };
    }

    // 보강 검색 후보 생성
    const candidates = buildRefinementCandidates(question, entities, confidence)
      .slice(0, this.refinementConfig.maxRefinementSearches);

    if (candidates.length === 0) {
      console.log('[Pipeline] confidence low but no refinement candidates available');
      return { ...primary, confidence, entities, refinementUsed: false };
    }

    console.log(`[Pipeline] confidence ${confidence.score} < ${this.refinementConfig.confidenceThreshold}, refining with ${candidates.length} queries`);

    const secondaryGroups = [];
    for (const cand of candidates) {
      console.log(`[Pipeline]   refine[${cand.strategy}]: "${cand.query}"`);
      const sec = await this._searchRAG(cand.query, options);
      if (sec.cases.length > 0) {
        secondaryGroups.push(sec.cases);
      }
    }

    const mergedCases = mergeRagCases(primary.cases, secondaryGroups);
    const mergedContext = buildRagContext(mergedCases, {
      minMatch: options.minMatch,
    });

    const finalConfidence = evaluateRagConfidence({ cases: mergedCases }, entities);
    console.log(`[Pipeline] RAG final: ${mergedCases.length} cases, confidence=${finalConfidence.score} (was ${confidence.score})`);

    return {
      context: mergedContext,
      rawContext: primary.rawContext,
      resultCount: mergedCases.length,
      cases: mergedCases,
      confidence: finalConfidence,
      initialConfidence: confidence,
      entities,
      refinementUsed: true,
      refinementCandidates: candidates,
    };
  }

  /**
   * Save generated answer as markdown under data/answers/YYYY-MM-DD.
   */
  _saveAnswer(question, result, classification) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dirPath = path.join(__dirname, '../../data/answers', today);
      fs.mkdirSync(dirPath, { recursive: true });

      const filename = this._toFilename(question);
      const filePath = path.join(dirPath, `${filename}.md`);

      const sources = Array.isArray(result.sources) ? result.sources : [];
      const basis = sources.length > 0
        ? `참고자료 기반 (${sources.join(' + ')})`
        : '일반 기술 지식 기반 (내부 사례 없음)';

      const content = `# ${this._extractTitle(question)}

- **문의일시**: ${today}
- **분류**: ${classification.categoryLabel} > ${classification.subcategoryLabel}
- **답변 근거**: ${basis}

## 문의 내용

${question.trim()}

## 답변

${result.answer.trim()}
`;

      fs.writeFileSync(filePath, content, 'utf8');
      return filePath;
    } catch (err) {
      console.warn('[Pipeline] answer save failed:', err.message);
      return null;
    }
  }

  /**
   * Make a safe filename from the masked question.
   */
  _toFilename(question) {
    return question
      .replace(/[<>:"/\\|?*\r\n]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60)
      .replace(/_+$/, '')
      .toLowerCase();
  }

  /**
   * Use the first line as the markdown title.
   */
  _extractTitle(question) {
    const firstLine = question.trim().split('\n')[0].trim();
    return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
  }
}

module.exports = AnswerPipeline;
