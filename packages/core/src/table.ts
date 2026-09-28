/**
 * GFM 子集表格解析。
 *
 * 语义（v0.5.0 起）：**第一列是 id 列**，其取值必须非空且逐行唯一；
 * 读出为 `{ <id>: { 其余列… } }`（id 列不进入行数据）。
 * 单元格沿用三态：单标记裸值 / 多标记对象 / 标记外尾巴=人读注释。
 */

import { inferValue } from "./infer";
import { scanMarkers, splitArrayBody } from "./markers";
import type { TableCellPos, TableRowPos } from "./types";

interface CellSpan {
  /** 单元格文本（trim 后） */
  text: string;
  /** 绝对字符区间（trim 后） */
  absStart: number;
  absEnd: number;
}

/** 按 `|` 切分一行，并给出每个单元格在源文本中的绝对区间 */
function splitCells(line: string, absLineStart: number): CellSpan[] {
  const lead = line.length - line.trimStart().length;
  let base = absLineStart + lead;
  let s = line.trim();
  if (s.startsWith("|")) {
    base += 1;
    s = s.slice(1);
  }
  if (s.endsWith("|")) s = s.slice(0, -1);

  const out: CellSpan[] = [];
  let off = 0;
  for (const part of s.split("|")) {
    const l = part.length - part.trimStart().length;
    const r = part.length - part.trimEnd().length;
    out.push({
      text: part.trim(),
      absStart: base + off + l,
      absEnd: base + off + part.length - r,
    });
    off += part.length + 1; // +1：被吃掉的 '|'
  }
  return out;
}

interface CellResult {
  value: unknown;
  inner?: { start: number; end: number };
  error?: string;
}

const UNCLOSED = (cell: string): string => `单元格内联标记未闭合或错配：${cell.trim()}`;

function parseCell(cell: CellSpan): CellResult {
  const { regions, issues } = scanMarkers(cell.text);
  if (issues.length > 0) return { value: null, error: UNCLOSED(cell.text) };

  if (regions.length === 0) {
    if (cell.text.includes("<!--@")) return { value: null, error: UNCLOSED(cell.text) };
    return { value: inferValue(cell.text).value };
  }

  // 标记之外的残留：含未闭合标记 → 报错
  let residual = "";
  let cur = 0;
  for (const r of regions) {
    residual += cell.text.slice(cur, r.start);
    cur = r.end;
  }
  residual += cell.text.slice(cur);
  if (residual.includes("<!--@")) return { value: null, error: UNCLOSED(cell.text) };

  // 格内出现**无名** `@array` → 整格就是一个数组体（与顶层 @array 的值同一套切分规则）
  // 例：`A/B/<!--@array-->C/D<!--@/array-->` → ["A","B",["C","D"]]
  if (regions.some((r) => r.kind === "array" && !r.ident)) {
    const bodyIssues: typeof issues = [];
    const value = splitArrayBody(
      cell.text,
      0,
      cell.text.length,
      regions,
      undefined,
      bodyIssues,
      0,
    );
    if (bodyIssues.length > 0) return { value: null, error: bodyIssues[0].message };
    return { value };
  }

  if (regions.length === 1) {
    // 整格单个标记 → 裸值（消除 {名:值} 双层，#3）；标记外的文本即人读注释
    const r = regions[0];
    return {
      value: r.value,
      inner: { start: cell.absStart + r.contentStart, end: cell.absStart + r.contentEnd },
    };
  }

  // 整格多个标记 → 对象 { NAME: value, ... }
  const obj: Record<string, unknown> = {};
  for (const r of regions) {
    if (!r.ident) {
      return { value: null, error: `单元格内有多个标记时，每个标记都必须有名字：${cell.text.trim()}` };
    }
    if (obj[r.ident] !== undefined) {
      return { value: null, error: `单元格内标记名重复：${r.ident}` };
    }
    obj[r.ident] = r.value;
  }
  return { value: obj };
}

export interface ParsedTable {
  idColumn: string;
  data: Record<string, Record<string, unknown>>;
  /** id → 行位置信息；cells 含 id 列（id 列可寻址，便于改名） */
  positions: Record<string, TableRowPos>;
  /** 表头行的 1-based 绝对行号（跳过中间空行后的首个非空行） */
  headerLine: number;
  /** 最后一个数据行的 1-based 绝对行号 */
  lastLine: number;
  error?: string;
  /** 错误所在行的 1-based 绝对行号（缺省由调用方回落到表格开始标记行） */
  errorLine?: number;
}

/**
 * 解析表体。
 * @param body 允许的表体原文（开闭标记之间的文本，可能含空行）
 * @param bodyStart body 第一个字符在源文件中的绝对偏移
 * @param firstLine body 第一行的 1-based 绝对行号
 */
export function parseTable(body: string, bodyStart: number, firstLine: number): ParsedTable {
  const empty: ParsedTable = {
    idColumn: "",
    data: {},
    positions: {},
    headerLine: firstLine,
    lastLine: firstLine,
  };

  // 逐行带上绝对偏移与绝对行号
  const lines: Array<{ text: string; abs: number; line: number }> = [];
  {
    let pos = 0;
    let ln = firstLine;
    for (const text of body.split("\n")) {
      lines.push({ text, abs: bodyStart + pos, line: ln });
      pos += text.length + 1; // +1：换行
      ln += 1;
    }
  }
  const clean = lines.filter((l) => l.text.trim() !== "");
  if (clean.length < 2) {
    return { ...empty, error: "表格需要表头行和分隔行", errorLine: clean[0]?.line };
  }

  const header = splitCells(clean[0].text, clean[0].abs);
  const sep = splitCells(clean[1].text, clean[1].abs);
  if (sep.length === 0 || !sep.every((c) => /^:?-{1,}:?$/.test(c.text))) {
    return { ...empty, error: "第二行必须是分隔行（如 | --- | --- |）", errorLine: clean[1].line };
  }
  const headerNames = header.map((c) => c.text);
  if (new Set(headerNames).size !== headerNames.length) {
    return { ...empty, error: "表头列名重复", errorLine: clean[0].line };
  }
  if (header.length < 2) {
    return {
      ...empty,
      error: "表格至少需要两列（第一列固定为 id 列）",
      errorLine: clean[0].line,
    };
  }

  const idColumn = headerNames[0];
  const data: Record<string, Record<string, unknown>> = {};
  const positions: Record<string, TableRowPos> = {};
  let lastLine = clean[1].line;

  for (let i = 2; i < clean.length; i++) {
    const rowLine = clean[i];
    const cells = splitCells(rowLine.text, rowLine.abs);
    if (cells.length !== header.length) {
      return {
        ...empty,
        error: `该行有 ${cells.length} 个单元格，表头为 ${header.length} 个`,
        errorLine: rowLine.line,
      };
    }

    const cellPos: Record<string, TableCellPos> = {};
    const row: Record<string, unknown> = {};
    for (let j = 0; j < header.length; j++) {
      const cell = cells[j];
      const pos: TableCellPos = { start: cell.absStart, end: cell.absEnd };
      if (cell.text === "") {
        row[headerNames[j]] = null;
        cellPos[headerNames[j]] = pos;
        continue;
      }
      const r = parseCell(cell);
      if (r.error) return { ...empty, error: r.error, errorLine: rowLine.line };
      if (r.inner) pos.inner = r.inner;
      row[headerNames[j]] = r.value;
      cellPos[headerNames[j]] = pos;
    }

    const rawId = cells[0].text;
    if (rawId === "") {
      return {
        ...empty,
        error: `id 列（${idColumn}）不能为空`,
        errorLine: rowLine.line,
      };
    }
    const idValue = row[idColumn];
    if (idValue !== null && typeof idValue === "object") {
      return {
        ...empty,
        error: `id 列（${idColumn}）必须是标量`,
        errorLine: rowLine.line,
      };
    }
    const id = idValue === null ? rawId : String(idValue);
    if (id === "") {
      return { ...empty, error: `id 列（${idColumn}）不能为空`, errorLine: rowLine.line };
    }
    if (Object.prototype.hasOwnProperty.call(data, id)) {
      return { ...empty, error: `id 列取值重复：${id}`, errorLine: rowLine.line };
    }

    delete row[idColumn];
    data[id] = row;
    positions[id] = { line: rowLine.line, cells: cellPos };
    lastLine = rowLine.line;
  }

  return { idColumn, data, positions, headerLine: clean[0].line, lastLine };
}
