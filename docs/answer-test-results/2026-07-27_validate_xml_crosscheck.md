# 생성 샘플 10건 라이브 validate_xml 교차 검증 (2026-07-27)

- 목적: 2026-07-08 배치의 경량 검증(문법 + 속성 화이트리스트) 결과를 MCP 라이브 `validate_xml`로 교차 검증하여 경량 검증기 신뢰도 확인
- 조건: MCP 서버(192.168.100.214:15748) 복구 후, essential 모드 전건 + 판정 갈린 2건은 strict 모드 추가 확인
- 대상: `data/samples_generated/` 10건 (7/8 배치 9건 + selectbox 프로토타입 1건)

## 결과 비교

| 케이스 | 경량(7/8) | 라이브 essential | 일치 여부 |
|---|---|---|---|
| selectbox | (수동 실행 확인) | valid, 경고 4 (필수속성 누락) | ✓ |
| grid-copy | PASS | valid, 경고 4 | ✓ |
| grid-footer | PASS | valid, 경고 3 | ✓ |
| tab-hotkey | FAIL (onchange) | valid — 단, `tac_menu_onchange` UNUSED_EVENT_HANDLER | △ 간접 일치 |
| group-class | FAIL (id, class, ref, text) | valid, unknown 속성 0건 | ✗ 경량 오탐 확정 |
| grid-shift-check | PASS | valid, 경고 2 | ✓ |
| grid-save | FAIL (useSaveGridView) | valid — 단, `useSaveGridView` UNKNOWN_ATTRIBUTE | ✓ 환각 확정 |
| grid-fixed-right | PASS | valid, 경고 10 (columnInfo name 누락) | ✓ (+라이브 추가 지적) |
| autocomplete | FAIL (7개 속성) | valid, 경고 0 (완전 무결) | ✗ 경량 오탐 확정 |
| grid-checkbox-label | PASS | valid, 경고 4 | ✓ |

## 핵심 확인 사항

### 1. 경량 검증기의 환각 차단 2건 → 라이브에서 확정
- **grid-save `useSaveGridView`**: 라이브도 `UNKNOWN_ATTRIBUTE`로 판정 (essential/strict 동일). 진짜 환각 맞음.
- **tab-hotkey `onchange`**: 라이브는 속성 자체를 unknown으로 보진 않았으나, `scwin.tac_menu_onchange`가 XML에서 바인딩되지 않았다는 `UNUSED_EVENT_HANDLER` 경고로 간접 확인. `ev:onchange`로 수정하는 것이 맞음.

### 2. 경량 검증기의 오탐 2건 → 덤프 구멍 진단 확정
- **group-class**: 라이브에서 id/class/ref/text 전부 정상 속성. 경고는 `dataMap baseNode` 1건뿐.
- **autocomplete**: 라이브에서 경고 0건 — 10건 중 유일하게 완전 무결. 경량이 FAIL시킨 7개 속성 전부 정상.
- → group(덤프 속성 1개)/autoComplete(속성 0개) 덤프 재수집 필요성 확정 (재개 할 일 2번).

### 3. 라이브 validate_xml 자체의 한계 (파이프라인 연동 시 주의)
- **인자 있는 인라인 핸들러 오탐**: `ev:onclick="scwin.openMenu('M01', ...);"`을 핸들러명 `scwin.openMenu(`로 파싱해 `UNDEFINED_EVENT_HANDLER` 오탐. strict 모드에서는 이것이 error로 승격되어 `isValid: false`가 됨 (tab-hotkey). 실제로는 정의된 함수임.
- **essential 모드의 isValid는 환각을 못 거름**: unknown 속성도 warning 처리라 10건 전부 `isValid: true`. **파이프라인 판정은 isValid가 아니라 `errors[] + UNKNOWN_ATTRIBUTE + UNDEFINED_EVENT_HANDLER(인자 오탐 보정 후)` 코드 기준으로 해야 함.**
- strict 모드는 severity 표기가 뒤섞임(errors 항목에 severity: warning 등) — 코드 기준 필터링 권장.

### 4. 라이브가 추가로 잡은 것 (경량에 없는 체크)
- 필수속성 누락 경고: `w2:column value/name`, `w2:dataMap baseNode`, `xf:trigger type`, `xf:select1 selectedIndex` 등. 실행에 치명적이진 않으나 생성 프롬프트에 반영하면 품질 향상 가능.

## 결론
- **덤프 충실 컴포넌트(gridView 계열)에서는 경량 검증기와 라이브가 7/7 완전 일치** — 경량 화이트리스트 방식 유효.
- 오탐의 원인은 검증 로직이 아니라 덤프 데이터 구멍 → 재수집으로 해결 가능.
- 권장 파이프라인: 경량(오프라인 1차) → 라이브 validate_xml(2차, 코드 기준 판정) 병행. 판정 기준 코드: `UNKNOWN_ATTRIBUTE`(환각), `UNDEFINED_EVENT_HANDLER`(단, `핸들러명(` 형태는 인라인 호출 오탐으로 보정).

## 다음 단계 (재개 할 일 기준)
2. group/autoComplete 등 부실 덤프 재수집
3. 재생성 루프 (미확인 속성 제외 후 1~2회 재시도, apiVerifier 패턴)
4. 파이프라인 연동 — human_review 큐 답변에만 우선 첨부
