/** MarkdownConfig 核心类型定义 */

export type VarResolvedType =
  | "string"
  | "number"
  | "int"
  | "boolean"
  | "json"
  | "text"
  | "array"
  | "range";

export interface McError {
  line: number;
  message: string;
  /** 附加提示（另起一行输出），用于把常见误用直接指向真因 */
  hint?: string;
}

export interface VarEntry {
  kind: "var";
  name: string;
  declaredType?: string;
  /** 解析后的类型 */
  type: VarResolvedType;
  /** 类型化值（推断或强制转换后的结果） */
  value: unknown;
  /** 值原文（trim 后） */
  valueRaw: string;
  /** 开始标记所在行（1-based） */
  line: number;
  /** 值文本的字符起点（不含） */
  valueStart: number;
  /** 值文本的字符终点（不含） */
  valueEnd: number;
}

export interface ArrayEntry {
  kind: "array";
  name: string;
  declaredType?: string;
  /** 解析后的类型，固定 array（元素类型各自推断，见 value） */
  type: "array";
  /** 类型化数组 */
  value: unknown[];
  /** 值原文（trim 后，如 "1/2/3/4"） */
  valueRaw: string;
  /** 开始标记所在行（1-based） */
  line: number;
  /** 值文本的字符起点（不含） */
  valueStart: number;
  /** 值文本的字符终点（不含） */
  valueEnd: number;
}

/** 单元格在源文本中的位置（供 mc set 就地写入） */
export interface TableCellPos {
  /** 整格文本（trim 后）的字符区间 [start, end) */
  start: number;
  end: number;
  /** 该格恰为一个内联标记时，标记内值文本的区间 */
  inner?: { start: number; end: number };
}

export interface TableRowPos {
  /** 该行在源文件中的 1-based 行号 */
  line: number;
  /** 列名 → 位置（含 id 列） */
  cells: Record<string, TableCellPos>;
}

export interface TableEntry {
  kind: "table";
  name: string;
  /** 第一列的表头名（id 列，不进入行数据） */
  idColumn: string;
  /** id → 行数据（不含 id 列） */
  data: Record<string, Record<string, unknown>>;
  /** id → 行位置信息 */
  positions: Record<string, TableRowPos>;
  line: number;
  /** 表体（表头行 → 最后一个数据行）的行号区间，1-based 闭区间 */
  bodyLines: [number, number];
}

export interface RangeEntry {
  kind: "range";
  name: string;
  declaredType?: string;
  /** 解析后的类型，固定 range */
  type: "range";
  /** 区间值 { min, max } */
  value: { min: number; max: number };
  /** 值原文（trim 后，如 "1~5"） */
  valueRaw: string;
  /** 开始标记所在行（1-based） */
  line: number;
  /** 值文本的字符起点（不含） */
  valueStart: number;
  /** 值文本的字符终点（不含） */
  valueEnd: number;
}

export type ConfigEntry = VarEntry | ArrayEntry | RangeEntry | TableEntry;

export interface Block {
  id?: string;
  type: "heading" | "paragraph" | "table";
  level?: number;
  title?: string;
  /** [起始行, 结束行)，1-based */
  lines: [number, number];
}

export interface ParseResult {
  entries: ConfigEntry[];
  blocks: Block[];
  errors: McError[];
}

export type JournalOpType = "create" | "update" | "comment" | "resolve" | "log";

export interface JournalOp {
  op: JournalOpType;
  actor: string;
  ts: string;
  /** 相对 journal 目录的文件路径 */
  file: string;
  target?: string;
  /** sha256（值文本），同一 target 通过 prev_hash 串链 */
  hash?: string | null;
  prev_hash?: string | null;
  text?: string;
  /** 评论 id（op=comment） */
  id?: string;
  /** 评论状态（op=comment：open；op=resolve 关闭） */
  status?: string;
}
