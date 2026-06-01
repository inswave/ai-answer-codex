# 2026-06-01 mcpContext COMPONENT_ALIASES 버그 수정 (A/B)

## 배경
5/27 미커밋 변경분(`src/generator/mcpContext.js`)에서 Phase 3 컴포넌트 alias 약 26개를 추가하면서, 기존 상세 `$p` alias를 "맨 아래로 이동"하려다 **"삭제"만 되고 재추가가 누락**됨. 이로 인해 두 가지 회귀 발생. (마지막 커밋은 5/26 `09a38d4`, 본 수정은 그 위 미커밋 상태에서 진행.)

## 버그 A — `$p` 메서드 키워드 매칭 소실 (회귀)
- 삭제된 alias: `showProcessMessage|showModal|getParameter|setParameter|getValueObj|openMenu|hideProcessMessage|hideModal` 키워드를 `$p`로 매핑하던 것.
- 남은 `$p` alias(27행)는 `/\$p\b|openPopup|executeSubmission/`뿐 → 위 메서드명 문의가 `$p` 컨텍스트를 전혀 못 붙임.
- 영향: `extractComponents`(전부 수집), `inferComponentFromRagSource`(첫 매칭) 양쪽.
- 실증: HEAD에선 `extractComponents("showProcessMessage ...")=[$p]`, 5/27본=`[]`.

## 버그 B — `$p/data` 도달 불가 (미완 리팩터링)
- 끝에 "`$p`를 맨 아래로 옮겨야 `$p/data`가 먼저 매칭됨" 주석만 있고, 실제 `$p`는 27행(맨 위)에 잔존.
- `inferComponentFromRagSource`(첫 매칭 return)에서 "$p.data"가 27행 generic `$p`(`/\$p\b/`)에 먼저 잡혀 `$p/data`(index 30)에 도달 못 함 → 5/27 추가한 `$p/data` alias가 이 경로에서 dead.

## 근본 원인
상세 `$p` alias를 **이동하려다 삭제만 됨**. → 메서드 키워드 소실(A) + 이동 미완 주석 잔존(B).

## 수정 내용
1. 27행 generic `$p` alias 제거(가로채기 원인).
2. 배열 **맨 끝**에 상세 `$p` catch-all 복원(메서드 키워드 포함):
   ```js
   { pattern: /\$p\b|openPopup|executeSubmission|openMenu|getParameter|setParameter|getValueObj|showProcessMessage|showModal|hideProcessMessage|hideModal/i, component: '$p' },
   ```
   → generic `$p`가 구체 alias(`$p/data` 등) 뒤에 위치하게 됨.

## 검증 (실제 함수 실행, HEAD vs 수정후)
- 버그 A: `showProcessMessage/getParameter/setParameter/getValueObj/showModal/hideModal/openMenu` 전부 `[$p]` 복원 ✅
- 버그 B: `inferComponentFromRagSource("$p.data ...") = $p/data` (이전 `$p`) ✅. "$p.data" 첫 매칭 index 29(`$p/data`), generic `$p`는 index 58(맨 끝).
- 회귀 없음: "$p 팝업"→`[$p]`, "executeSubmission"→`[$p]`(camelCase 경계로 Submission 미매칭, 정상), "gridView 셀병합"→`[gridView]`, "$p.data 접근"→`[$p/data, $p]`(collect-all 정상).

## 백업 / 상태
- 백업: `src/generator/mcpContext.js.bak_20260601` (5/27 수정전 상태).
- `mcpContext.js`는 여전히 미커밋(M). Phase 3 alias 추가 + 본 버그수정이 함께 포함된 상태.
