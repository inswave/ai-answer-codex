# 샘플 XML 자동 생성 배치 테스트 (2026-07-08)

- 조건: 운영 동일 (MCP 정적 덤프 + codex exec), 경량 검증(문법+속성 화이트리스트)
- 대상: latest_wtech_20 중 샘플 적합 9건

| 케이스 | 컴포넌트 | 결과 | 문법 | 속성 | 소요(s) | 비고 |
|---|---|---|---|---|---:|---|
| grid-copy | gridView | PASS | O | O | 113 |  |
| grid-footer | gridView | PASS | O | O | 101 |  |
| tab-hotkey | tabControl | FAIL | O | X | 130 | onchange |
| group-class | group | FAIL | O | X | 72 | id, class, ref, text |
| grid-shift-check | gridView | PASS | O | O | 70 |  |
| grid-save | gridView | FAIL | O | X | 105 | useSaveGridView |
| grid-fixed-right | gridView | PASS | O | O | 147 |  |
| autocomplete | autoComplete | FAIL | O | X | 87 | id, ref, search, searchTarget, displayMode, visibleRowNum, placeholder |
| grid-checkbox-label | gridView | PASS | O | O | 156 |  |

## 생성 파일
- grid-copy: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-26_grid-copy_sample.xml
- grid-footer: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-28_grid-footer_sample.xml
- tab-hotkey: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-30_tab-hotkey_sample.xml
- group-class: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-32_group-class_sample.xml
- grid-shift-check: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-33_grid-shift-check_sample.xml
- grid-save: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-34_grid-save_sample.xml
- grid-fixed-right: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-37_grid-fixed-right_sample.xml
- autocomplete: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-38_autocomplete_sample.xml
- grid-checkbox-label: C:\Users\user\Desktop\ai-answer-remote\data\samples_generated\2026-07-08-06-41_grid-checkbox-label_sample.xml
