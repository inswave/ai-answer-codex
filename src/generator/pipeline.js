/**
 * Answer generation pipeline.
 * Input question -> classify -> RAG search -> LLM answer -> API verification -> save.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Classifier = require('../classifier/classifier');
const AnswerGenerator = require('./answerGenerator');
const ApiVerifier = require('./apiVerifier');
const { addToQueue } = require('../api/queue');
const { parseRagResults, buildRagContext } = require('../rag/parseRagResults');
const { maskSensitiveInfo } = require('../utils/masking');
const {
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

    const safeQuestion = maskSensitiveInfo(question);

    const classification = this.classifier.classify({ question: safeQuestion, answer: '' });
    console.log(`[Pipeline] classification: ${classification.categoryLabel} > ${classification.subcategoryLabel}`);

    const ragResult = this._searchRAGMultiStep(safeQuestion, options);
    const safeRagContext = maskSensitiveInfo(ragResult.context);
    console.log(`[Pipeline] RAG results: ${ragResult.resultCount}${ragResult.refinementUsed ? ' (with refinement)' : ''}`);
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
    const answerPolicy = evaluateAnswerPolicy({
      question: [safeQuestion, attachmentContext.policyText].filter(Boolean).join('\n\n'),
      cases: ragResult.cases,
    });
    console.log(`[Pipeline] answer policy: ${answerPolicy.answerMode} (${answerPolicy.riskLevel})`);

    const MAX_RETRIES = 3;
    let result = await this.generator.generate(safeQuestion, generationContext, {
      version: options.version,
      libraries: options.libraries,
      answerPolicy,
      questionTermVerification,
    });
    result.answer = maskSensitiveInfo(result.answer, { maskFilenames: false });
    console.log(`[Pipeline] answer generated (${result.usage.inputTokens + result.usage.outputTokens} tokens)`);

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

    return {
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

    const ragResult = this._searchRAGMultiStep(safeFollowUp, options);
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
    const answerPolicy = evaluateAnswerPolicy({
      question: [safeOriginalQuestion, safeFollowUp, attachmentContext.policyText].filter(Boolean).join('\n\n'),
      cases: ragResult.cases,
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

    const MAX_RETRIES = 3;
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
   * Run Python RAG search.
   */
  _searchRAG(query, options) {
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
    } catch (err) {
      console.warn('[Pipeline] RAG search failed:', err.message);
      return { context: '', resultCount: 0, cases: [] };
    }
  }

  /**
   * 다단계 RAG 검색
   *
   * 1차 검색 → 신뢰도 평가 → 낮으면 규칙 기반 키워드 추출 후 보강 검색 → 결과 병합.
   * API 응답 스키마는 _searchRAG와 동일 (cases/context/resultCount).
   * 추가 필드 (confidence, refinementUsed)는 내부 로깅용.
   */
  _searchRAGMultiStep(question, options) {
    const primary = this._searchRAG(question, options);

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
      const sec = this._searchRAG(cand.query, options);
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
