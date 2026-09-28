/** 纯逻辑模块（不依赖 vscode API，可独立单测） */

import { parse } from "markdownconfig";

export interface HighlightRange {
  start: number;
  end: number;
  kind: "value" | "marker";
}

// 名称可省略：`<!--@array -->` 是合法的无名嵌套数组
const MARKER_RE =
  /<!--@(?:var\s+[A-Za-z_][\w.-]*(?:\s+type=[A-Za-z]+)?|array(?:\s+[A-Za-z_][\w.-]*)?(?:\s+type=[A-Za-z]+)?|range\s+[A-Za-z_][\w.-]*|table\s+[A-Za-z_][\w.-]*|\/var|\/array|\/range|\/table)-->/g;

/** 计算高亮区间：@var/@array/@range 值 → value（蓝），标记本身 → marker（灰） */
export function computeHighlights(source: string): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  const res = parse(source);
  for (const e of res.entries) {
    if (e.kind === "var" || e.kind === "array" || e.kind === "range") {
      ranges.push({ start: e.valueStart, end: e.valueEnd, kind: "value" });
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

/** 光标处 hover：命中 @var 值/标记或 @table 标记时返回变量信息 */
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

/** 两个配置对象之间的路径级差异（如 ["a.b"]） */
export function diffPaths(
  prev: Record<string, unknown> | null,
  cur: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, path: string): void => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (
      a !== null &&
      b !== null &&
      typeof a === "object" &&
      typeof b === "object" &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        walk(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          path ? `${path}.${k}` : k,
        );
      }
    } else {
      out.push(path);
    }
  };
  walk(prev ?? {}, cur, "");
  return out;
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

// ---- 行级文本 diff（LCS，用于非 config 文本留痕）----

export interface LineOp {
  kind: "same" | "del" | "add";
  line: number;
  text: string;
}

const MAX_LCS_CELLS = 4_000_000;

/** 行级 LCS diff；超大文件（n*m 超限）回退为单条"整体有改动"标记 */
export function diffLines(prev: string, cur: string): LineOp[] {
  const al = prev.split("\n");
  const bl = cur.split("\n");
  const n = al.length;
  const m = bl.length;
  if (n * m > MAX_LCS_CELLS) {
    return [{ kind: "add", line: 1, text: "__TOO_LARGE__" }];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && al[i] === bl[j]) {
      ops.push({ kind: "same", line: i + 1, text: al[i] });
      i++;
      j++;
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      ops.push({ kind: "add", line: j + 1, text: bl[j] });
      j++;
    } else {
      ops.push({ kind: "del", line: i + 1, text: al[i] });
      i++;
    }
  }
  return ops;
}

function rangeLabel(lines: number[]): string {
  const first = lines[0];
  if (lines.length <= 1) return `L${first}`;
  return `L${first}-${lines[lines.length - 1]}`;
}

/** 把行级 diff 压缩为人类可读的改动摘要（如 ["L3 修改", "L8 新增"]） */
export function summarizeTextDiff(prev: string, cur: string): string[] {
  const ops = diffLines(prev, cur);
  if (ops.length === 1 && ops[0].text === "__TOO_LARGE__") {
    return ["文本有改动（文件过大，仅简略记录）"];
  }
  const out: string[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].kind === "same") {
      i++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (i < ops.length && ops[i].kind !== "same") {
      if (ops[i].kind === "del") dels.push(ops[i].line);
      else adds.push(ops[i].line);
      i++;
    }
    if (dels.length > 0 && adds.length > 0) {
      out.push(`${rangeLabel(dels)} 修改`);
    } else if (dels.length > 0) {
      out.push(`${rangeLabel(dels)} 删除`);
    } else {
      out.push(`${rangeLabel(adds)} 新增`);
    }
  }
  return out.slice(0, 10);
}
