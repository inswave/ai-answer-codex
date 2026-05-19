const fs = require("fs");
const path = require("path");

const BASE_URL =
  "https://docs.inswave.com/support/api/ws5_ai/6.0_0.1443A.20260127.165210";

const PAGES = [
  "$p.html","$p.data.html","$p.local.html",
  "WebSquare.ModelUtil.html","WebSquare.bigDecimal.html","WebSquare.collection.html",
  "WebSquare.cookie.html","WebSquare.date.html","WebSquare.json.html",
  "WebSquare.layer.html","WebSquare.localStorage.html","WebSquare.logger.html",
  "WebSquare.net.html","WebSquare.session.html","WebSquare.style.html",
  "WebSquare.util.html","WebSquare.xml.html",
  "WebSquare.uiplugin.dataList.html","WebSquare.uiplugin.dataList.column.html",
  "WebSquare.uiplugin.dataMap.html","WebSquare.uiplugin.dataMap.key.html",
  "WebSquare.uiplugin.linkedDataList.html","WebSquare.uiplugin.aliasDataList.html",
  "WebSquare.uiplugin.aliasDataMap.html","WebSquare.uiplugin.aliasLinkedDataList.html",
  "WebSquare.uiplugin.Submission.html","WebSquare.uiplugin.Workflow.html",
  "WebSquare.uiplugin.accordion.html","WebSquare.uiplugin.anchor.html",
  "WebSquare.uiplugin.article.html","WebSquare.uiplugin.aside.html",
  "WebSquare.uiplugin.audio.html","WebSquare.uiplugin.autoComplete.html",
  "WebSquare.uiplugin.body.html","WebSquare.uiplugin.button.html",
  "WebSquare.uiplugin.calendar.html","WebSquare.uiplugin.canvas.html",
  "WebSquare.uiplugin.checkbox.html","WebSquare.uiplugin.checkcombobox.html",
  "WebSquare.uiplugin.datePicker.html","WebSquare.uiplugin.editor.html",
  "WebSquare.uiplugin.fliptoggle.html","WebSquare.uiplugin.floatingLayer.html",
  "WebSquare.uiplugin.footer.html","WebSquare.uiplugin.fusionchart.html",
  "WebSquare.uiplugin.fwBulletChart.html","WebSquare.uiplugin.fwFunnelChart.html",
  "WebSquare.uiplugin.fwGanttChart.html","WebSquare.uiplugin.fwGaugeChart.html",
  "WebSquare.uiplugin.fwPyramidChart.html","WebSquare.uiplugin.fwRealtimeChart.html",
  "WebSquare.uiplugin.fwSparkChart.html","WebSquare.uiplugin.generator.html",
  "WebSquare.uiplugin.gridLayout.html","WebSquare.uiplugin.gridView.html",
  "WebSquare.uiplugin.gridView.header.html","WebSquare.uiplugin.gridView.gBody.html",
  "WebSquare.uiplugin.gridView.subTotal.html","WebSquare.uiplugin.gridView.footer.html",
  "WebSquare.uiplugin.gridView.column.html","WebSquare.uiplugin.group.html",
  "WebSquare.uiplugin.header.html","WebSquare.uiplugin.iframe.html",
  "WebSquare.uiplugin.image.html","WebSquare.uiplugin.input.html",
  "WebSquare.uiplugin.inputCalendar.html","WebSquare.uiplugin.mapchart.html",
  "WebSquare.uiplugin.multiselect.html","WebSquare.uiplugin.multiupload.html",
  "WebSquare.uiplugin.nav.html","WebSquare.uiplugin.output.html",
  "WebSquare.uiplugin.pageControl.html","WebSquare.uiplugin.pageFrame.html",
  "WebSquare.uiplugin.pageInherit.html","WebSquare.uiplugin.pageList.html",
  "WebSquare.uiplugin.panelContainer.html","WebSquare.uiplugin.pivot.html",
  "WebSquare.uiplugin.progressbar.html","WebSquare.uiplugin.radio.html",
  "WebSquare.uiplugin.repeat.html","WebSquare.uiplugin.roundRectangle.html",
  "WebSquare.uiplugin.scheduleCalendar.html","WebSquare.uiplugin.scrollView.html",
  "WebSquare.uiplugin.searchbox.html","WebSquare.uiplugin.secret.html",
  "WebSquare.uiplugin.selectbox.html","WebSquare.uiplugin.section.html",
  "WebSquare.uiplugin.slideHide.html","WebSquare.uiplugin.slider.html",
  "WebSquare.uiplugin.span.html","WebSquare.uiplugin.spinner.html",
  "WebSquare.uiplugin.switch.html","WebSquare.uiplugin.tabControl.html",
  "WebSquare.uiplugin.tableLayout.html","WebSquare.uiplugin.tableLayout.td.html",
  "WebSquare.uiplugin.tableLayout.th.html","WebSquare.uiplugin.tableLayout.tr.html",
  "WebSquare.uiplugin.tag.html","WebSquare.uiplugin.textarea.html",
  "WebSquare.uiplugin.textbox.html","WebSquare.uiplugin.treeview.html",
  "WebSquare.uiplugin.trigger.html","WebSquare.uiplugin.upload.html",
  "WebSquare.uiplugin.video.html","WebSquare.uiplugin.wframe.html",
  "WebSquare.uiplugin.widgetContainer.html","WebSquare.uiplugin.windowContainer.html",
  "WebSquare.uiplugin.xhtml.html",
];

const OUTPUT_FILE = path.join(__dirname, "..", "data", "api", "ws5_ai_api_data.json");

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// HTML에서 텍스트 추출 (간단 버전)
function htmlToText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

(async () => {
  const allData = [];

  for (let i = 0; i < PAGES.length; i++) {
    const pageName = PAGES[i];
    const url = `${BASE_URL}/html/${pageName}`;
    const componentName = pageName.replace(".html", "");
    console.log(`[${i + 1}/${PAGES.length}] ${componentName} 크롤링 중...`);

    try {
      const res = await fetch(url);
      const html = await res.text();
      const text = htmlToText(html);

      allData.push({
        source: "ws5_ai_api",
        component: componentName,
        title: `WebSquare AI API - ${componentName}`,
        content: text,
        htmlContent: html,
        url: url,
      });
    } catch (err) {
      console.log(`  에러: ${err.message}`);
      allData.push({
        source: "ws5_ai_api",
        component: componentName,
        title: `WebSquare AI API - ${componentName}`,
        content: "",
        htmlContent: "",
        url: url,
        error: err.message,
      });
    }

    // 중간 저장
    if ((i + 1) % 30 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2), "utf-8");
      console.log(`  -- 중간 저장 (${allData.length}건) --`);
    }

    await delay(300);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allData, null, 2), "utf-8");
  console.log(`\n========================================`);
  console.log(`크롤링 완료! 총 ${allData.length}건`);
  console.log(`저장: ${OUTPUT_FILE}`);
  console.log(`========================================`);
})();
