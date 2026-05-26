# AI QNA 배치 비교

- 이전 리포트: `docs/answer-test-results/2026-05-22_101453_qna_answer_batch.md`
- 새 리포트: `docs/answer-test-results/2026-05-22_104917_qna_answer_batch.md`
- 비교 기준: 같은 10개 질문 재실행 결과

## 전체 요약

- 10개 모두 생성 성공.
- 새 답변은 10개 중 9개가 이전보다 길어졌고, 평균적으로 적용 절차와 예제가 더 구체화됨.
- 회피성 표현은 2건에서 0건으로 감소.
- 코드 예시는 8건에서 10건으로 증가.
- 검증 경고는 1건이 새로 남음: 8번 GridView 배경색 답변에서 `gridView.setRowBackgroundColor`, `gridView.setCellBackgroundColor`처럼 객체 prefix가 붙은 표현이 검증기에서 미확인으로 잡힘.

## 수치 비교

| No | 주제 | 이전 길이 | 새 길이 | 변화 | 회피 문구 | 코드 예시 | 검증 경고 |
|---:|---|---:|---:|---:|---|---|---|
| 1 | gridView mergeCells | 1377 | 1629 | +252 | 0 -> 0 | 있음 -> 있음 | 없음 -> 없음 |
| 2 | advancedExcelDownload xlsx | 1238 | 1281 | +43 | 0 -> 0 | 있음 -> 있음 | 없음 -> 없음 |
| 3 | submission timeout | 1350 | 1353 | +3 | 0 -> 0 | 있음 -> 있음 | 없음 -> 없음 |
| 4 | inputCalendar displayFormat | 913 | 1002 | +89 | 0 -> 0 | 있음 -> 있음 | 없음 -> 없음 |
| 5 | selectBox dataList binding | 1525 | 1783 | +258 | 1 -> 0 | 있음 -> 있음 | 없음 -> 없음 |
| 6 | dynamicCreate | 1848 | 2010 | +162 | 0 -> 0 | 있음 -> 있음 | 있음 -> 없음 |
| 7 | wframe parent call | 1489 | 1903 | +414 | 0 -> 0 | 있음 -> 있음 | 없음 -> 없음 |
| 8 | gridView row/cell background | 1543 | 1775 | +232 | 0 -> 0 | 있음 -> 있음 | 없음 -> 있음 |
| 9 | multipleExcelUpload DRM | 1251 | 1505 | +254 | 1 -> 0 | 없음 -> 있음 | 없음 -> 없음 |
| 10 | OCR image error | 1214 | 1226 | +12 | 0 -> 0 | 없음 -> 있음 | 없음 -> 없음 |

## 내용 차이

1. `needs_context` 답변이 덜 방어적으로 바뀜.
   - 이전에는 5번, 9번에서 "현재 참고자료 기준으로는"처럼 답변 범위를 먼저 좁히는 문장이 나옴.
   - 새 답변은 결론과 조치부터 말하고, 확인 필요 사항은 뒤로 보냄.

2. 예제 제공이 적극적으로 바뀜.
   - 9번 DRM, 10번 OCR은 이전에는 코드 예시가 없었지만 새 답변에는 확인 흐름 또는 처리 예시가 포함됨.
   - 7번 WFrame 답변은 `$p.parent()`와 `wframeID.getWindow()` 중심으로 더 실무적인 구조가 됨.

3. API 검증기 오탐이 일부 줄었음.
   - 6번 dynamicCreate는 이전에 검증 경고가 있었지만 새 결과에서는 경고 없음.
   - 사용자 정의 이름을 공식 API로 오해하는 문제는 많이 줄었음.

4. 아직 남은 개선점.
   - 8번 GridView 배경색 답변에서 실제 API명은 검증됐지만, `gridView.setRowBackgroundColor`처럼 객체 prefix가 붙은 형태가 별도 API 후보로 잡혀 경고가 남음.
   - 다음 개선은 `gridView.someApi` 형태를 `someApi`로 정규화해서 검증하는 쪽이 좋음.

## 대표 변화

### 5. selectBox

- 이전: `setNodeSet()`, `setColumnNodeSet()`을 말하면서도 회피 문구가 포함됨.
- 새 답변: 일반 selectBox는 `setNodeSet`, GridView select 컬럼은 `gridView.setColumnNodeSet`으로 역할을 분리해서 설명하고 회피 문구 없음.

### 7. WFrame

- 이전: `scopeInherit`, `$p.main()` 중심.
- 새 답변: 자식에서 부모는 `$p.parent()`, 부모에서 자식은 `wframeID.getWindow()`로 더 직접적인 사용 패턴을 제시.

### 9. DRM Excel Upload

- 이전: "현재 참고자료 기준으로는..."으로 시작하고 엔지니어 검토 쪽이 강함.
- 새 답변: DRM 복호화가 업로드 전에 정상 수행되는지, `options.pwd`는 엑셀 암호용이지 DRM 대체 옵션이 아니라는 점을 먼저 안내.

### 10. OCR

- 이전: OCR은 보조 정보이므로 실제 로그 확인 필요하다는 안내 중심.
- 새 답변: OCR 결과로 우선 원인/조치 방법을 안내하되, 실제 텍스트 로그와 재현 정보를 함께 요청하는 방식으로 바뀜.
