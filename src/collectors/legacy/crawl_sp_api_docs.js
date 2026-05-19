const fs = require("fs");
const path = require("path");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function htmlToText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const CONFIGS = [
  {
    label: "ws5_sp5_api",
    base: "https://docs.inswave.com/support/api/ws5_sp5/5.0_5.5337A.20260127.170112",
    pages: [
      "$p/$p.html","$p.data/$p.data.html","$p.local/$p.local.html","$p.top/$p.top.html",
      "WebSquare.bigDecimal/WebSquare.bigDecimal.html",
      "WebSquare.collection/WebSquare.collection.html",
      "WebSquare.cookie/WebSquare.cookie.html","WebSquare.date/WebSquare.date.html",
      "WebSquare.json/WebSquare.json.html","WebSquare.layer/WebSquare.layer.html",
      "WebSquare.localStorage/WebSquare.localStorage.html",
      "WebSquare.logger/WebSquare.logger.html",
      "WebSquare.ModelUtil/WebSquare.ModelUtil.html",
      "WebSquare.net/WebSquare.net.html","WebSquare.session/WebSquare.session.html",
      "WebSquare.style/WebSquare.style.html","WebSquare.util/WebSquare.util.html",
      "WebSquare.xml/WebSquare.xml.html",
      "WebSquare.uiplugin.aliasDataList/WebSquare.uiplugin.aliasDataList.html",
      "WebSquare.uiplugin.aliasDataMap/WebSquare.uiplugin.aliasDataMap.html",
      "WebSquare.uiplugin.aliasLinkedDataList/WebSquare.uiplugin.aliasLinkedDataList.html",
      "WebSquare.uiplugin.dataCollection/WebSquare.uiplugin.dataCollection.html",
      "WebSquare.uiplugin.dataList/WebSquare.uiplugin.dataList.html",
      "WebSquare.uiplugin.dataList.column/WebSquare.uiplugin.dataList.column.html",
      "WebSquare.uiplugin.dataMap/WebSquare.uiplugin.dataMap.html",
      "WebSquare.uiplugin.dataMap.key/WebSquare.uiplugin.dataMap.key.html",
      "WebSquare.uiplugin.linkedDataList/WebSquare.uiplugin.linkedDataList.html",
      "WebSquare.uiplugin.accordion/WebSquare.uiplugin.accordion.html",
      "WebSquare.uiplugin.anchor/WebSquare.uiplugin.anchor.html",
      "WebSquare.uiplugin.article/WebSquare.uiplugin.article.html",
      "WebSquare.uiplugin.aside/WebSquare.uiplugin.aside.html",
      "WebSquare.uiplugin.audio/WebSquare.uiplugin.audio.html",
      "WebSquare.uiplugin.autoComplete/WebSquare.uiplugin.autoComplete.html",
      "WebSquare.uiplugin.body/WebSquare.uiplugin.body.html",
      "WebSquare.uiplugin.button/WebSquare.uiplugin.button.html",
      "WebSquare.uiplugin.calendar/WebSquare.uiplugin.calendar.html",
      "WebSquare.uiplugin.canvas/WebSquare.uiplugin.canvas.html",
      "WebSquare.uiplugin.checkbox/WebSquare.uiplugin.checkbox.html",
      "WebSquare.uiplugin.checkcombobox/WebSquare.uiplugin.checkcombobox.html",
      "WebSquare.uiplugin.datePicker/WebSquare.uiplugin.datePicker.html",
      "WebSquare.uiplugin.editor/WebSquare.uiplugin.editor.html",
      "WebSquare.uiplugin.fliptoggle/WebSquare.uiplugin.fliptoggle.html",
      "WebSquare.uiplugin.floatingLayer/WebSquare.uiplugin.floatingLayer.html",
      "WebSquare.uiplugin.footer/WebSquare.uiplugin.footer.html",
      "WebSquare.uiplugin.fusionchart/WebSquare.uiplugin.fusionchart.html",
      "WebSquare.uiplugin.fwBulletChart/WebSquare.uiplugin.fwBulletChart.html",
      "WebSquare.uiplugin.fwFunnelChart/WebSquare.uiplugin.fwFunnelChart.html",
      "WebSquare.uiplugin.fwGanttChart/WebSquare.uiplugin.fwGanttChart.html",
      "WebSquare.uiplugin.fwGaugeChart/WebSquare.uiplugin.fwGaugeChart.html",
      "WebSquare.uiplugin.fwPyramidChart/WebSquare.uiplugin.fwPyramidChart.html",
      "WebSquare.uiplugin.fwRealtimeChart/WebSquare.uiplugin.fwRealtimeChart.html",
      "WebSquare.uiplugin.fwSparkChart/WebSquare.uiplugin.fwSparkChart.html",
      "WebSquare.uiplugin.generator/WebSquare.uiplugin.generator.html",
      "WebSquare.uiplugin.gridLayout/WebSquare.uiplugin.gridLayout.html",
      "WebSquare.uiplugin.gridView/WebSquare.uiplugin.gridView.html",
      "WebSquare.uiplugin.gridView.header/WebSquare.uiplugin.gridView.header.html",
      "WebSquare.uiplugin.gridView.gBody/WebSquare.uiplugin.gridView.gBody.html",
      "WebSquare.uiplugin.gridView.subTotal/WebSquare.uiplugin.gridView.subTotal.html",
      "WebSquare.uiplugin.gridView.footer/WebSquare.uiplugin.gridView.footer.html",
      "WebSquare.uiplugin.gridView.column/WebSquare.uiplugin.gridView.column.html",
      "WebSquare.uiplugin.group/WebSquare.uiplugin.group.html",
      "WebSquare.uiplugin.header/WebSquare.uiplugin.header.html",
      "WebSquare.uiplugin.iframe/WebSquare.uiplugin.iframe.html",
      "WebSquare.uiplugin.image/WebSquare.uiplugin.image.html",
      "WebSquare.uiplugin.input/WebSquare.uiplugin.input.html",
      "WebSquare.uiplugin.inputCalendar/WebSquare.uiplugin.inputCalendar.html",
      "WebSquare.uiplugin.mapchart/WebSquare.uiplugin.mapchart.html",
      "WebSquare.uiplugin.multiselect/WebSquare.uiplugin.multiselect.html",
      "WebSquare.uiplugin.multiupload/WebSquare.uiplugin.multiupload.html",
      "WebSquare.uiplugin.nav/WebSquare.uiplugin.nav.html",
      "WebSquare.uiplugin.output/WebSquare.uiplugin.output.html",
      "WebSquare.uiplugin.pageControl/WebSquare.uiplugin.pageControl.html",
      "WebSquare.uiplugin.pageInherit/WebSquare.uiplugin.pageInherit.html",
      "WebSquare.uiplugin.pageList/WebSquare.uiplugin.pageList.html",
      "WebSquare.uiplugin.pivot/WebSquare.uiplugin.pivot.html",
      "WebSquare.uiplugin.progressbar/WebSquare.uiplugin.progressbar.html",
      "WebSquare.uiplugin.radio/WebSquare.uiplugin.radio.html",
      "WebSquare.uiplugin.repeat/WebSquare.uiplugin.repeat.html",
      "WebSquare.uiplugin.roundRectangle/WebSquare.uiplugin.roundRectangle.html",
      "WebSquare.uiplugin.scheduleCalendar/WebSquare.uiplugin.scheduleCalendar.html",
      "WebSquare.uiplugin.scrollView/WebSquare.uiplugin.scrollView.html",
      "WebSquare.uiplugin.searchbox/WebSquare.uiplugin.searchbox.html",
      "WebSquare.uiplugin.secret/WebSquare.uiplugin.secret.html",
      "WebSquare.uiplugin.section/WebSquare.uiplugin.section.html",
      "WebSquare.uiplugin.selectbox/WebSquare.uiplugin.selectbox.html",
      "WebSquare.uiplugin.slideHide/WebSquare.uiplugin.slideHide.html",
      "WebSquare.uiplugin.slider/WebSquare.uiplugin.slider.html",
      "WebSquare.uiplugin.span/WebSquare.uiplugin.span.html",
      "WebSquare.uiplugin.spinner/WebSquare.uiplugin.spinner.html",
      "WebSquare.uiplugin.Submission/WebSquare.uiplugin.Submission.html",
      "WebSquare.uiplugin.switch/WebSquare.uiplugin.switch.html",
      "WebSquare.uiplugin.tabControl/WebSquare.uiplugin.tabControl.html",
      "WebSquare.uiplugin.tableLayout/WebSquare.uiplugin.tableLayout.html",
      "WebSquare.uiplugin.tableLayout.td/WebSquare.uiplugin.tableLayout.td.html",
      "WebSquare.uiplugin.tableLayout.th/WebSquare.uiplugin.tableLayout.th.html",
      "WebSquare.uiplugin.tableLayout.tr/WebSquare.uiplugin.tableLayout.tr.html",
      "WebSquare.uiplugin.tag/WebSquare.uiplugin.tag.html",
      "WebSquare.uiplugin.textarea/WebSquare.uiplugin.textarea.html",
      "WebSquare.uiplugin.textbox/WebSquare.uiplugin.textbox.html",
      "WebSquare.uiplugin.treeview/WebSquare.uiplugin.treeview.html",
      "WebSquare.uiplugin.trigger/WebSquare.uiplugin.trigger.html",
      "WebSquare.uiplugin.upload/WebSquare.uiplugin.upload.html",
      "WebSquare.uiplugin.video/WebSquare.uiplugin.video.html",
      "WebSquare.uiplugin.wframe/WebSquare.uiplugin.wframe.html",
      "WebSquare.uiplugin.widgetContainer/WebSquare.uiplugin.widgetContainer.html",
      "WebSquare.uiplugin.windowContainer/WebSquare.uiplugin.windowContainer.html",
      "WebSquare.uiplugin.Workflow/WebSquare.uiplugin.Workflow.html",
      "WebSquare.uiplugin.xhtml/WebSquare.uiplugin.xhtml.html",
      "WebSquare.uiplugin.xsl/WebSquare.uiplugin.xsl.html",
    ],
    output: "ws5_sp5_api_data.json",
  },
  {
    label: "ws5_sp4_api",
    // SP4 base URL — 버전 번호를 먼저 확인 후 수정 필요할 수 있음
    base: "https://docs.inswave.com/support/api/ws5_sp4",
    pages: [], // SP4는 동적으로 확인
    output: "ws5_sp4_api_data.json",
  },
];

async function crawlPages(config) {
  console.log(`\n=== [${config.label}] 크롤링 시작 ===`);
  const allData = [];

  for (let i = 0; i < config.pages.length; i++) {
    const pagePath = config.pages[i];
    const componentName = pagePath.split("/")[0];
    const url = `${config.base}/${pagePath}`;
    console.log(`  [${i + 1}/${config.pages.length}] ${componentName}`);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`    HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const text = htmlToText(html);
      allData.push({
        source: config.label,
        component: componentName,
        title: `${config.label} - ${componentName}`,
        content: text,
        htmlContent: html,
        url: url,
      });
    } catch (err) {
      console.log(`    에러: ${err.message}`);
    }
    await delay(200);
  }

  const outPath = path.join(__dirname, "..", "data", "api", config.output);
  fs.writeFileSync(outPath, JSON.stringify(allData, null, 2), "utf-8");
  console.log(`[${config.label}] 완료! ${allData.length}건 → ${outPath}`);
  return allData.length;
}

(async () => {
  // SP5
  await crawlPages(CONFIGS[0]);

  // SP4 — 먼저 버전 확인
  console.log("\n=== SP4 버전 확인 중... ===");
  try {
    const res = await fetch(
      "https://docs.inswave.com/websquare/websquare.html?w2xPath=/support/api/ws5_sp4/api.xml"
    );
    const html = await res.text();
    // iframe src에서 버전 경로 추출
    const match = html.match(/ws5_sp4\/([^/]+)\/index\.html/);
    if (match) {
      console.log(`  SP4 버전: ${match[1]}`);
      CONFIGS[1].base = `https://docs.inswave.com/support/api/ws5_sp4/${match[1]}`;
    }
  } catch (e) {
    console.log("  SP4 버전 확인 실패, 수동 탐색 시도");
  }

  // SP4 left menu 가져오기
  try {
    const leftRes = await fetch(`${CONFIGS[1].base}/api_left.html`);
    const leftHtml = await leftRes.text();
    const hrefRegex = /href="([^"]+\.html)"/g;
    let m;
    while ((m = hrefRegex.exec(leftHtml)) !== null) {
      CONFIGS[1].pages.push(m[1]);
    }
    console.log(`  SP4 페이지 ${CONFIGS[1].pages.length}개 발견`);
    await crawlPages(CONFIGS[1]);
  } catch (e) {
    console.log(`  SP4 메뉴 로드 실패: ${e.message}`);
  }

  console.log("\n========================================");
  console.log("SP5/SP4 API 문서 크롤링 완료!");
  console.log("========================================");
})();
