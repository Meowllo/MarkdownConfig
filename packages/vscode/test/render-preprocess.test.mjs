/** 渲染预处理单测：标记 → span/标签、^id 隐藏、围栏保护 */

import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { preprocessForRender } from "../out/render-preprocess.js";

const md = new MarkdownIt({ html: true, linkify: true });

test("preprocessForRender：@var 标记 → 蓝色 span + 变量名 title", () => {
  const out = preprocessForRender("超时：<!--@var TIMEOUT_MS-->3000<!--@/var-->毫秒\n");
  assert.ok(out.includes('<span class="mc-value" title="TIMEOUT_MS">3000</span>'));
  assert.ok(!out.includes("<!--@var"));
  assert.ok(!out.includes("<!--@/var-->"));
});

test("preprocessForRender：@table 标记 → 块级标签，表格行保留", () => {
  const src = "<!--@table METRICS-->\n| 指标 | 阈值 |\n| --- | --- |\n| cpu | 80 |\n<!--@/table-->\n";
  const out = preprocessForRender(src);
  assert.ok(out.includes('class="mc-table-tag"'));
  assert.ok(out.includes("配置表：METRICS"));
  assert.ok(out.includes("| cpu | 80 |"));
  assert.ok(!out.includes("<!--@table"));
});

test("preprocessForRender：markdown-it 渲染后表格仍为 <table>（标签不吞表）", () => {
  const src = "<!--@table METRICS-->\n| 指标 | 阈值 |\n| --- | --- |\n| cpu | 80 |\n<!--@/table-->\n";
  const html = md.render(preprocessForRender(src));
  assert.ok(html.includes("<table>"), "表格应渲染为 <table>");
  assert.ok(html.includes("mc-table-tag"));
  assert.ok(html.includes("<td>cpu</td>"));
});

test("preprocessForRender：^id 仅在带 id 的块行隐藏", () => {
  const src = "# 顶部 ^top\n\n价格 2^ 元\n";
  const out = preprocessForRender(src);
  assert.ok(!out.includes("^top"), "块 id 应隐藏");
  assert.ok(out.includes("2^ 元"), "普通文字中的 ^ 不应被误删");
});

test("preprocessForRender：围栏代码块内不处理", () => {
  const src = "```\n<!--@var X-->1<!--@/var-->\n^id\n```\n";
  const out = preprocessForRender(src);
  assert.ok(out.includes("<!--@var X-->1<!--@/var-->"));
  assert.ok(out.includes("^id"));
});

test("preprocessForRender：多行值（type=text）不破坏", () => {
  const src = "y：<!--@var B type=text-->a\nb<!--@/var-->\n";
  const out = preprocessForRender(src);
  assert.ok(out.includes('<span class="mc-value" title="B">a'));
  assert.ok(out.includes("b</span>"));
});

test("preprocessForRender：@range 标记 → 蓝色 span + 变量名", () => {
  const out = preprocessForRender("超时：<!--@range TimeoutRange-->1~5<!--@/range-->\n");
  assert.ok(out.includes('<span class="mc-value" title="TimeoutRange">1~5</span>'));
  assert.ok(!out.includes("<!--@range"));
  assert.ok(!out.includes("<!--@/range-->"));
});

test("preprocessForRender：@comment 标记隐藏、评论文本可见", () => {
  const src = "## 评论\n\n<!--@comment target=server.port-->端口应为 9090<!--@/comment-->\n";
  const out = preprocessForRender(src);
  assert.ok(out.includes('<span class="mc-comment" title="评论 → server.port">端口应为 9090</span>'));
  assert.ok(!out.includes("<!--@comment"));
  assert.ok(!out.includes("<!--@/comment-->"));
  // 渲染后评论文本对人类可见
  const html = md.render(out);
  assert.ok(html.includes("端口应为 9090"));
});
