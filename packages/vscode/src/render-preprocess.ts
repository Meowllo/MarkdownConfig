/**
 * 渲染预处理：把 .mc 源文本转成适合 markdown 渲染的文本（仅影响显示，源文件不变）
 *
 * - `<!--@var NAME-->值<!--@/var-->` → `<span class="mc-value" title="NAME">值</span>`（蓝色 + hover 变量名）
 * - `<!--@table NAME-->` → `<div class="mc-table-tag">配置表：NAME</div>`（块级，不破坏表格渲染）
 * - `<!--@/table-->` → 删除
 * - 块 id（`^id`）只在对应块的最后一行隐藏
 * - 围栏代码块（``` / ~~~）内一律不做处理
 */

import { parse } from "markdownconfig/dist/scanner.js";

const FENCE_RE = /^\s*(```|~~~)/;
// 名称可省略：`<!--@array -->` 是无名嵌套数组，标题回落为「数组」
const VALUE_OPEN_RE = /<!--@(var|array|range)(?:\s+([A-Za-z_][\w.-]*))?(?:\s+type=[A-Za-z]+)?\s*-->/;
const VALUE_CLOSE_RE = /<!--@\/(var|array|range)\s*-->/;
const TABLE_OPEN_RE = /<!--@table\s+([A-Za-z_][\w.-]*)-->/;
const TABLE_CLOSE_RE = /<!--@\/table-->/;

export function preprocessForRender(source: string): string {
  // 收集携带块 id 的行（id 位于该块最后一行行尾）
  const res = parse(source);
  const idLines = new Set<number>();
  for (const b of res.blocks) {
    if (b.id) idLines.add(b.lines[1]);
  }

  const lines = source.split("\n");
  const out: string[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(FENCE_RE);
    if (fm) {
      fence = fence ? null : fm[1];
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }

    let t = line;
    // 隐藏块 id（仅该块最后一行）
    if (idLines.has(i + 1)) {
      t = t.replace(/\s+\^[A-Za-z_][\w.-]*\s*$/, "");
    }
    // config 标记 → 高亮 span / 表格标签（无名嵌套数组的标题回落为「数组」）
    t = t.replace(
      VALUE_OPEN_RE,
      (_m: string, _kind: string, name?: string) =>
        `<span class="mc-value" title="${name ?? "数组"}">`,
    );
    t = t.replace(VALUE_CLOSE_RE, "</span>");
    // 表格标签后跟空行：避免 markdown-it 把紧随的表格行吞进 HTML 块
    t = t.replace(
      TABLE_OPEN_RE,
      '<div class="mc-table-tag" title="配置表 $1">配置表：$1</div>\n',
    );
    t = t.replace(TABLE_CLOSE_RE, "");
    out.push(t);
  }
  return out.join("\n");
}
