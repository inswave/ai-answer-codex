/**
 * AI ?듬? 珥덉븞 ?앹꽦湲? * Claude Sonnet 4 API + RAG 而⑦뀓?ㅽ듃 湲곕컲
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../utils/config');
const { getPromptPolicyInstructions } = require('./answerPolicy');

const KOREAN_CHAR_RE = /[가-힣]/g;
const LATIN_WORD_RE = /\b[A-Za-z][A-Za-z'-]*\b/g;
const KOREAN_RETRY_THRESHOLD = 0.08;

function callCodexExec(command, configuredArgs, input, timeoutMs, configuredEnv = {}) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(
      os.tmpdir(),
      `techassistant-codex-${process.pid}-${Date.now()}.txt`
    );
    const args = [
      ...(configuredArgs || ['exec']),
      '--skip-git-repo-check',
      '--output-last-message',
      outputPath,
      '-',
    ];
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...configuredEnv },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`codex exec timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (_) {
        // Best-effort temp file cleanup.
      }
    };
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(timer); cleanup(); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        cleanup();
        return reject(new Error(`codex exec exit ${code}: ${stderr.trim() || stdout.slice(-500)}`));
      }
      try {
        const finalMessage = fs.existsSync(outputPath)
          ? fs.readFileSync(outputPath, 'utf8')
          : stdout;
        cleanup();
        resolve(finalMessage);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
    child.stdin.end(input);
  });
}

const MAX_CONTEXT_PER_ITEM = 2000;
const MAX_TOTAL_CONTEXT = 16000;

function koreanCharRatio(text) {
  const compact = String(text || '').replace(/\s+/g, '');
  if (!compact) return 0;
  const koreanCount = (compact.match(KOREAN_CHAR_RE) || []).length;
  return koreanCount / compact.length;
}

function hasMostlyEnglishNarrative(text) {
  const latinWords = String(text || '').match(LATIN_WORD_RE) || [];
  const koreanChars = String(text || '').match(KOREAN_CHAR_RE) || [];
  return latinWords.length >= 25 && koreanChars.length < 40;
}

function buildSystemPrompt(answerConfig, hasRagResults, answerPolicy) {
  const name = answerConfig?.responderName || 'support';
  const template = answerConfig?.template
    || '?덈뀞?섏꽭??\n?몄뒪?⑥씠釉?湲곗닠吏?먰? {{name}} ?꾨줈?낅땲??\n\n{{topic}}怨?愿?⑦븯???뺤씤 ???듬??쒕┰?덈떎.\n\n{{content}}\n\n媛먯궗?⑸땲??';

  const ragRule = hasRagResults
    ? '1. **李멸퀬?먮즺 湲곕컲留??듬?** ???쒓났??李멸퀬 ?щ?瑜?洹쇨굅濡쒕쭔 ?듬??⑸땲?? 異붿륫 湲덉?.'
    : `1. **?대? ?곗씠???놁쓬 ?덈궡** ??李멸퀬 ?щ?媛 ?놁쑝誘濡?WebSquare 怨듭떇 臾몄꽌 諛??쇰컲?곸씤 湲곗닠 吏?앹쓣 湲곕컲?쇰줈 ?듬??⑸땲??
   ?듬? 蹂몃Ц 留??욎뿉 諛섎뱶???꾨옒 臾멸뎄瑜??ы븿?섏떗?쒖삤:
   "???대? ?곗씠??湲곗? ?뺤씤???щ?媛 ?놁뼱, WebSquare 怨듭떇 臾몄꽌 諛??쇰컲?곸씤 湲곗닠 吏?앹쓣 湲곕컲?쇰줈 ?덈궡?쒕┰?덈떎. ?뺥솗???댁슜? 異붽? ?뺤씤???꾩슂?????덉뒿?덈떎."
   ?듬? 蹂몃Ц 留??앹뿉 諛섎뱶??異붽? ?뺣낫 ?붿껌???ы븿?섏떗?쒖삤:
   "?뺥솗???뺤씤???꾪빐 ?꾨옒 ?뺣낫瑜?異붽?濡??꾨떖 遺?곷뱶由쎈땲??
   - ?ъ슜 以묒씤 WebSquare 踰꾩쟾 諛?鍮뚮뱶??   - 愿???먮윭 硫붿떆吏 ?먮뒗 濡쒓렇
   - ?ы쁽 諛⑸쾿"`;

  return `?뱀떊? ?몄뒪?⑥씠釉?WebSquare 湲곗닠吏???꾨Ц媛?낅땲??

?꾨옒 洹쒖튃??諛섎뱶??以?섑븯???듬????묒꽦?섏떗?쒖삤:

0. 최종 답변 언어: 반드시 한국어로 작성합니다. 고객 문의가 영어이거나 참고자료에 영어가 포함되어도, API명/속성명/코드/로그 원문을 제외한 설명 문장은 한국어로 작성합니다. "Hello", "Based on", "Here is" 같은 영어 안내 문장으로 답변을 시작하지 마십시오.

${ragRule}
1-1. **?듬? ?뺤콉 以??* - ?꾨옒 ?뺤콉? 諛깆뿏?쒓? 臾몄쓽 ?좏삎???먮떒??寃곌낵?낅땲?? 諛섎뱶?????뺤콉??留욎떠 ?듬? 媛뺣룄? ?쒗쁽??議곗젅?섏떗?쒖삤.
${getPromptPolicyInstructions(answerPolicy)}
1-2. **誘명솗??怨좉컼 ?⑹뼱 泥섎━**
   - 怨좉컼 臾몄쓽???ы븿??API/?띿꽦紐낆씠 RAG/API/MCP ?먮즺?먯꽌 ?뺤씤?섏? ?딆? 寃쎌슦, ?대떦 紐낆묶??WebSquare 怨듭떇 湲곕뒫?쇰줈 ?⑥젙?섏? 留덉떗?쒖삤.
   - 誘명솗??紐낆묶??臾몄쓽???듭떖?대㈃ ?듬???8~12臾몄옣 ?댁쇅濡?吏㏐쾶 ?묒꽦?섍퀬, "怨듭떇 ?ㅽ럺?먯꽌 ?뺤씤?섏? ?딆븘 ?꾨줈?앺듃 而ㅼ뒪? ?띿꽦 ?먮뒗 ?ㅺ린?????덉뒿?덈떎"?쇨퀬 癒쇱? ?덈궡?섏떗?쒖삤.
   - ?뺤씤???泥?API/?띿꽦???덉쓣 ?뚮쭔 ?泥?諛⑸쾿??1~2媛??쒖떆?섍퀬, 寃利앸릺吏 ?딆? ?덉떆 肄붾뱶???묒꽦?섏? 留덉떗?쒖삤.
2. **?듬? 援ъ“** ???먯씤 遺꾩꽍 ???닿껐 諛⑸쾿 ??異붽? ?뺤씤 ?ы빆 ?쒖꽌濡??묒꽦?⑸땲??
3. **湲곗닠吏???듬? ??*
   - 臾몄쓽?먯꽌 ?뺤씤???꾩긽? 癒쇱? 紐낇솗?섍쾶 ?붿빟?섍퀬, 媛??媛?μ꽦 ?믪? ?먯씤 ?먮쫫???ㅻТ?먭? ?댄빐?????덇쾶 ?ㅻ챸?⑸땲??
   - ?먯씤 遺꾩꽍? 怨쇰룄?섍쾶 ?뚭레?곸쑝濡??곗? 留먭퀬, "???꾩긽? ~ 怨쇱젙?먯꽌 諛쒖깮?????덉뒿?덈떎"泥섎읆 湲곗닠?곸쑝濡??먯뿰?ㅻ읇寃??묒꽦?⑸땲??
   - ?? 李멸퀬?먮즺濡??뺤젙?????녿뒗 ?⑥튂 ?대젰, ?붿쭊 寃고븿, ?뱀젙 鍮뚮뱶 ?섏젙 ?щ???異붽? ?뺤씤 ?ы빆?쇰줈 遺꾨━?⑸땲??
   - ?닿껐 諛⑸쾿? 沅뚯옣 議곗튂 ??????고쉶 諛⑸쾿 ???뺤씤 諛⑸쾿 ?쒖꽌濡??뺣━?⑸땲??
   - ?쒕뒗 API/?띿꽦/?듭뀡??鍮꾧탳???뚮쭔 ?ъ슜?섍퀬, 媛꾨떒???ㅻ챸? 臾몄옣?대굹 bullet濡??묒꽦?⑸땲??
4. **肄붾뱶 ?덉떆 洹쒖튃**
   - 李멸퀬?먮즺??肄붾뱶 ?덉떆媛 ?덉쑝硫??대떦 肄붾뱶瑜??곗꽑 ?쒖슜?⑸땲??(寃利앸맂 肄붾뱶).
   - 李멸퀬?먮즺???뺥솗??留ㅼ묶?섎뒗 肄붾뱶媛 ?놁뼱 ?덈줈 ?묒꽦?섎뒗 寃쎌슦, 肄붾뱶 釉붾줉 ?꾨옒??諛섎뱶??"????肄붾뱶???좎궗 ?щ? 湲곕컲 李멸퀬?⑹엯?덈떎. ?ㅼ젣 ?숈옉 ?뺤씤 ???곸슜?댁＜?몄슂."瑜??쒓린?⑸땲??
   - WebSquare ?붿쭊?먯꽌留??숈옉?섎뒗 肄붾뱶??吏곸젒 ?뚯뒪?명븷 ???놁쑝誘濡? 寃利앸릺吏 ?딆? 肄붾뱶?꾩쓣 紐낆떆?⑸땲??
5. **???뺤떇 ?쒖슜** ???띿꽦/?듭뀡? ???뺥깭濡??뺣━?⑸땲??
6. **異쒖쿂/?좎궗??李멸퀬?먮즺 蹂몃Ц 誘명룷??* ??李멸퀬???щ???異쒖쿂, RAG ?좎궗???먯닔, "李멸퀬 ?먮즺" ?뱀뀡 ?깆? ?듬? 蹂몃Ц???덈? ?ы븿?섏? 留덉떗?쒖삤. ???뺣낫???묐떟??蹂꾨룄 sources ?꾨뱶濡??먮룞 ?꾨떖?⑸땲?? ?듬? 蹂몃Ц?먮뒗 ?듬? ?댁슜留??묒꽦?섏떗?쒖삤.
7. **API/?대깽???띿꽦紐??뺥솗??*
   - 李멸퀬?먮즺??議댁옱?섏? ?딅뒗 WebSquare API, ?대깽?? ?띿꽦紐낆쓣 ?덈? 留뚮뱾?대궡吏 留덉떗?쒖삤.
   - ?ㅻⅨ 而댄룷?뚰듃??API瑜??대떦 而댄룷?뚰듃?먮룄 ?덈떎怨?異붿륫?섏? 留덉떗?쒖삤. 李멸퀬?먮즺?먯꽌 ?뺥솗???뺤씤??寃껊쭔 ?ъ슜?⑸땲??
   - ?뺤떎?섏? ?딆? API??"?뺤씤???꾩슂?⑸땲??濡??쒓린?⑸땲??
8. **踰꾧렇/?⑥튂 ?쒗쁽 ?쒗븳**
   - 李멸퀬?먮즺???숈씪 ?꾩긽怨??숈씪 議곌굔?먯꽌 ?⑥튂濡??닿껐?섏뿀?ㅻ뒗 ?댁슜??紐낆떆??寃쎌슦?먮쭔 "?⑥튂濡??닿껐", "媛쒖꽑???대젰", "?붿쭊 ?대? 臾몄젣"?쇨퀬 ?쒗쁽?⑸땲??
   - ?좎궗 湲곕뒫 ?щ?留??덈뒗 寃쎌슦?먮뒗 "愿??媛?μ꽦???덉뒿?덈떎", "?뺥솗???붿쭊 鍮뚮뱶 ?뺤씤???꾩슂?⑸땲??泥섎읆 蹂댁닔?곸쑝濡??쒗쁽?⑸땲??
   - "?좎궗 ?щ? #1", "李멸퀬?먮즺 #3" 媛숈? ?대? 踰덊샇瑜??듬? 蹂몃Ц???곗? 留덉떗?쒖삤.
9. **媛쒖씤?뺣낫 ?쒖쇅** ??媛쒖씤紐? ?대찓?? ?뚯궗紐? ?꾨줈?앺듃紐????앸퀎 ?뺣낫瑜??덈? ?ы븿?섏? ?딆뒿?덈떎.
10. **踰꾩쟾 怨좊젮** ??WebSquare 踰꾩쟾, POI/servlet 踰꾩쟾 ?명솚?깆쓣 諛섎뱶??怨좊젮?⑸땲??
11. **踰꾩쟾 議댁옱 寃利?* ???듬????뱀젙 ?뚰봽?몄썾??踰꾩쟾???멸툒???? ?대떦 踰꾩쟾???ㅼ젣 議댁옱?섎뒗吏 ?뺤씤?⑸땲??
   - ?붿쭊 ?뚯씪紐낆뿉??踰꾩쟾??異붿텧?????ㅼ씠諛?洹쒖튃??二쇱쓽: ?? "poi4_1.8"? "POI 4.x + Java 1.8"?댁? "POI 4.1.8"???꾨떃?덈떎.
   - Apache POI 4.x 留덉?留?踰꾩쟾? 4.1.2?낅땲?? (4.1.8? 議댁옱?섏? ?딆쓬)
   - ?뚯씪紐낆쓽 _1.5, _1.8 ?묐??щ뒗 Java/Servlet 踰꾩쟾???섎??⑸땲??
12. **?뺣낫 遺議???* ???ъ슜 以묒씤 踰꾩쟾, ?쇱씠釉뚮윭由? ?먮윭 硫붿떆吏瑜??뺤씤?섎뒗 異붽? 吏덈Ц???ы븿?⑸땲??

?듬?? 諛섎뱶???꾨옒 ?쒗뵆由??뺤떇?쇰줈 ?묒꽦?섏떗?쒖삤:
---
${template.replace('{{name}}', name)}
---
- {{topic}}?먮뒗 怨좉컼 臾몄쓽 二쇱젣瑜?媛꾧껐?섍쾶 ?ｌ쑝??떆??
- {{content}}?먮뒗 ?ㅼ젣 ?듬? ?댁슜???ｌ쑝??떆??
- 議대뙎留??ъ슜
- 媛꾧껐?섍퀬 紐낇솗?섍쾶 ?묒꽦`;
}

class AnswerGenerator {
  constructor(config) {
    const fullConfig = loadConfig();
    this.provider = fullConfig.llmProvider || 'codexExec';
    this.answerConfig = fullConfig.answer;

    if (this.provider !== 'codexExec') {
      throw new Error(`Unsupported llmProvider: ${this.provider}. Use "codexExec".`);
    }

    const cfg = config || fullConfig.codexExec || {};
    this.codexCommand = cfg.command || 'codex';
    this.codexArgs = cfg.args || ['exec', '--sandbox', 'read-only', '--ephemeral'];
    this.codexEnv = cfg.env || {};
    this.codexTimeoutMs = cfg.timeoutMs || 300000;
    this.model = cfg.model || 'codex-exec';
  }

  /**
   * LLM ?몄텧 ?듯빀 ??provider蹂?API 李⑥씠 ?≪닔
   * 諛섑솚: { text, inputTokens, outputTokens, model }
   */
  async _callLLM(systemPrompt, userMessage) {
    const prompt = [systemPrompt, '', userMessage].join('\n');
    const text = await callCodexExec(
      this.codexCommand,
      this.codexArgs,
      prompt,
      this.codexTimeoutMs,
      this.codexEnv
    );
    return {
      text,
      inputTokens: 0,
      outputTokens: 0,
      model: this.model,
    };
  }

  async _ensureKoreanAnswer(text, originalPrompt) {
    const answer = String(text || '').trim();
    if (
      koreanCharRatio(answer) >= KOREAN_RETRY_THRESHOLD
      || !hasMostlyEnglishNarrative(answer)
    ) {
      return answer;
    }

    const rewritePrompt = [
      '다음 초안은 기술지원 고객에게 전달할 답변입니다.',
      '',
      '규칙:',
      '- 최종 답변은 반드시 자연스러운 한국어로만 작성합니다.',
      '- API명, 속성명, 코드, 파일명, 로그 원문은 그대로 유지할 수 있습니다.',
      '- 영어 안내 문장과 설명 문장은 한국어로 번역하거나 다시 작성합니다.',
      '- 새로운 기술 사실을 추가하지 말고, 초안의 의미만 보존합니다.',
      '- 출처 섹션을 새로 만들지 않습니다.',
      '',
      '원래 요청/근거:',
      originalPrompt.slice(0, MAX_TOTAL_CONTEXT),
      '',
      '영어 초안:',
      answer,
      '',
      '한국어 최종 답변만 작성하세요.',
    ].join('\n');

    const rewritten = await callCodexExec(
      this.codexCommand,
      this.codexArgs,
      rewritePrompt,
      this.codexTimeoutMs,
      this.codexEnv
    );

    return String(rewritten || '').trim();
  }

  /**
   * ?듬? 珥덉븞 ?앹꽦
   *
   * @param {string} question - 怨좉컼 湲곗닠臾몄쓽 ?댁슜
   * @param {string} ragContext - RAG 寃??寃곌낵 而⑦뀓?ㅽ듃
   * @param {object} options - 異붽? ?듭뀡
   * @returns {object} - { answer, usage, model, hasRagResults }
   */
  async generate(question, ragContext, options = {}) {
    const hasRagResults = !!ragContext;
    const systemPrompt = buildSystemPrompt(this.answerConfig, hasRagResults, options.answerPolicy);
    const userMessage = this._buildUserMessage(question, ragContext, options, hasRagResults);

    const llm = await this._callLLM(systemPrompt, userMessage);
    const answer = await this._ensureKoreanAnswer(llm.text, [systemPrompt, '', userMessage].join('\n'));

    return {
      answer,
      hasRagResults,
      usage: { inputTokens: llm.inputTokens, outputTokens: llm.outputTokens },
      model: llm.model,
    };
  }

  /**
   * ?ъ슜??硫붿떆吏 援ъ꽦
   */
  _buildUserMessage(question, ragContext, options, hasRagResults) {
    let message = '';

    // RAG/MCP 而⑦뀓?ㅽ듃
    if (hasRagResults) {
      const trimmedContext = ragContext.substring(0, MAX_TOTAL_CONTEXT);
      message += `## 李멸퀬 ?먮즺 (RAG 寃??寃곌낵 諛?MCP 怨듭떇 ?ㅽ럺)\n\n${trimmedContext}\n\n`;
    } else {
      message += `## 李멸퀬 ?щ?\n\n?대? ?곗씠?곗뿉??愿???щ?瑜?李얠? 紐삵뻽?듬땲?? ?쇰컲?곸씤 WebSquare 湲곗닠 吏?앹쓣 湲곕컲?쇰줈 ?듬???二쇱꽭??\n\n`;
    }

    // 踰꾩쟾 ?뺣낫
    if (options.version) {
      message += `## 怨좉컼 ?섍꼍\n- WebSquare 踰꾩쟾: ${options.version}\n`;
      if (options.libraries) message += `- 愿???쇱씠釉뚮윭由? ${options.libraries}\n`;
      message += '\n';
    }

    const unverifiedTerms = options.questionTermVerification?.unverified || [];
    if (unverifiedTerms.length > 0) {
      message += '## 誘명솗??怨좉컼 ?멸툒 API/?띿꽦\n\n';
      message += '?꾨옒 紐낆묶? 怨좉컼 臾몄쓽???ы븿?섏뿀吏留??대? RAG/API/MCP ?먮즺?먯꽌 ?뺤씤?섏? ?딆븯?듬땲?? 怨듭떇 WebSquare 湲곕뒫?쇰줈 ?⑥젙?섏? 留먭퀬, ?꾨줈?앺듃 而ㅼ뒪? ?띿꽦 ?먮뒗 ?ㅺ린 媛?μ꽦??癒쇱? ?덈궡?섏꽭?? ?듬?? 吏㏐퀬 蹂댁닔?곸쑝濡??묒꽦?섏꽭??\n\n';
      message += unverifiedTerms.map(item => `- ${item.name}`).join('\n');
      message += '\n\n';
    }

    // 怨좉컼 臾몄쓽
    message += `## 怨좉컼 臾몄쓽 ?댁슜\n\n${question}\n\n`;
    message += hasRagResults
      ? '??李멸퀬 ?먮즺瑜?湲곕컲?쇰줈 湲곗닠吏???듬? 珥덉븞???묒꽦??二쇱꽭??'
      : 'WebSquare 怨듭떇 臾몄꽌 諛??쇰컲?곸씤 湲곗닠 吏?앹쓣 湲곕컲?쇰줈 湲곗닠吏???듬? 珥덉븞???묒꽦??二쇱꽭??';

    return message;
  }

  /**
   * 異붽? 臾몄쓽??????щ떟蹂 ?앹꽦 (???留λ씫 ?좎?)
   *
   * @param {string} originalQuestion - ?먮옒 臾몄쓽
   * @param {string} previousAnswer - AI 泥??듬?
   * @param {string} followUp - 怨좉컼 異붽? 吏덈Ц
   * @param {string} ragContext - RAG 寃??寃곌낵 而⑦뀓?ㅽ듃
   * @param {object} options - 異붽? ?듭뀡
   * @returns {object} - { answer, usage, model, hasRagResults }
   */
  async followUp(originalQuestion, previousAnswer, followUp, ragContext, options = {}) {
    const hasRagResults = !!ragContext;
    const systemPrompt = buildSystemPrompt(this.answerConfig, hasRagResults, options.answerPolicy);

    let message = '';

    if (hasRagResults) {
      const trimmedContext = ragContext.substring(0, MAX_TOTAL_CONTEXT);
      message += `## 李멸퀬 ?먮즺 (RAG 寃??寃곌낵 諛?MCP 怨듭떇 ?ㅽ럺)\n\n${trimmedContext}\n\n`;
    }

    if (options.version) {
      message += `## 怨좉컼 ?섍꼍\n- WebSquare 踰꾩쟾: ${options.version}\n\n`;
    }

    const unverifiedTerms = options.questionTermVerification?.unverified || [];
    if (unverifiedTerms.length > 0) {
      message += '## 誘명솗??怨좉컼 ?멸툒 API/?띿꽦\n\n';
      message += '?꾨옒 紐낆묶? 怨좉컼 臾몄쓽???ы븿?섏뿀吏留??대? RAG/API/MCP ?먮즺?먯꽌 ?뺤씤?섏? ?딆븯?듬땲?? 怨듭떇 WebSquare 湲곕뒫?쇰줈 ?⑥젙?섏? 留먭퀬, ?꾨줈?앺듃 而ㅼ뒪? ?띿꽦 ?먮뒗 ?ㅺ린 媛?μ꽦??癒쇱? ?덈궡?섏꽭?? ?듬?? 吏㏐퀬 蹂댁닔?곸쑝濡??묒꽦?섏꽭??\n\n';
      message += unverifiedTerms.map(item => `- ${item.name}`).join('\n');
      message += '\n\n';
    }

    message += `## ?먮옒 臾몄쓽\n\n${originalQuestion}\n\n`;
    message += `## ?댁쟾 AI ?듬?\n\n${previousAnswer}\n\n`;
    message += `## 怨좉컼 異붽? 臾몄쓽\n\n${followUp}\n\n`;
    message += '?????留λ씫??諛뷀깢?쇰줈, 怨좉컼??異붽? 臾몄쓽??????듬????묒꽦??二쇱꽭?? ?댁쟾 ?듬?怨?以묐났?섎뒗 ?댁슜? 理쒖냼?뷀븯怨? 異붽? 臾몄쓽??吏묒쨷?섏뿬 ?듬??⑸땲??';

    const llm = await this._callLLM(systemPrompt, message);
    const answer = await this._ensureKoreanAnswer(llm.text, [systemPrompt, '', message].join('\n'));

    return {
      answer,
      hasRagResults,
      usage: { inputTokens: llm.inputTokens, outputTokens: llm.outputTokens },
      model: llm.model,
    };
  }

  /**
   * 誘명솗??API瑜??쒖쇅?섍퀬 ?듬? ?ъ깮??   *
   * @param {string} question - ?먮낯 臾몄쓽
   * @param {string} ragContext - RAG 而⑦뀓?ㅽ듃
   * @param {string} previousAnswer - ?댁쟾 ?듬?
   * @param {string[]} invalidApis - 誘명솗??API 紐⑸줉
   * @param {object} options - 異붽? ?듭뀡
   * @returns {object} - { answer, usage, model, hasRagResults }
   */
  async regenerate(question, ragContext, previousAnswer, invalidApis, options = {}) {
    const hasRagResults = !!ragContext;
    const systemPrompt = buildSystemPrompt(this.answerConfig, hasRagResults, options.answerPolicy);

    const userMessage = this._buildUserMessage(question, ragContext, options, hasRagResults);

    const regenerateInstruction = `
## ?댁쟾 ?듬? (?섏젙 ?꾩슂)

${previousAnswer}

## ?섏젙 吏??
???듬??먯꽌 ?꾨옒 API/?대깽???띿꽦? ?대? ?곗씠?곗뿉???뺤씤?섏? ?딆븯?듬땲?? **議댁옱?섏? ?딅뒗 API?낅땲??**
${invalidApis.map(api => `- ${api}`).join('\n')}

??誘명솗??API瑜?紐⑤몢 ?쒓굅?섍퀬, RAG 寃??寃곌낵?먯꽌 ?뺤씤???ㅼ젣 API留??ъ슜?섏뿬 ?듬????ㅼ떆 ?묒꽦??二쇱꽭??
議댁옱 ?щ?媛 遺덊솗?ㅽ븳 API???ъ슜?섏? 留덉꽭??`;

    const finalUserMessage = userMessage + '\n\n' + regenerateInstruction;
    const llm = await this._callLLM(systemPrompt, finalUserMessage);
    const answer = await this._ensureKoreanAnswer(llm.text, [systemPrompt, '', finalUserMessage].join('\n'));

    return {
      answer,
      hasRagResults,
      usage: { inputTokens: llm.inputTokens, outputTokens: llm.outputTokens },
      model: llm.model,
    };
  }
}

module.exports = AnswerGenerator;
