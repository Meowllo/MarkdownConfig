/** 纯逻辑模块（不依赖 vscode API，可独立单测） */

import { parse, tokenize } from "markdownconfig";

export interface HighlightRange {
  start: number;
  end: number;
  kind: "value" | "marker" | "comment";
}

// 名称可省略：`<!--@array -->` 是合法的无名嵌套数组；@comment 带 target 属性
const MARKER_RE =
  /<!--@(?:comment(?:\s+target=[^>\n]+?)?|var\s+[A-Za-z_][\w.-]*(?:\s+type=[A-Za-z]+)?|array(?:\s+[A-Za-z_][\w.-]*)?(?:\s+type=[A-Za-z]+)?|range\s+[A-Za-z_][\w.-]*|table\s+[A-Za-z_][\w.-]*|\/var|\/array|\/range|\/table|\/comment)\s*-->/g;

/** 计算高亮区间：值/评论正文 → 前景色，标记本身 → 灰色 */
export function computeHighlights(source: string): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  const res = parse(source);
  for (const e of res.entries) {
    if (e.kind === "var" || e.kind === "array" || e.kind === "range") {
      ranges.push({ start: e.valueStart, end: e.valueEnd, kind: "value" });
    }
  }
  // 评论正文（标记之间）单独着色
  const tokens = tokenize(source);
  let open: { end: number } | null = null;
  for (const t of tokens) {
    if (t.kind !== "comment") continue;
    if (t.open) open = { end: t.end };
    else if (open) {
      ranges.push({ start: open.end, end: t.start, kind: "comment" });
      open = null;
    }
  }
  let m: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(source)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length, kind: "marker" });
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  return ranges;
}

export interface HoverInfo {
  name: string;
  type: string;
  value: string;
  line: number;
}

/** 光标处 hover：命中 @var 值/标记、@table 标记或评论时返回信息 */
export function hoverAt(source: string, offset: number): HoverInfo | null {
  const res = parse(source);
  for (const e of res.entries) {
    if (
      (e.kind === "var" || e.kind === "array" || e.kind === "range") &&
      offset >= e.valueStart &&
      offset <= e.valueEnd
    ) {
      return { name: e.name, type: e.type, value: JSON.stringify(e.value), line: e.line };
    }
    if (e.kind === "table") {
      const openMarker = `<!--@table ${e.name}-->`;
      const idx = source.indexOf(openMarker);
      if (idx >= 0 && offset >= idx && offset <= idx + openMarker.length) {
        return { name: e.name, type: "table", value: JSON.stringify(e.data), line: e.line };
      }
    }
  }
  for (const c of res.comments) {
    if (offset >= c.start && offset <= c.end) {
      return { name: c.target, type: "comment", value: c.text, line: c.line };
    }
  }
  const varOpen = /<!--@(var|array|range)\s+([A-Za-z_][\w.-]*)(?:\s+type=[A-Za-z]+)?\s*-->/g;
  let m: RegExpExecArray | null;
  varOpen.lastIndex = 0;
  while ((m = varOpen.exec(source)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      const name = m[2];
      const entry = res.entries.find(
        (x) =>
          (x.kind === "var" || x.kind === "array" || x.kind === "range") && x.name === name,
      );
      if (entry && (entry.kind === "var" || entry.kind === "array" || entry.kind === "range")) {
        return { name: entry.name, type: entry.type, value: JSON.stringify(entry.value), line: entry.line };
      }
    }
  }
  return null;
}

export function isMcFile(filePath: string): boolean {
  return /\.mc$/i.test(filePath);
}

// ---- 选中文本 → 评论锚定 ----

export interface BlockShape {
  id?: string;
  type: string;
  lines: [number, number];
}

export interface SelectionTarget {
  /** 可直接使用的锚定目标（变量名 / 表格名 / 块 id）；null 表示需用户输入或自动分配 */
  target: string | null;
  /** 命中的块（用于自动分配 id） */
  block?: BlockShape;
  /** 是否需要自动分配块 id 后再锚定 */
  autoAssign: boolean;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  const max = Math.min(offset, source.length);
  for (let i = 0; i < max; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function overlaps(a: number, b: number, s: number, e: number): boolean {
  return a < e && b > s;
}

/**
 * 根据选中范围决定评论锚定目标：
 * 1) 命中 @var 值 → 变量名
 * 2) 命中带 config 名的表格 → 表格名（表格不自动分配 id，避免破坏标记行）
 * 3) 命中已有 id 的块 → 块 id
 * 4) 命中无 id 的普通段落/标题 → autoAssign=true（可自动生成 ^b-N）
 */
export function findTargetForSelection(
  source: string,
  start: number,
  end: number,
): SelectionTarget {
  const res = parse(source);
  const selLineStart = lineAt(source, start);
  const selLineEnd = lineAt(source, end);

  for (const e of res.entries) {
    if (
      (e.kind === "var" || e.kind === "array" || e.kind === "range") &&
      overlaps(e.valueStart, e.valueEnd, start, end)
    ) {
      return { target: e.name, autoAssign: false };
    }
  }

  const block =
    res.blocks.find((b) => selLineStart >= b.lines[0] && selLineEnd <= b.lines[1]) ??
    res.blocks.find((b) => selLineStart >= b.lines[0] && selLineStart <= b.lines[1]);
  if (block) {
    const tableEntry = res.entries.find(
      (e) => e.kind === "table" && e.line >= block.lines[0] - 1 && e.line <= block.lines[1],
    );
    if (tableEntry) {
      if (tableEntry.kind === "table" && tableEntry.name) {
        return { target: tableEntry.name, block, autoAssign: false };
      }
      return { target: null, block, autoAssign: false };
    }
    if (block.id) return { target: block.id, block, autoAssign: false };
    return { target: null, block, autoAssign: true };
  }
  return { target: null, autoAssign: false };
}

/** 为块自动分配唯一 id（^b-N），追加到块最后一行行尾 */
export function assignBlockId(source: string, block: BlockShape): { source: string; id: string } {
  const existing = new Set<string>();
  const res = parse(source);
  for (const b of res.blocks) {
    if (b.id) existing.add(b.id);
  }
  let n = 1;
  let id = `b-${n}`;
  while (existing.has(id)) {
    n += 1;
    id = `b-${n}`;
  }
  const lines = source.split("\n");
  const idx = block.lines[1] - 1;
  if (idx < 0 || idx >= lines.length) throw new Error(`块行号越界: ${block.lines[1]}`);
  lines[idx] = lines[idx].replace(/[\r \t]*$/, "") + ` ^${id}`;
  return { source: lines.join("\n"), id };
}
