# Phase 3 (5/27 추가 컴포넌트) AI 답변 테스트 결과

- 실행 시작: 2026-05-27T01:34:01.655Z
- 실행 종료: 2026-05-27T01:50:48.600Z
- 총 문의 수: 15
- 검증 대상: textarea/checkbox/radio/multiselect/datePicker/calendar/fwGaugeChart/fwGanttChart/mapchart/WebSquare.cookie/WebSquare.json/$p.data/nameLayer/scrollView/gridView/header

## 1. 문의

textarea 컴포넌트를 readOnly로 설정하면서 글자 색상도 회색으로 변경하려면 어떻게 하나요?

### 결과 요약
- 상태: 성공 (28s)
- 분류: input / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`textarea` 컴포넌트를 `readOnly`로 설정한 뒤 글자 색상을 회색으로 변경하려면, `readOnly` 설정과 별도로 CSS class 또는 style을 적용해 글자색을 지정해 주시면 됩니다. `textarea` 내부 텍스트는 HTML tag 방식으로 일부 글자만 색상을 다르게 표현하는 방식은 적용되지 않으므로, 컴포넌트 전체 글자색 기준으로 처리해야 합니다.

적용 방법은 다음과 같습니다.

1. `textarea` 컴포넌트에 `readOnly`를 설정합니다.
2. 해당 컴포넌트에 적용할 class를 지정합니다.
3. CSS에서 `color` 값을 회색으로 지정합니다.

예시는 다음과 같습니다.

```css
.txtarea_readonly_gray {
    color: #999999;
}
```

```javascript
// txt_memo는 사용자 정의 textarea 컴포넌트 ID 예시입니다.
txt_memo.setReadOnly(true);
txt_memo.addClass("txtarea_readonly_gray");
```

이미 XML에서 class를 지정할 수 있는 구조라면 다음처럼 readOnly 상태로 사용할 textarea에 class를 함께 지정하는 방식도 사용할 수 있습니다.

```xml
<w2:textarea id="txt_memo" readOnly="true" class="txtarea_readonly_gray" />
```

주의사항입니다.

- 위 예시의 `txt_memo`, `txtarea_readonly_gray`는 사용자 정의 ID/class 예시입니다.
- `textarea`는 입력/출력용 텍스트 컴포넌트이므로, 특정 줄이나 특정 문자만 별도 색상으로 표시하는 HTML tag 표현은 지원되지 않습니다.
- 사용하는 엔진 버전이나 적용 중인 공통 CSS 우선순위에 따라 색상이 덮어써질 수 있으므로, 적용되지 않으면 개발자 도구에서 실제 적용 CSS 우선순위를 확인해 주세요.

감사합니다.

---
이 문의는 엔진 버전, 패치, 프로젝트 설정 또는 재현 확인이 필요할 수 있어 엔지니어 추가 답변을 권장드립니다.
```

## 2. 문의

checkbox 그룹에서 모두 선택/해제 버튼을 구현하려면 어떤 API를 사용해야 하나요?

### 결과 요약
- 상태: 성공 (32s)
- 분류: input / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

checkbox 그룹에서 모두 선택/해제 버튼을 구현할 때는 `checkbox` 컴포넌트의 `checkAll(checked)` API를 사용하시면 됩니다. `true`를 전달하면 전체 선택, `false`를 전달하면 전체 해제됩니다.

적용 방법은 다음과 같습니다.

1. 전체 선택 버튼 클릭 시 `checkboxId.checkAll(true)`를 호출합니다.
2. 전체 해제 버튼 클릭 시 `checkboxId.checkAll(false)`를 호출합니다.
3. `checkboxId`는 실제 화면에 선언된 checkbox 컴포넌트 ID로 변경해서 사용합니다.

예시 코드는 다음과 같습니다.

```javascript
// 전체 선택
checkbox1.checkAll(true);

// 전체 해제
checkbox1.checkAll(false);
```

버튼 이벤트에 연결하는 예시는 다음과 같습니다.

```javascript
scwin.btnSelectAll_onclick = function() {
    checkbox1.checkAll(true);
};

scwin.btnClearAll_onclick = function() {
    checkbox1.checkAll(false);
};
```

위 예시의 `btnSelectAll_onclick`, `btnClearAll_onclick`은 사용자 정의 이벤트 함수명 예시이며, `checkbox1`은 화면에 선언된 checkbox 컴포넌트 ID로 변경해 적용해 주세요.

감사합니다.

---
위 답변이 문의 내용과 일치하면 답변을 채택해 주세요.
추가 확인이 필요하면 AI 추가답변 또는 엔지니어 추가 답변을 요청하실 수 있습니다.
```

## 3. 문의

radio 컴포넌트에서 선택된 값을 가져오는 방법과 onclick 이벤트 처리는 어떻게 하나요?

### 결과 요약
- 상태: 성공 (57s)
- 분류: input / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

radio 컴포넌트에서 현재 선택된 값은 `getValue()`로 확인하고, 클릭 또는 값 변경 처리는 이벤트를 등록하여 처리하시면 됩니다. 라벨 클릭 이벤트를 스크립트에서 강제로 발생시켜야 하는 경우에는 WebSquare 컴포넌트 공통 API인 `trigger()`를 사용할 수 있습니다.

1. 현재 선택된 value 확인: `radio1.getValue()`
2. 값 변경 시점 처리: `onviewchange` 또는 `onchange`
3. 라벨 클릭 처리: `onlabelclick`
4. 스크립트에서 이벤트 발생: `radio1.trigger("onlabelclick")`
5. 이벤트를 동적으로 연결해야 하는 경우: `bind(eventType, function)`

아래 예시의 `radio1`, `selectedValue`는 사용자 정의 예시이며 공식 API명이 아닙니다.

```javascript
// radio1은 화면에 배치된 radio 컴포넌트 ID 예시입니다.

scwin.radio1_onviewchange = function(info) {
    var selectedValue = radio1.getValue();

    // selectedValue를 기준으로 업무 로직 처리
};

scwin.radio1_onlabelclick = function() {
    var selectedValue = radio1.getValue();

    // label 클릭 시 처리할 업무 로직
};
```

이벤트를 동적으로 연결해야 하는 경우에는 다음과 같이 `bind()`를 사용할 수 있습니다.

```javascript
radio1.bind("onviewchange", function(info) {
    var selectedValue = radio1.getValue();
});
```

스크립트에서 특정 이벤트를 발생시켜야 하는 경우에는 `trigger()`를 사용합니다.

```javascript
radio1.trigger("onlabelclick");
```

Generator 내부에 생성된 radio라면 먼저 해당 행의 자식 radio 객체를 얻은 뒤 그 객체에 대해 `getValue()`, `bind()`, `trigger()`를 호출해야 합니다. 사용 중인 엔진 버전, radio 렌더링 방식, Generator 사용 여부에 따라 이벤트 발생 범위가 달라질 수 있으므로 적용 후 실제 클릭 영역과 Version 정보 기준으로 확인해 주세요.

감사합니다.

---
위 답변은 현재 참고자료와 유사 사례 기준의 우선 확인/적용 방향입니다.
엔진 상세 버전, 재현 샘플, 적용 화면 구조에 따라 세부 조정이 필요하면 추가 정보를 입력해 주세요.
```

## 4. 문의

multiselect 컴포넌트에 dataList로 다수의 항목을 동적으로 바인딩하려면 어떻게 설정하나요?

### 결과 요약
- 상태: 성공 (156s)
- 분류: data / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`multiselect`는 `xf:select` 태그를 사용하는 컴포넌트이며, 선택 항목 목록은 `xf:choices` 하위의 `xf:itemset`을 `dataList`에 연결해 구성할 수 있습니다. 조회 후 항목명이 변경되는 경우에는 `multiselect` API가 아니라 연결된 `dataList`의 `setCellData(rowIndex, columnInfo, data)`로 데이터를 갱신하는 방식이 기본입니다.

1. 선택값 저장용 `ref`에는 화면에서 선언한 `dataMap` key를 바인딩합니다.
2. 항목 목록은 `xf:itemset nodeset="data:데이터리스트ID"`로 연결합니다.
3. 표시 문구는 `xf:label ref="컬럼ID"`, 실제 값은 `xf:value ref="컬럼ID"`로 지정합니다.
4. `addItem` 또는 `deleteItem`으로 항목을 직접 추가/삭제할 경우 `dataListAutoRefresh="true"` 설정을 함께 확인합니다.

```xml
<!-- dma_sample, selectedValues, dlt_codeList, code, name, msl_sample은 사용자 정의 예시이며 공식 API명이 아닙니다. -->
<w2:dataMap id="dma_sample" baseNode="map">
    <w2:keyInfo>
        <w2:key id="selectedValues" dataType="text"></w2:key>
    </w2:keyInfo>
</w2:dataMap>

<w2:dataList id="dlt_codeList" baseNode="list" repeatNode="map">
    <w2:columnInfo>
        <w2:column id="code" dataType="text"></w2:column>
        <w2:column id="name" dataType="text"></w2:column>
    </w2:columnInfo>
</w2:dataList>

<xf:select id="msl_sample" ref="data:dma_sample.selectedValues" appearance="minimal" dataListAutoRefresh="true">
    <xf:choices>
        <xf:itemset nodeset="data:dlt_codeList">
            <xf:label ref="name"></xf:label>
            <xf:value ref="code"></xf:value>
        </xf:itemset>
    </xf:choices>
</xf:select>
```

```javascript
// dlt_codeList, code, name은 사용자 정의 예시 ID/컬럼명입니다.
dlt_codeList.setCellData(0, "name", "변경된 항목명");

// 항목을 직접 추가하는 경우
msl_sample.addItem("A03", "추가 항목", undefined, true);
```

`selectedValues`는 WebSquare 공식 API가 아니라 위 예시에서 선언한 `dataMap`의 사용자 정의 key입니다. 실제 적용 시에는 프로젝트에서 사용하는 `dataMap` ID와 key ID, `dataList` 컬럼명으로 변경해 주세요.

감사합니다.

---
**검증 경고**: 아래 API/속성은 내부 데이터에서 확인되지 않았습니다. 실제 존재 여부를 확인해주세요.
- `selectedValues`

---
위 답변이 문의 내용과 일치하면 답변을 채택해 주세요.
추가 확인이 필요하면 AI 추가답변 또는 엔지니어 추가 답변을 요청하실 수 있습니다.
```

## 5. 문의

datePicker 컴포넌트에서 날짜 형식을 yyyy-MM-dd로 설정하고 최대/최소 날짜를 제한하는 방법은?

### 결과 요약
- 상태: 성공 (55s)
- 분류: input / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

datePicker에서는 날짜 선택 단위를 `calendarValueType="yearMonthDate"`로 설정해 연/월/일 선택 UI를 사용할 수 있습니다. 다만 공식 스펙 기준 `getValue()`는 `yyyyMMdd` 형식 문자열을 반환하므로, `yyyy-MM-dd` 형식이 필요하면 반환값을 화면/업무 로직에서 변환해 사용해야 합니다.

1. XML에서 datePicker를 연/월/일 형식으로 설정합니다.
```xml
<w2:datePicker id="datePicker1" calendarValueType="yearMonthDate"></w2:datePicker>
```

2. 선택값을 `yyyy-MM-dd`로 변환합니다.
```javascript
scwin.getDatePickerValue = function() {
    var value = datePicker1.getValue(); // 예: "20260527"

    if (value && value.length === 8) {
        return value.substring(0, 4) + "-" +
               value.substring(4, 6) + "-" +
               value.substring(6, 8);
    }

    return value;
};
```

3. 최대/최소 날짜 제한이 반드시 필요한 경우에는 사용 중인 컴포넌트가 datePicker인지, Calendar/InputCalendar인지 먼저 확인해 주세요. 공식 스펙 기준 datePicker에는 `setDisableBeforeDate()`, `setDisableAfterDate()` API가 확인되지 않으며, 해당 API는 InputCalendar/Calendar 계열에서 사용하는 방식입니다.

InputCalendar를 사용할 수 있는 화면이라면 다음과 같은 방식으로 범위를 제한할 수 있습니다.

```javascript
inputCalendar1.setDisableBeforeDate("20260101");
inputCalendar1.setDisableAfterDate("20261231");
```

주의사항으로, datePicker는 모바일 전용 대체 컴포넌트 성격이 있으므로 PC 화면에서 날짜 입력 형식과 선택 가능 범위를 세밀하게 제어해야 한다면 InputCalendar 또는 Calendar 적용 여부를 함께 검토해 주세요. 정확한 안내를 위해 사용 중인 WebSquare 엔진 버전과 현재 XML의 datePicker 설정 내용을 추가로 확인하면 좋습니다.

감사합니다.

---
이 문의는 엔진 버전, 패치, 프로젝트 설정 또는 재현 확인이 필요할 수 있어 엔지니어 추가 답변을 권장드립니다.
```

## 6. 문의

calendar 컴포넌트로 특정 날짜를 클릭했을 때 일정을 표시하려면 어떤 이벤트를 사용하나요?

### 결과 요약
- 상태: 성공 (31s)
- 분류: input / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`calendar` 컴포넌트에서 사용자가 특정 날짜를 선택했을 때 일정을 표시하려면 `ondateselect` 이벤트를 사용하는 것이 적합합니다. 이 이벤트는 날짜 선택 시 발생하며, 선택한 날짜 문자열과 `Date` 객체를 파라미터로 전달합니다.

적용 방법은 다음과 같습니다.

1. `calendar` 컴포넌트에 `ondateselect` 이벤트를 등록합니다.
2. 이벤트에서 전달되는 `date` 값을 기준으로 해당 날짜의 일정 데이터를 조회하거나 화면에 표시합니다.
3. `date` 값은 예를 들어 `20260527` 형식의 문자열로 전달됩니다.

예시입니다.

```xml
<w2:calendar id="cal1">
    <script ev:event="ondateselect(date, dateObject)"><![CDATA[
        // showScheduleByDate는 사용자 정의 함수 예시입니다.
        scwin.showScheduleByDate(date);
    ]]></script>
</w2:calendar>
```

```javascript
// 사용자 정의 함수 예시입니다.
scwin.showScheduleByDate = function(date) {
    // date 예: "20260527"
    // 해당 날짜의 일정 조회 또는 화면 표시 로직을 작성합니다.
};
```

`onclick`은 calendar 영역 클릭 자체에 대한 이벤트이므로, 날짜 선택값을 기준으로 일정을 처리하는 용도라면 `ondateselect`를 우선 사용하시기 바랍니다. 스크립트로 날짜 값을 변경한 경우까지 감지해야 한다면 `onchange`, 사용자 마우스/키보드 조작에 의한 변경만 감지해야 한다면 `onviewchange`도 함께 검토할 수 있습니다.

감사합니다.

---
위 답변은 현재 참고자료와 유사 사례 기준의 우선 확인/적용 방향입니다.
엔진 상세 버전, 재현 샘플, 적용 화면 구조에 따라 세부 조정이 필요하면 추가 정보를 입력해 주세요.
```

## 7. 문의

fwGaugeChart에 setValue로 값을 설정하고 범위(min, max)를 동적으로 변경하는 방법을 알려주세요.

### 결과 요약
- 상태: 성공 (109s)
- 분류: engine / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`fwGaugeChart`의 게이지 값과 범위는 차트에 전달하는 FusionWidgets 데이터 옵션을 갱신하는 방식으로 처리해 주세요. 범위는 `lowerlimit`, `upperlimit` 값을 변경하고, 현재 값은 `dials.dial.value`와 같은 차트 데이터 구조에 반영한 뒤 차트를 다시 렌더링하는 방식으로 적용할 수 있습니다.

적용 방법은 다음과 같습니다.

1. 기존 게이지 차트 데이터에서 `chart.lowerlimit`과 `chart.upperlimit` 값을 변경합니다.
2. 현재 게이지 값은 `dials.dial[0].value`에 반영합니다.
3. 변경한 데이터 객체를 화면의 차트 재설정 로직에 전달합니다.
4. 차트가 이미 생성된 후 옵션을 반영해야 하는 경우, 유사 사례 기준으로 `fwGaugeChart.fc().render()`를 호출해 다시 렌더링합니다.

아래 예시는 참고용입니다. `changeGaugeRange`, `dataSource`, `fwGaugeChart1`은 사용자 정의 예시이며 공식 API명이 아닙니다. `lowerlimit`, `upperlimit`, `dials`는 WebSquare API가 아니라 FusionWidgets 차트 데이터 옵션입니다.

```javascript
scwin.changeGaugeRange = function(value, minValue, maxValue) {
    var dataSource = {
        chart: {
            lowerlimit: String(minValue),
            upperlimit: String(maxValue),
            showvalue: "1",
            numbersuffix: "%"
        },
        colorrange: {
            color: [
                { minvalue: String(minValue), maxvalue: "50", code: "#F2726F" },
                { minvalue: "50", maxvalue: "75", code: "#FFC533" },
                { minvalue: "75", maxvalue: String(maxValue), code: "#62B58F" }
            ]
        },
        dials: {
            dial: [
                { value: String(value) }
            ]
        }
    };

    // dataSource를 현재 화면의 차트 데이터 재설정 로직에 반영한 뒤 렌더링합니다.
    fwGaugeChart1.fc().render();
};
```

`onpageload` 시점에 차트 옵션이나 테마가 바로 반영되지 않는 경우에는 차트 생성과 외부 라이브러리 로딩 순서가 맞지 않을 수 있습니다. 이 경우 유사 사례 기준으로 `$p.setTimeout()`으로 렌더링 시점을 늦춰 확인해 주세요.

```javascript
$p.setTimeout(function() {
    fwGaugeChart1.fc().render();
}, 0);
```

실제 데이터 반영 API는 사용 중인 WebSquare 엔진 버전과 FusionCharts/FusionWidgets 버전에 따라 확인이 필요합니다. 현재 화면의 차트 초기화 코드와 엔진 버전을 함께 확인해 주시면 적용 위치를 더 구체적으로 안내드릴 수 있습니다.

감사합니다.

---
**검증 경고**: 아래 API/속성은 내부 데이터에서 확인되지 않았습니다. 실제 존재 여부를 확인해주세요.
- `dials.dial.value`
- `chart.lowerlimit`
- `chart.upperlimit`

---
이 문의는 엔진 버전, 패치, 프로젝트 설정 또는 재현 확인이 필요할 수 있어 엔지니어 추가 답변을 권장드립니다.
```

## 8. 문의

fwGanttChart에서 task 사이를 connector로 연결하고 milestone을 추가하는 사용 예시를 알려주세요.

### 결과 요약
- 상태: 성공 (144s)
- 분류: chart / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`fwGanttChart`에서 task 간 연결은 `setConnector(info)`, milestone 표시는 `setMilestone(info)` 메서드로 설정할 수 있습니다. `fromtaskid`, `totaskid`, `taskid`는 XML 속성이 아니라 각 메서드에 전달하는 `info` 객체의 항목으로 사용합니다.

적용 순서는 다음과 같습니다.

1. `fwGanttChart`의 task 데이터와 task ID가 먼저 구성된 상태에서 처리합니다.
2. task 간 연결이 필요하면 `setConnector(info)`를 호출합니다.
3. milestone 표시가 필요하면 `setMilestone(info)`를 호출합니다.

예시는 다음과 같습니다.

```javascript
scwin.onpageload = function() {
    var connectorInfo = {
        "fromtaskid": "2",
        "totaskid": "1",
        "thickness": "2"
    };

    fwGanttChart1.setConnector(connectorInfo);

    var milestoneInfo = {
        "date": "05/01/2015",
        "taskid": "3",
        "color": "#f8bd19",
        "shape": "star",
        "tooltext": "MileStones"
    };

    fwGanttChart1.setMilestone(milestoneInfo);
};
```

위 예시에서 `fwGanttChart1`은 화면에 배치한 컴포넌트 ID 예시이고, `connectorInfo`, `milestoneInfo`는 사용자 정의 변수명입니다. `fromtaskid`, `totaskid`, `taskid` 값은 차트에 구성된 실제 task ID 값과 일치해야 연결 및 milestone 표시가 정상 동작합니다.

사용 중인 엔진 버전과 FusionWidget 렌더링 상태에 따라 적용 시점 확인이 필요할 수 있으므로, 데이터 바인딩 완료 후 호출하고 브라우저 콘솔 오류도 함께 확인해 주세요.

감사합니다.

---
**검증 경고**: 아래 API/속성은 내부 데이터에서 확인되지 않았습니다. 실제 존재 여부를 확인해주세요.
- `fromtaskid`
- `totaskid`
- `taskid`
- `setConnector`
- `setMilestone`

---
위 답변이 문의 내용과 일치하면 답변을 채택해 주세요.
추가 확인이 필요하면 AI 추가답변 또는 엔지니어 추가 답변을 요청하실 수 있습니다.
```

## 9. 문의

mapchart 컴포넌트에서 시도 → 시군구로 drilldown 했을 때 dataList의 색상을 새로 적용하려면?

### 결과 요약
- 상태: 성공 (60s)
- 분류: data / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

mapchart에서 시도 → 시군구 drilldown 시 색상을 새로 적용하려면 `setColorScale`을 해당 지도 `level`에 맞게 다시 설정해 주시면 됩니다. fusionchart의 `setPlotColor`나 `colorNode` 방식은 mapchart API가 아니므로 mapchart에는 `setColorScale(level, key, domain, range)` 기준으로 적용해야 합니다.

1. mapchart의 `dataLists` 속성에 연동할 `dataList`를 지정합니다.
2. 시도 단위 색상은 level `"0"`, 시군구 단위 색상은 일반적으로 level `"1"` 기준으로 `setColorScale`을 설정합니다.
3. drilldown 전에 시군구용 dataList 데이터를 먼저 갱신한 뒤, 시군구 level에 대해 `setColorScale`을 호출합니다.
4. 특정 지역으로 직접 이동해야 하는 경우에는 `changeMap(code)`를 사용해 해당 코드의 지도로 변경합니다.

아래 예시는 참고용입니다. `scwin.applySigunguColor`, `dl_sigungu`, `percent`는 사용자 정의 예시이므로 실제 화면의 dataList ID와 컬럼명에 맞게 변경해 주세요.

```javascript
scwin.applySigunguColor = function() {
    // percent 컬럼 값을 기준으로 시군구(level 1) 색상 범위를 지정
    mapchart1.setColorScale(
        "1",
        "percent",
        [0, 0.25, 0.5, 0.75, 1],
        ["#d73027", "#fc8d59", "#fee08b", "#91bfdb", "#4575b4"]
    );
};

// 예: 서울 코드로 drilldown 처리 전/후 시군구 데이터 준비 시점에 호출
scwin.drilldownSeoul = function() {
    // dl_sigungu.setJSON(...) 또는 조회 결과 바인딩 등 데이터 갱신 처리
    scwin.applySigunguColor();
    mapchart1.changeMap("11");
};
```

이미 drilldown된 뒤에 dataList 값만 변경하는 구조라면, 색상 기준도 함께 다시 설정한 후 지도가 다시 그려지는 흐름에서 반영되는지 확인해 주세요. 사용 중인 엔진 버전과 dataList 컬럼 구조, drilldown을 자동 이벤트(`event_drilldown`)로 처리하는지 `changeMap`으로 직접 처리하는지에 따라 적용 시점 확인이 필요할 수 있습니다.

감사합니다.

---
이 문의는 엔진 버전, 패치, 프로젝트 설정 또는 재현 확인이 필요할 수 있어 엔지니어 추가 답변을 권장드립니다.
```

## 10. 문의

WebSquare.cookie API로 만료 시간을 설정한 쿠키를 생성하고 읽어오는 방법을 보여주세요.

### 결과 요약
- 상태: 성공 (72s)
- 분류: engine / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

WebSquare.cookie API에서는 쿠키 저장, 조회, 삭제가 가능하지만, API Guide 기준 `setCookie(sName, sValue, SameSite)`에 만료 시간을 지정하는 별도 파라미터는 확인되지 않습니다. 만료 시간이 필요한 쿠키는 WebSquare.cookie API만으로 처리하지 말고, 일반 브라우저 쿠키 설정 방식 적용 가능 여부를 담당자 [이름] 후 검토해 주세요.

적용 가능한 WebSquare.cookie API는 다음과 같습니다.

- `WebSquare.cookie.setCookie(sName, sValue, SameSite)` : 쿠키 저장
- `WebSquare.cookie.getCookie(sName)` : 쿠키 값 조회
- `WebSquare.cookie.delCookie(sName)` : 쿠키 삭제
- `WebSquare.cookie.setCookieAsync(sName, sValue, SameSite)` : 비동기 쿠키 저장

예시는 다음과 같습니다.

```javascript
// WebSquare.cookie API를 이용한 쿠키 저장
WebSquare.cookie.setCookie("popupCloseYn", "Y", "Lax");

// WebSquare.cookie API를 이용한 쿠키 조회
var popupCloseYn = WebSquare.cookie.getCookie("popupCloseYn");

// WebSquare.cookie API를 이용한 쿠키 삭제
WebSquare.cookie.delCookie("popupCloseYn");
```

아래 예시는 참고용입니다. `expireDate`, `popupCloseYn`은 사용자 정의 예시이며 공식 WebSquare API명이 아닙니다.

```javascript
// 사용자 정의 예시: 현재 시점부터 1일 뒤 시각 생성
var expireDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

// 일반 JavaScript 방식으로 쿠키 문자열 설정
document.cookie =
  "popupCloseYn=Y; expires=" + expireDate.toUTCString() + "; path=/; SameSite=Lax";

// 저장 후 값 조회는 WebSquare.cookie API로 확인
var popupCloseYn = WebSquare.cookie.getCookie("popupCloseYn");
```

주의사항은 다음과 같습니다.

- `WebSquare.cookie.setCookie`의 세 번째 인자는 `SameSite` 속성값입니다.
- 만료 시간 설정은 WebSquare.cookie API Guide에서 별도 인자로 확인되지 않으므로, 사용 중인 WebSquare 엔진 버전 기준으로 담당자 [이름] 필요합니다.
- 브라우저 보안 정책과 실행 도메인 조건에 따라 쿠키 저장 여부가 달라질 수 있습니다.

감사합니다.

---
이 요청은 파일 전달, 라이선스, 계약 또는 권한 확인이 필요한 사안일 수 있어 엔지니어 추가 답변을 요청해 주세요.
```

## 11. 문의

WebSquare.json.parse를 사용해 JSON 문자열을 안전하게 객체로 변환하는 권장 패턴이 있나요?

### 결과 요약
- 상태: 성공 (57s)
- 분류: data / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`WebSquare.json.parse`는 제공된 API Guide 기준으로 확인되는 공식 API가 아니므로, JSON 문자열을 객체로 변환할 때는 JavaScript 표준 `JSON.parse()` 사용을 권장합니다. WebSquare에서 공식 확인되는 `WebSquare.json` API는 JSON/XML 변환 용도의 `JSON2XML()`, `XML2JSONString()`입니다.

적용 방법은 다음과 같습니다.

1. 서버 응답값이 문자열인지 먼저 확인합니다.
2. 문자열이면 JavaScript 표준 `JSON.parse()`로 변환합니다.
3. 이미 객체로 전달된 값은 다시 변환하지 않습니다.
4. 변환 후 필요한 속성인 `message`, `resultCode` 등을 참조합니다.

아래 예시는 참고용입니다. `parseJsonSafely`, `responseText`, `resObj`는 사용자 정의 예시이며 WebSquare 공식 API명이 아닙니다. `JSON.parse()`는 JavaScript 표준 API입니다.

```javascript
function parseJsonSafely(responseText) {
    if (typeof responseText === "object" && responseText !== null) {
        return responseText;
    }

    if (typeof responseText !== "string" || responseText.trim() === "") {
        return null;
    }

    try {
        return JSON.parse(responseText);
    } catch (e) {
        console.error("JSON parse error", e);
        return null;
    }
}

var resObj = parseJsonSafely(responseText);

if (resObj && resObj.message) {
    alert(resObj.message);
}
```

팝업 파라미터나 submission 응답 처리에서 JSON 객체 전달이 불안정한 경우에는 유사 사례 기준으로 `JSON.stringify()`로 문자열화해 전달하고, 수신 측에서 `JSON.parse()`로 복원하는 방식이 사용됩니다. 실제 응답 데이터 타입은 submission 설정, 공통 callback 처리 방식, 엔진 버전에 따라 달라질 수 있으므로 사용 중인 엔진 버전과 실제 응답 원문을 함께 확인해 주세요.

감사합니다.

---
위 답변은 현재 참고자료와 유사 사례 기준의 우선 확인/적용 방향입니다.
엔진 상세 버전, 재현 샘플, 적용 화면 구조에 따라 세부 조정이 필요하면 추가 정보를 입력해 주세요.
```

## 12. 문의

$p.data.get("JSON")으로 DataMap/DataList 전체 데이터를 한 번에 가져올 때 nullYNType 설정이 결과에 어떻게 영향을 주나요?

### 결과 요약
- 상태: 성공 (36s)
- 분류: data / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`$p.data.get("JSON")`으로 DataMap/DataList 데이터를 조회할 때 `nullYNType`은 `nullYN="true"`로 지정된 key 또는 column의 공백 값을 어떻게 반환할지 결정합니다. 즉, 전체 데이터를 한 번에 가져오더라도 `nullYNType`이 적용된 DataMap/DataList에서는 공백 값이 기본값 그대로 반환되거나, 키에서 제외되거나, `null`로 변환될 수 있습니다.

적용 방식은 다음과 같습니다.

1. DataMap 또는 DataList에 `nullYNType`을 설정합니다.
2. null 처리가 필요한 key 또는 column에 `nullYN="true"`를 설정합니다.
3. `$p.data.get("JSON")`으로 데이터를 조회합니다.

`nullYNType` 옵션별 동작은 다음과 같습니다.

- `default`: 기존 동작과 동일하게 공백 값을 반환합니다.
- `exclude`: `nullYN="true"`인 항목의 값이 공백이면 결과 JSON에서 해당 키를 제외합니다.
- `null`: `nullYN="true"`인 항목의 값이 공백이면 결과 JSON에서 해당 값을 `null`로 반환합니다.

예시는 다음과 같습니다.

```xml
<w2:dataMap id="dma_sample" baseNode="map" nullYNType="null">
    <w2:keyInfo>
        <w2:key id="name" dataType="text" nullYN="true"/>
        <w2:key id="age" dataType="text"/>
    </w2:keyInfo>
</w2:dataMap>
```

```javascript
var result = $p.data.get("JSON", ["dma_sample"]);
```

위 예시에서 `name` 값이 공백이고 `nullYN="true"`이면, `nullYNType="null"` 설정에 따라 `name`은 `null`로 반환됩니다. 반면 `age`처럼 `nullYN="true"`가 없는 항목은 `nullYNType` 처리 대상이 아닙니다.

주의할 점은 `nullYNType`만 설정한다고 모든 공백 값이 자동으로 `null` 처리되는 것은 아니라는 점입니다. 반드시 대상 key 또는 column에 `nullYN="true"` 설정이 함께 있어야 하며, 실제 반환 형태는 사용 중인 WebSquare 엔진 버전과 DataMap/DataList 정의 구조에 따라 확인이 필요할 수 있습니다.

감사합니다.

---
위 답변은 현재 참고자료와 유사 사례 기준의 우선 확인/적용 방향입니다.
엔진 상세 버전, 재현 샘플, 적용 화면 구조에 따라 세부 조정이 필요하면 추가 정보를 입력해 주세요.
```

## 13. 문의

nameLayer 컴포넌트로 보안 처리(블러)를 적용하고 클릭 시 해제하는 방법은?

### 결과 요약
- 상태: 성공 (59s)
- 분류: security / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`nameLayer` 영역에 보안용 블러를 적용하고 클릭 시 해제하는 전용 WebSquare API/속성은 제공 자료 기준으로 확인되지 않습니다. 따라서 특정 `nameLayer`만 처리해야 하는 경우에는 렌더링된 DOM 요소에 CSS 클래스를 적용하고, 클릭 이벤트에서 해당 클래스를 제거하는 방식으로 구현해야 합니다.

1. 브라우저 개발자 도구에서 블러 처리할 `nameLayer`의 실제 DOM class 또는 식별 가능한 상위 구조를 확인합니다.
2. 해당 요소에 사용자 정의 CSS 클래스를 적용해 `filter: blur(...)` 스타일을 지정합니다.
3. 클릭 시 사용자 정의 JavaScript 이벤트 핸들러에서 해당 클래스를 제거합니다.

아래 예시는 참고용입니다. `secureNameLayer`, `secure_nameLayer`는 사용자 정의 예시이며 WebSquare 공식 API명이 아닙니다.

```css
.secure_nameLayer {
  filter: blur(4px);
  cursor: pointer;
}
```

```javascript
scwin.onpageload = function() {
  var secureNameLayer = document.querySelector(".secure_nameLayer");

  if (secureNameLayer) {
    secureNameLayer.addEventListener("click", function() {
      secureNameLayer.classList.remove("secure_nameLayer");
    });
  }
};
```

`windowContainer`의 `nameLayerMove`는 참고 사례 기준으로 컨테이너 단위 옵션으로 동작하므로, 특정 탭 또는 특정 `nameLayer`만 별도 보안 처리하려면 공식 속성 설정이 아니라 DOM 기준의 개별 이벤트 제어로 처리해야 합니다. 엔진 버전과 화면 구조에 따라 `nameLayer`의 실제 DOM 계층이 달라질 수 있으므로, 적용 전 대상 요소가 안정적으로 식별되는지 확인해 주세요.

감사합니다.

---
이 문의는 엔진 버전, 패치, 프로젝트 설정 또는 재현 확인이 필요할 수 있어 엔지니어 추가 답변을 권장드립니다.
```

## 14. 문의

scrollView 안에 동적으로 추가한 컴포넌트가 스크롤되지 않을 때 확인할 점은 무엇인가요?

### 결과 요약
- 상태: 성공 (36s)
- 분류: publishing / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

`scrollView` 안에 동적으로 추가한 컴포넌트가 스크롤되지 않는 경우에는 먼저 추가된 컴포넌트가 실제로 `scrollView` 하위 영역에 생성되었는지, 그리고 콘텐츠 높이가 `scrollView`의 표시 높이를 초과하는지 확인해야 합니다. `scrollView`는 모바일 전용 터치 스크롤 컴포넌트이며, `group`처럼 하위 컴포넌트를 포함할 수 있습니다.

확인 순서는 다음과 같습니다.

1. 동적으로 추가한 컴포넌트가 `scrollView` 내부 하위 컴포넌트로 생성되는지 확인합니다.
2. `scrollView` 자체에 명확한 `height`가 지정되어 있는지 확인합니다.
3. 내부 콘텐츠의 전체 높이가 `scrollView` 높이보다 커지는지 확인합니다.
4. 상위 `group`, `layout`, CSS 등에서 `overflow: hidden`, 고정 높이, 터치 이벤트 차단 처리가 적용되어 있지 않은지 확인합니다.
5. 모바일 터치 스크롤 용도로 사용하는 경우, PC 브라우저 테스트와 실제 모바일 동작이 다를 수 있으므로 대상 환경에서 함께 확인합니다.

스크롤 위치 확인이 필요한 경우에는 공식 API인 `getScrollTop()`으로 현재 `scrollTop` 값을 확인할 수 있습니다.

```javascript
// svw_content는 scrollView 컴포넌트 ID 예시입니다.
var nScrollTop = svw_content.getScrollTop();
console.log(nScrollTop);
```

동적 생성 직후에는 화면 렌더링이 아직 완료되지 않은 시점일 수 있으므로, 생성 직후 바로 스크롤 상태를 판단하기보다 컴포넌트가 화면에 반영된 이후 확인하는 방식으로 점검해 주세요. 사용 중인 엔진 버전, 동적 생성 방식, 실제 XML 구조에 따라 추가 확인이 필요할 수 있습니다.

감사합니다.

---
이 문의는 엔진 버전, 패치, 프로젝트 설정 또는 재현 확인이 필요할 수 있어 엔지니어 추가 답변을 권장드립니다.
```

## 15. 문의

gridView 헤더(gridView/header) 셀에 정렬 아이콘과 클릭 이벤트를 추가하려면 어떻게 하나요?

### 결과 요약
- 상태: 성공 (75s)
- 분류: gridview / -
- RAG 건수: 0
- MCP 사용: NO
- 출처:
- RAG
- MCP

### 답변

```
안녕하세요.
인스웨이브 기술지원 AI입니다.

gridView 헤더의 기본 정렬 아이콘/정렬 동작은 `sortable="true"`와 `sortEvent`로 설정할 수 있습니다. 헤더 클릭 시 별도 로직은 `onheaderclick` 이벤트에서 처리합니다.

1. 정렬 기능을 사용하려면 gridView에 `sortable="true"`를 설정합니다.
2. 헤더 클릭으로 정렬하려면 `sortEvent="onclick"`을 설정합니다. 기본값은 `ondblclick`입니다.
3. 헤더 클릭 시 추가 처리가 필요하면 `onheaderclick`을 사용합니다. 파라미터는 클릭된 헤더의 ID인 `headerId`입니다.

```xml
<w2:gridView
    id="gridView1"
    sortable="true"
    sortEvent="onclick"
    onheaderclick="scwin.gridView1_onheaderclick">
</w2:gridView>
```

```javascript
scwin.gridView1_onheaderclick = function(headerId) {
    console.log("clicked headerId:", headerId);
};
```

위 예시의 `gridView1`, `scwin.gridView1_onheaderclick`은 사용자 정의 예시이며 공식 API명이 아닙니다. 공식으로 확인되는 항목은 `sortable`, `sortEvent`, `onheaderclick`, `headerId`입니다.

유사 사례 기준으로 헤더 셀에 `inputType="textImage"` 또는 `imageSrc`를 지정해 임의 이미지를 직접 표시하는 방식은 지원 대상으로 안내되지 않았습니다. 별도 아이콘 UI가 꼭 필요한 경우에는 사용 중인 WebSquare 엔진 버전과 실제 헤더 구성 방식 기준으로 적용 가능 여부를 추가 확인해야 합니다.

또한 `sortEvent="onclick"` 사용 시 헤더 리사이즈 과정에서 브라우저 클릭 이벤트가 발생하면 정렬이 수행될 수 있으므로, 리사이즈와 클릭 정렬을 함께 사용하는 화면에서는 실제 브라우저와 입력 장치에서 동작을 확인해 주세요.

감사합니다.

---
이 문의는 엔진 버전, 패치, 프로젝트 설정 또는 재현 확인이 필요할 수 있어 엔지니어 추가 답변을 권장드립니다.
```
