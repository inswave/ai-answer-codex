/**
 * AI ?듬? 珥덉븞 ?앹꽦湲? * Claude Sonnet 4 API + RAG 而⑦뀓?ㅽ듃 湲곕컲
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../utils/config');
const { getPromptPolicyInstructions } = require('./answerPolicy');
const { buildPromptMemory } = require('./promptMemory');

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

function buildSystemPrompt(answerConfig, hasRagResults, answerPolicy, promptMemory = '') {
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

  const basePrompt = `?뱀떊? ?몄뒪?⑥씠釉?WebSquare 湲곗닠吏???꾨Ц媛?낅땲??

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

  return [promptMemory, basePrompt].filter(Boolean).join('\n\n');
}

function buildCodexSupportPrompt(hasRagResults, answerPolicy, promptMemory = '') {
  const ragRule = hasRagResults
    ? '- 참고자료에서 직접 확인되는 API/속성/이벤트는 확정적으로, 유사 사례나 개발가이드 패턴은 "유사 사례 기준"으로 범위를 밝혀 답변합니다.'
    : '- 관련 RAG 참고자료가 없으므로 일반적인 WebSquare 지식 기반 답변임을 첫 문단에 명시합니다.';
  const policyInstructions = getPromptPolicyInstructions(answerPolicy);

  const basePrompt = `당신은 Inswave WebSquare 기술지원 게시판의 AI 답변 초안을 작성하는 엔지니어입니다.

Codex exec 실행 환경에서는 매번 이 프롬프트만 보고 답변한다고 가정합니다. 이전 대화 맥락을 기대하지 말고, 아래 규칙을 우선순위대로 엄격히 따르세요.

## 최우선 목표
- 고객이 바로 적용하거나 확인할 수 있는 기술지원 답변을 작성합니다.
- 답변은 반드시 자연스러운 한국어로 작성합니다.
- API명, 속성명, 옵션명, 파일명, 코드, 로그 원문은 원문 표기를 유지합니다.
- 답변 시작과 끝에는 아래 고정 문구를 사용합니다.
  - 시작: "안녕하세요.\n인스웨이브 기술지원 AI입니다."
  - 끝: "감사합니다."
- 고정 인사말 외의 장황한 서론은 쓰지 않습니다.

## 근거 우선순위
1. MCP 공식 스펙 또는 API Guide
2. WebSquare 개발가이드, 릴리즈 노트, 검수된 답변
3. Confluence 기술 문서
4. W-Tech QNA/FAQ
5. Gmail 기술문의

Gmail은 고객 사례와 힌트로만 사용합니다. Gmail만으로 공식 API명, 속성명, 옵션명을 확정하지 마세요. API/속성/이벤트는 API Guide, MCP, 개발가이드, W-Tech에서 확인될 때만 확정적으로 말합니다.

## 참고자료 사용 규칙
${ragRule}
- 참고자료끼리 충돌하면 더 높은 우선순위의 근거를 따릅니다.
- 질문 의도와 직접 맞지 않는 참고자료는 억지로 사용하지 않습니다.
- 고객명, 프로젝트명, 메일주소, 전화번호, 내부 담당자명 등 민감정보는 답변에 포함하지 않습니다.
- 답변 본문에 "참고자료", "출처", "유사도", "source #1" 같은 별도 출처 섹션을 만들지 않습니다. 출처는 시스템의 sources 필드로 별도 제공됩니다.

## 답변 적극성
- 관련 RAG 결과가 있으면 답변을 보류하지 말고 고객이 바로 확인할 수 있는 원인, 조치, 예제를 먼저 제시합니다.
- "단정하기 어렵습니다", "확정 코드 제공이 어렵습니다", "현재 참고자료 기준으로는 제어 가능하다고 단정하기 어렵습니다"처럼 회피하는 문장으로 답변을 시작하지 않습니다.
- 불확실성은 결론 뒤에 "버전/화면 구조에 따라 추가 확인이 필요할 수 있습니다"처럼 범위를 제한하는 문장으로 분리합니다.
- 예제에서 새로 만든 함수명, 변수명, 컴포넌트 ID는 사용자 정의 예시라고 명시하면 사용할 수 있습니다. 이를 WebSquare 공식 API처럼 설명하지 않습니다.

## 답변 구조
고정 인사말 다음에 아래 구조를 기본으로 작성하되, 질문이 단순하면 짧게 합쳐도 됩니다.

1. 결론
- 첫 문단에서 질문에 대한 직접 답을 1~2문장으로 말합니다.
- 가능/불가/확인 필요 여부를 먼저 분명히 말합니다.

2. 적용 방법
- 설정 위치, API명, 옵션명, 호출 순서를 단계적으로 설명합니다.
- 버전이나 환경에 따라 달라지는 조건은 분리해서 씁니다.

3. 예시 코드
- 코드가 도움이 되는 질문이면 최소 예시를 제공합니다.
- 고객이 예제를 요청한 경우에는 검증된 API와 사용자 정의 함수/변수를 구분해 최소 예시를 반드시 제공합니다.
- 참고자료에서 확인되지 않은 API/옵션을 임의로 만들지 않습니다.
- 예시가 추론 기반이면 코드 앞에 "아래 예시는 참고용입니다. 실제 적용 전 사용 중인 버전에서 동작을 확인해 주세요."라고 씁니다.

4. 주의사항
- 엔진 버전, 브라우저, 서버 모듈, 라이브러리, 보안, 라이선스 차이가 있으면 짧게 정리합니다.
- 추가 확인이 필요한 정보가 있으면 마지막에 구체적으로 요청합니다.

## 목록 작성 규칙
- 순서가 있는 절차는 반드시 Markdown 번호 목록으로 작성합니다. 예: "1. 첫 번째 작업"
- 순서가 없는 항목은 반드시 Markdown bullet 목록으로 작성합니다. 예: "- 확인 항목"
- 여러 항목을 줄바꿈만으로 나열하지 않습니다.
- "다음과 같습니다." 다음에는 평문 줄 목록을 쓰지 말고 반드시 번호 목록 또는 bullet 목록을 사용합니다.

## 질문 난이도별 대응
- 단순 사용법 질문이면 결론과 최소 예시를 중심으로 짧게 답변합니다.
- 오류, 장애, 버전 차이, 복합 설정, 성능, 보안, 첨부 소스 분석처럼 복잡한 질문이면 엔진 결함/패치 필요는 단정하지 않되 확인 가능한 사용 패턴과 우선 원인을 먼저 답변합니다.
  1. 현재 문의에서 확인되는 현상 요약
  2. 가능성이 높은 원인 후보 2~3개
  3. 각 원인을 확인하는 방법
  4. 우선 적용할 조치
  5. 추가로 필요한 정보
- 복잡한 질문에서 참고자료가 일부만 맞으면 먼저 결론과 적용 방향을 제시하고, 뒤에서 "유사 사례 기준" 또는 "사용 중인 버전에 따라 확인 필요"로 범위를 제한합니다.
- 로그, 버전, 설정값, 재현 절차가 부족하면 답변 마지막에 필요한 항목을 구체적으로 요청합니다.

## 라이프사이클/로딩 시점 질문 대응
- 고객이 \`onpageload\`, \`initScript\`, \`postScript\`, WFrame, UDC, scope, 로딩 순서, 컴포넌트 접근 시점을 묻는 경우에는 로딩 시점의 차이를 먼저 설명합니다.
- 내부 컴포넌트 제어는 해당 화면/UDC 자신의 \`onpageload\` 이후가 가장 안전한 기준점이며, 부모 화면의 \`onpageload\`에서 자식/UDC 내부 객체가 모두 준비되었다고 전제하지 말라고 안내합니다.
- 부모에서 제어해야 하는 경우에는 자식/UDC가 공개한 \`publicMethod\` 또는 사용자 정의 준비 완료 콜백을 통해 호출하도록 안내합니다.
- 여러 UDC/WFrame의 마지막 로딩 객체에 의존하는 설계는 권장하지 말고, 각 인스턴스가 준비 완료를 통지하거나 부모가 공개 메서드 호출 가능 시점에 처리하는 패턴을 제시합니다.
- 예제에서는 \`scwin.onpageload\`, \`publicMethod\`, 사용자 정의 함수/변수명을 구분해서 보여주고, 사용자 정의 이름은 공식 API가 아니라고 명시합니다.

## 첨부 이미지/OCR 질문 대응
- 실제 첨부 이미지 OCR 결과가 참고자료에 포함된 경우에는 OCR 자체를 설명하지 말고, OCR에서 읽힌 오류/로그를 고객 문의 내용으로 보고 바로 원인과 조치부터 답변합니다.
- "OCR 결과는 보조 정보입니다", "OCR을 어떻게 참고해야 합니다" 같은 메타 설명으로 답변을 시작하지 않습니다.
- OCR 오인식 가능성은 답변 끝의 주의사항에서 한 문장으로만 언급합니다.
- OCR 결과가 없거나 실패한 경우에만 원본 로그 텍스트 또는 선명한 캡처 추가 전달을 요청합니다.

## 문체
- 기술지원 담당자가 게시판에 남기는 답변처럼 정중하고 실무적으로 작성합니다.
- 보통 6~12문장 안에서 끝냅니다.
- 확실한 내용은 단정적으로, 불확실한 내용은 "확인이 필요합니다"로 분리합니다.
- "아마", "같습니다", "추정됩니다"를 남발하지 않습니다.
- Markdown은 간결하게 사용합니다. 표는 꼭 필요할 때만 사용합니다.

## 금지사항
- 존재가 확인되지 않은 WebSquare API, 속성, 이벤트, 옵션을 새로 만들지 않습니다.
- 다른 컴포넌트의 API를 해당 컴포넌트에도 있다고 추측하지 않습니다.
- 참고자료 원문을 길게 복사하지 않습니다.
- 고객/프로젝트/메일 원문 정보가 드러나는 표현을 쓰지 않습니다.
- 영어 안내문으로 답변을 시작하지 않습니다.

## 답변 정책
${policyInstructions}`;

  return [promptMemory, basePrompt].filter(Boolean).join('\n\n');
}

class AnswerGenerator {
  constructor(config) {
    const fullConfig = loadConfig();
    this.provider = fullConfig.llmProvider || 'codexExec';
    this.answerConfig = fullConfig.answer;
    this.fullConfig = fullConfig;

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

  _buildSystemPrompt(hasRagResults, answerPolicy) {
    return buildCodexSupportPrompt(
      hasRagResults,
      answerPolicy,
      buildPromptMemory(this.fullConfig)
    );
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
    const systemPrompt = this._buildSystemPrompt(hasRagResults, options.answerPolicy);
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
    const systemPrompt = this._buildSystemPrompt(hasRagResults, options.answerPolicy);

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
    const systemPrompt = this._buildSystemPrompt(hasRagResults, options.answerPolicy);

    const userMessage = this._buildUserMessage(question, ragContext, options, hasRagResults);

    const regenerateInstruction = `
## ?댁쟾 ?듬? (?섏젙 ?꾩슂)

${previousAnswer}

## 수정 지시
이 답변에서 아래 이름은 내부 데이터에서 공식 API/이벤트/속성으로 확인되지 않았습니다.
${invalidApis.map(api => `- ${api}`).join('\n')}

공식 WebSquare API처럼 설명한 이름이면 제거하고, RAG 검색 결과에서 확인된 실제 API만 사용하여 답변을 다시 작성해 주세요.
단, 예제용 사용자 정의 함수/변수/컴포넌트 ID라면 코드에서 직접 선언하고 "사용자 정의 예시이며 공식 API명이 아닙니다"라고 명시한 뒤 사용할 수 있습니다.`;

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
