/** 扫描器：从 .mc 文本中提取配置条目（@var / @array / @table）、块结构与错误 */

import { scanMarkers } from "./markers";
import { parseTable } from "./table";
import type {
  ArrayEntry,
  Block,
  CommentEntry,
  ConfigEntry,
  McError,
  ParseResult,
  RangeEntry,
  VarEntry,
} from "./types";

const TABLE_OPEN_RE = /^\s*<!--@table\s+([A-Za-z_][\w.-]*)\s*-->\s*$/;
// 宽松识别 table 开始（名字可能非法），用于把"表名非法"直接指到病根（#2）
const TABLE_OPEN_LOOSE_RE = /^\s*<!--@table\s+(.+?)\s*-->\s*$/;
const TABLE_CLOSE_RE = /^\s*<!--@\/table-->\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+\^([A-Za-z0-9_-]+))?\s*$/;
const BLOCK_ID_RE = /^\^([A-Za-z0-9_-]+)\s*$/;
const TRAILING_ID_RE = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

interface TableRegion {
  name: string;
  openLine: number; // 0-based
  closeLine: number;
}

function fenceRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let inFence = false;
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      if (!inFence) {
        inFence = true;
        start = i;
      } else {
        inFence = false;
        ranges.push([start, i]);
      }
    }
  }
  return ranges;
}

function inSpan(line: number, spans: Array<[number, number]>): boolean {
  for (const [a, b] of spans) if (line >= a && line <= b) return true;
  return false;
}

function inFence(line: number, ranges: Array<[number, number]>): boolean {
  return inSpan(line, ranges);
}

export function parse(source: string): ParseResult {
  const errors: McError[] = [];
  const entries: ConfigEntry[] = [];
  const lines = source.split(/\r?\n/);
  const fences = fenceRanges(lines);
  const blocks = scanBlocks(source, fences);

  // 行号索引（字符偏移 → 1-based 行号）
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (off: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (lineStarts[m] <= off) lo = m;
      else hi = m - 1;
    }
    return lo + 1;
  };

  // ---- Pass 1：定位 @table 区域（独占一行的开闭标记），暂不解析 ----
  const tableRegions: TableRegion[] = [];
  const tableStack: Array<{ name: string; openLine: number; invalid?: boolean }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (inFence(i, fences)) continue;
    const mOpen = lines[i].match(TABLE_OPEN_RE);
    if (mOpen) {
      if (tableStack.length > 0) {
        errors.push({
          line: i + 1,
          message: `@table 嵌套：${mOpen[1]} 出现在 ${tableStack[tableStack.length - 1].name} 内部`,
        });
      }
      tableStack.push({ name: mOpen[1], openLine: i });
      continue;
    }
    // 非法表名（如非 ASCII）：直接指到病根，占位以正确消费关闭标记（#2）
    const mLoose = lines[i].match(TABLE_OPEN_LOOSE_RE);
    if (mLoose) {
      errors.push({
        line: i + 1,
        message: `@table 表名 '${mLoose[1].trim()}' 非法：NAME 必须匹配 [A-Za-z_][A-Za-z0-9_.]*`,
      });
      tableStack.push({ name: mLoose[1].trim(), openLine: i, invalid: true });
      continue;
    }
    if (TABLE_CLOSE_RE.test(lines[i])) {
      const top = tableStack.pop();
      if (!top) {
        errors.push({ line: i + 1, message: "@table 关闭标记缺少对应的开始标记" });
        continue;
      }
      if (!top.invalid) tableRegions.push({ name: top.name, openLine: top.openLine, closeLine: i });
    }
  }
  for (const t of tableStack) {
    if (!t.invalid) errors.push({ line: t.openLine + 1, message: `表格 ${t.name} 未闭合` });
  }

  const inTableRegion = (line: number): boolean => {
    for (const r of tableRegions) if (line >= r.openLine && line <= r.closeLine) return true;
    return false;
  };

  // ---- Pass 2：扫描顶层值块（跳过围栏与表格区域；表格内联标记归表格）----
  //   @array 可嵌套 @array，由 markers.scanMarkers 统一做配对与递归解析
  const { regions: valueRegions, comments: scannedComments, issues } = scanMarkers(source);
  const skipAt = (off: number): boolean => {
    const line = lineAt(off) - 1;
    return inFence(line, fences) || inTableRegion(line);
  };

  for (const iss of issues) {
    if (skipAt(iss.at)) continue;
    errors.push({ line: lineAt(iss.at), message: iss.message, hint: iss.hint });
  }

  const comments: CommentEntry[] = [];
  for (const c of scannedComments) {
    if (skipAt(c.start)) continue; // 围栏内忽略；表格内由单元格解析报错
    comments.push({ ...c, line: lineAt(c.start) });
  }

  const blockSpans: Array<[number, number]> = [];
  for (const r of valueRegions) {
    if (skipAt(r.start)) continue;
    const line = lineAt(r.start);
    if (!r.ident) {
      errors.push({
        line,
        message: "顶层 @array 必须命名（无名 @array 只能出现在另一个 @array 内部）",
      });
      continue;
    }
    blockSpans.push([line - 1, lineAt(r.end) - 1]);
    if (r.kind === "var") {
      const entry: VarEntry = {
        kind: "var",
        name: r.ident,
        declaredType: r.declared,
        type: r.type as VarEntry["type"],
        value: r.value,
        valueRaw: source.slice(r.contentStart, r.contentEnd).trim(),
        line,
        valueStart: r.contentStart,
        valueEnd: r.contentEnd,
      };
      entries.push(entry);
    } else if (r.kind === "array") {
      const entry: ArrayEntry = {
        kind: "array",
        name: r.ident,
        declaredType: r.declared,
        type: "array",
        value: r.value as unknown[],
        valueRaw: source.slice(r.contentStart, r.contentEnd).trim(),
        line,
        valueStart: r.contentStart,
        valueEnd: r.contentEnd,
      };
      entries.push(entry);
    } else {
      const entry: RangeEntry = {
        kind: "range",
        name: r.ident,
        declaredType: undefined,
        type: "range",
        value: r.value as { min: number; max: number },
        valueRaw: source.slice(r.contentStart, r.contentEnd).trim(),
        line,
        valueStart: r.contentStart,
        valueEnd: r.contentEnd,
      };
      entries.push(entry);
    }
  }

  // ---- Pass 3：表格互斥校验 + 解析（含单元格内联标记）----
  for (const t of tableRegions) {
    if (inSpan(t.openLine, blockSpans) || inSpan(t.closeLine, blockSpans)) {
      errors.push({
        line: t.openLine + 1,
        message: "@table 标记不允许出现在 @var/@array 值内",
      });
      continue;
    }
    const bodyStart = lineStarts[t.openLine + 1] ?? source.length;
    const body = source.slice(bodyStart, lineStarts[t.closeLine] ?? source.length);
    if (body.trim() === "") {
      errors.push({ line: t.openLine + 1, message: `表格 ${t.name} 内容为空` });
      continue;
    }
    const parsed = parseTable(body, bodyStart, t.openLine + 2);
    if (parsed.error) {
      errors.push({
        line: parsed.errorLine ?? t.openLine + 1,
        message: `表格 ${t.name}: ${parsed.error}`,
      });
      continue;
    }
    entries.push({
      kind: "table",
      name: t.name,
      idColumn: parsed.idColumn,
      data: parsed.data,
      positions: parsed.positions,
      line: t.openLine + 1,
      bodyLines: [parsed.headerLine, parsed.lastLine],
    });
  }

  // 错误按 行+消息 去重（#6：同一错误曾被打印两遍）
  const seen = new Set<string>();
  const dedupErrors = errors.filter((e) => {
    const k = `${e.line}:${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { entries, blocks, comments, errors: dedupErrors };
}

/** 文档中最后一个 ATX 标题的文本（fence 感知，已剥离 `^id`）；没有标题返回 null */
export function lastHeadingTitle(source: string): string | null {
  const lines = source.split(/\r?\n/);
  const fences = fenceRanges(lines);
  let title: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (inFence(i, fences)) continue;
    const h = lines[i].match(HEADING_RE);
    if (h) title = h[2].trim();
  }
  return title;
}

/** 轻量块扫描：标题 / 段落 / 表格，行尾 ^id 或独立 ^id 行（fence 感知） */
function scanBlocks(source: string, fences: Array<[number, number]>): Block[] {
  const lines = source.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "" || inFence(i, fences)) {
      i++;
      continue;
    }
    // @table 开闭标记独占行：跳过，使其后的 GFM 表能被识别为 table 块
    if (/^\s*<!--@table\b/.test(line) || /^\s*<!--@\/table-->/.test(line)) {
      i++;
      continue;
    }
    const h = line.match(HEADING_RE);
    if (h) {
      blocks.push({
        type: "heading",
        level: h[1].length,
        title: h[2],
        id: h[3],
        lines: [i + 1, i + 1],
      });
      i++;
      continue;
    }
    // 表格块：当前行以 | 开头，且下一行是分隔行
    if (line.trim().startsWith("|") && i + 1 < lines.length) {
      const sepCells = lines[i + 1]
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (sepCells.every((c) => /^:?-{1,}:?$/.test(c))) {
        let j = i + 2;
        while (j < lines.length && lines[j].trim().startsWith("|")) j++;
        let id: string | undefined;
        if (j < lines.length && !inFence(j, fences)) {
          const idm = lines[j].match(BLOCK_ID_RE);
          if (idm) {
            id = idm[1];
            j++;
          }
        }
        blocks.push({ type: "table", id, lines: [i + 1, j] });
        i = j;
        continue;
      }
    }
    // 段落块：连续非空、非 fence 行；^id 支持独立结尾行或行尾内联
    let j = i;
    while (j < lines.length && lines[j].trim() !== "" && !inFence(j, fences)) j++;
    let id: string | undefined;
    if (j > i) {
      const last = lines[j - 1];
      const idm = last.match(BLOCK_ID_RE) ?? last.match(TRAILING_ID_RE);
      if (idm) id = idm[1];
    }
    blocks.push({ type: "paragraph", id, lines: [i + 1, j] });
    i = j;
  }
  return blocks;
}
