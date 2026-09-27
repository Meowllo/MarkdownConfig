/** GFM 子集表格解析：表头 = 键，单元格类型自动推断，空单元格 → null */

import { inferValue, parseArrayValue, parseRangeValue } from "./infer";

/** 单元格内联标记：成对的 @var / @array / @range（关闭标记 kind 必须与开始一致） */
const INLINE_RE =
  /<!--@(var|array|range)\s+([A-Za-z_][\w.-]*)(?:\s+type=([A-Za-z]+))?\s*-->([\s\S]*?)<!--@\/\1-->/g;

interface InlineHit {
  kind: string;
  name: string;
  declared?: string;
  inner: string;
}

function resolveInline(f: InlineHit): unknown {
  if (f.kind === "array") return parseArrayValue(f.inner, f.declared).value;
  if (f.kind === "range") return parseRangeValue(f.inner).value;
  return inferValue(f.inner, f.declared).value;
}

function parseCell(cell: string): { value: unknown; error?: string } {
  const found: InlineHit[] = [];
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(cell)) !== null) {
    found.push({ kind: m[1], name: m[2], declared: m[3], inner: m[4] });
  }

  if (found.length === 0) {
    if (cell.includes("<!--@")) {
      return { value: null, error: `单元格内联标记未闭合或错配：${cell.trim()}` };
    }
    return { value: inferValue(cell).value };
  }

  // 标记外的残留文本：含未闭合标记 → 报错；否则即"人读注释"，不进配置（保留在源文件）
  const residual = cell.replace(INLINE_RE, "").trim();
  if (residual.includes("<!--@")) {
    return { value: null, error: `单元格内联标记未闭合或错配：${cell.trim()}` };
  }
  if (found.length === 1) {
    // 整格单个标记 → 裸值（消除 {名:值} 双层，#3）
    try {
      return { value: resolveInline(found[0]) };
    } catch (e) {
      return { value: null, error: `${(e as Error).message}` };
    }
  }
  // 整格多个标记 → 对象 { NAME: value, ... }
  const obj: Record<string, unknown> = {};
  try {
    for (const f of found) obj[f.name] = resolveInline(f);
  } catch (e) {
    return { value: null, error: `${(e as Error).message}` };
  }
  return { value: obj };
}

export function parseTable(
  lines: string[],
): { rows: Record<string, unknown>[]; error?: string } {
  const clean = lines.filter((l) => l.trim() !== "");
  if (clean.length < 2) {
    return { rows: [], error: "表格需要表头行和分隔行" };
  }

  const split = (line: string): string[] => {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  };

  const header = split(clean[0]);
  const sep = split(clean[1]);
  if (sep.length === 0 || !sep.every((c) => /^:?-{1,}:?$/.test(c))) {
    return { rows: [], error: "第二行必须是分隔行（如 | --- | --- |）" };
  }
  if (new Set(header).size !== header.length) {
    return { rows: [], error: "表头列名重复" };
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = 2; i < clean.length; i++) {
    const cells = split(clean[i]);
    if (cells.length !== header.length) {
      return {
        rows: [],
        error: `第 ${i + 1} 行有 ${cells.length} 个单元格，表头为 ${header.length} 个`,
      };
    }
    const row: Record<string, unknown> = {};
    for (let j = 0; j < header.length; j++) {
      const cell = cells[j];
      if (cell === "") {
        row[header[j]] = null;
        continue;
      }
      const r = parseCell(cell);
      if (r.error) return { rows: [], error: `第 ${i + 1} 行：${r.error}` };
      row[header[j]] = r.value;
    }
    rows.push(row);
  }
  return { rows };
}
