/** MarkdownConfig 核心类型定义 */

export type VarResolvedType =
  | "string"
  | "number"
  | "int"
  | "boolean"
  | "json"
  | "text"
  | "array";

export interface McError {
  line: number;
  message: string;
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

export interface TableEntry {
  kind: "table";
  name: string;
  rows: Record<string, unknown>[];
  line: number;
}

export type ConfigEntry = VarEntry | ArrayEntry | TableEntry;

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
