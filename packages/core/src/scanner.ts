/** 扫描器：从 .mc 文本中提取配置条目（@var / @table）、块结构与错误 */

import { inferValue } from "./infer";
import { parseTable } from "./table";
import type { Block, ConfigEntry, McError, ParseResult, VarEntry } from "./types";

const VAR_RE =
  /<!--@var\s+([A-Za-z_][\w.-]*)(?:\s+type=([A-Za-z]+))?-->|<!--@\/var-->/g;
const TABLE_OPEN_RE = /^\s*<!--@table\s+([A-Za-z_][\w.-]*)\s*-->\s*$/;
const TABLE_CLOSE_RE = /^\s*<!--@\/table-->\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+\^([A-Za-z0-9_-]+))?\s*$/;
const BLOCK_ID_RE = /^\^([A-Za-z0-9_-]+)\s*$/;
const TRAILING_ID_RE = /(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

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

  // ---- 1. @var 扫描（跳过围栏；记录值区间，供表格区域互斥判断）----
  const varSpans: Array<[number, number]> = [];
  const varStack: Array<{ name: string; declaredType?: string; markerEnd: number; line: number }> = [];
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(source)) !== null) {
    const line = lineAt(m.index);
    if (inFence(line - 1, fences)) continue;
    if (m[1] !== undefined) {
      // open
      if (varStack.length > 0) {
        errors.push({
          line,
          message: `@var 嵌套：${m[1]} 出现在 ${varStack[varStack.length - 1].name} 内部`,
        });
      }
      varStack.push({ name: m[1], declaredType: m[2], markerEnd: m.index + m[0].length, line });
    } else {
      // close
      const top = varStack.pop();
      if (!top) {
        errors.push({ line, message: "@var 关闭标记缺少对应的开始标记" });
        continue;
      }
      const valueRaw = source.slice(top.markerEnd, m.index);
      if (valueRaw.includes("\n") && top.declaredType !== "json" && top.declaredType !== "text") {
        errors.push({
          line: top.line,
          message: `@var ${top.name} 的值含换行，需声明 type=json 或 type=text`,
        });
        continue;
      }
      try {
        const { value, type } = inferValue(valueRaw, top.declaredType);
        const entry: VarEntry = {
          kind: "var",
          name: top.name,
          declaredType: top.declaredType,
          type: type as VarEntry["type"],
          value,
          valueRaw: valueRaw.trim(),
          line: top.line,
          valueStart: top.markerEnd,
          valueEnd: m.index,
        };
        entries.push(entry);
        varSpans.push([top.line - 1, line - 1]);
      } catch (e) {
        errors.push({ line: top.line, message: `@var ${top.name}: ${(e as Error).message}` });
      }
    }
  }
  for (const t of varStack) {
    errors.push({ line: t.line, message: `@var ${t.name} 未闭合` });
  }

  // ---- 2. @table 扫描（独占一行；跳过围栏与 @var 值区域）----
  const tableStack: Array<{ name: string; openLine: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (inFence(i, fences)) continue;
    if (inSpan(i, varSpans)) {
      if (TABLE_OPEN_RE.test(lines[i]) || TABLE_CLOSE_RE.test(lines[i])) {
        errors.push({ line: i + 1, message: "@table 标记不允许出现在 @var 值内" });
      }
      continue;
    }
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
    if (TABLE_CLOSE_RE.test(lines[i])) {
      const top = tableStack.pop();
      if (!top) {
        errors.push({ line: i + 1, message: "@table 关闭标记缺少对应的开始标记" });
        continue;
      }
      const body = lines.slice(top.openLine + 1, i);
      if (body.filter((l) => l.trim() !== "").length === 0) {
        errors.push({ line: top.openLine + 1, message: `表格 ${top.name} 内容为空` });
        continue;
      }
      const parsed = parseTable(body);
      if (parsed.error) {
        errors.push({ line: top.openLine + 1, message: `表格 ${top.name}: ${parsed.error}` });
        continue;
      }
      entries.push({ kind: "table", name: top.name, rows: parsed.rows, line: top.openLine + 1 });
    }
  }
  for (const t of tableStack) {
    errors.push({ line: t.openLine + 1, message: `表格 ${t.name} 未闭合` });
  }

  return { entries, blocks, errors };
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
