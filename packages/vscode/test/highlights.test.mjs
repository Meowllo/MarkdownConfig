/** 纯逻辑单测（node --test） */

import assert from "node:assert/strict";
import { test } from "node:test";
import { assignBlockId, computeHighlights, findTargetForSelection, hoverAt, isMcFile } from "../out/pure.js";

test("computeHighlights：值区间与标记区间", () => {
  const src = "超时：<!--@var TIMEOUT_MS-->3000<!--@/var-->毫秒\n";
  const ranges = computeHighlights(src);
  const values = ranges.filter((r) => r.kind === "value");
  assert.equal(values.length, 1);
  assert.equal(src.slice(values[0].start, values[0].end), "3000");
  const markers = ranges.filter((r) => r.kind === "marker");
  assert.ok(markers.length >= 2, "应有开始/结束标记");
});

test("computeHighlights：表格标记也被标出", () => {
  const src = "<!--@table T-->\n| a |\n| --- |\n| 1 |\n<!--@/table-->\n";
  const ranges = computeHighlights(src);
  const markers = ranges.filter((r) => r.kind === "marker");
  assert.ok(markers.some((r) => src.slice(r.start, r.end).includes("@table")));
});

test("hoverAt：值内返回变量信息，非标记处返回 null", () => {
  const src = "超时：<!--@var TIMEOUT_MS-->3000<!--@/var-->毫秒\n";
  const idx = src.indexOf("3000") + 1;
  const info = hoverAt(src, idx);
  assert.ok(info);
  assert.equal(info.name, "TIMEOUT_MS");
  assert.equal(info.value, "3000");
  assert.equal(info.type, "number");
  assert.equal(hoverAt(src, 0), null);
});

test("hoverAt：标记上也命中", () => {
  const src = "<!--@var X-->42<!--@/var-->\n";
  const idx = src.indexOf("<!--@var");
  const info = hoverAt(src, idx + 5);
  assert.ok(info);
  assert.equal(info.name, "X");
});

test("computeHighlights：评论正文单独着色，标记仍为 marker", () => {
  const src = "## 评论\n\n<!--@comment target=server.port-->端口应为 9090<!--@/comment-->\n";
  const ranges = computeHighlights(src);
  const comments = ranges.filter((r) => r.kind === "comment");
  assert.equal(comments.length, 1);
  assert.equal(src.slice(comments[0].start, comments[0].end), "端口应为 9090");
  const markers = ranges.filter((r) => r.kind === "marker");
  assert.ok(markers.some((r) => src.slice(r.start, r.end).includes("@comment")));
  assert.ok(markers.some((r) => src.slice(r.start, r.end).includes("@/comment")));
});

test("hoverAt：评论上返回 target 与文本", () => {
  const src = "<!--@comment target=server.port-->端口应为 9090<!--@/comment-->\n";
  const idx = src.indexOf("端口") + 1;
  const info = hoverAt(src, idx);
  assert.ok(info);
  assert.equal(info.name, "server.port");
  assert.equal(info.type, "comment");
  assert.equal(info.value, "端口应为 9090");
});

test("isMcFile：大小写不敏感", () => {
  assert.equal(isMcFile("a.mc"), true);
  assert.equal(isMcFile("a.MC"), true);
  assert.equal(isMcFile("a.md"), false);
  assert.equal(isMcFile("a.mcd"), false);
});

test("findTargetForSelection：选中变量值 → 变量名", () => {
  const src = "端口：<!--@var server.port-->8080<!--@/var-->\n";
  const start = src.indexOf("8080");
  const t = findTargetForSelection(src, start, start + 4);
  assert.equal(t.target, "server.port");
  assert.equal(t.autoAssign, false);
});

test("findTargetForSelection：选中表格内容 → 表格名", () => {
  const src =
    "<!--@table METRICS-->\n| 指标 | 阈值 |\n| --- | --- |\n| cpu | 80 |\n<!--@/table-->\n";
  const start = src.indexOf("cpu");
  const t = findTargetForSelection(src, start, start + 3);
  assert.equal(t.target, "METRICS");
});

test("findTargetForSelection：选中带 id 的标题 → 块 id", () => {
  const src = "# 顶部 ^top\n\n正文\n";
  const t = findTargetForSelection(src, 0, 5);
  assert.equal(t.target, "top");
});

test("findTargetForSelection：选中无 id 的段落 → autoAssign", () => {
  const src = "# 标题\n\n这是普通段落，没有块 id。\n";
  const start = src.indexOf("这是普通段落");
  const t = findTargetForSelection(src, start, start + 6);
  assert.equal(t.target, null);
  assert.equal(t.autoAssign, true);
  assert.ok(t.block);
});

test("assignBlockId：追加唯一 ^b-N 且不破坏内容", async () => {
  const src = "# 标题\n\n段落一\n段落二\n";
  const res = findTargetForSelection(src, src.indexOf("段落二"), src.indexOf("段落二") + 3);
  assert.ok(res.block);
  const { source, id } = assignBlockId(src, res.block);
  assert.equal(id, "b-1");
  assert.ok(source.includes("段落二 ^b-1"));
  // 已有 id 的块 → 直接锚定，不再分配
  const res2 = findTargetForSelection(source, source.indexOf("段落一"), source.indexOf("段落一") + 3);
  assert.equal(res2.target, "b-1");
  assert.equal(res2.autoAssign, false);
  // 解析回读：块 id 可见
  const { parse } = await import("../../core/dist/index.js");
  const parsed = parse(source);
  assert.ok(parsed.blocks.some((b) => b.id === "b-1"));
});

test("assignBlockId：多个独立块 id 递增唯一", () => {
  const src = "段落A\n\n段落B\n";
  const r1 = findTargetForSelection(src, 0, 3);
  const o1 = assignBlockId(src, r1.block);
  assert.equal(o1.id, "b-1");
  const r2 = findTargetForSelection(o1.source, o1.source.indexOf("段落B"), o1.source.indexOf("段落B") + 3);
  assert.equal(r2.autoAssign, true);
  const o2 = assignBlockId(o1.source, r2.block);
  assert.equal(o2.id, "b-2");
  assert.ok(o2.source.includes("段落A ^b-1"));
  assert.ok(o2.source.includes("段落B ^b-2"));
});

test("range：高亮 / hover / 选中锚定", () => {
  const src = "超时：<!--@range TimeoutRange-->1~5<!--@/range-->\n";
  const values = computeHighlights(src).filter((r) => r.kind === "value");
  assert.equal(values.length, 1);
  assert.equal(src.slice(values[0].start, values[0].end), "1~5");

  const idx = src.indexOf("1~5") + 1;
  const info = hoverAt(src, idx);
  assert.ok(info);
  assert.equal(info.name, "TimeoutRange");
  assert.equal(info.type, "range");
  assert.equal(info.value, JSON.stringify({ min: 1, max: 5 }));

  const t = findTargetForSelection(src, src.indexOf("1~5"), src.indexOf("1~5") + 3);
  assert.equal(t.target, "TimeoutRange");
});
