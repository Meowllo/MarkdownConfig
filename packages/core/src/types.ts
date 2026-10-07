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
/**
 * 单元格内一个**可写片段**（v0.7.1）：格内每个内联标记各一个。
 * `mc set 表.id.列#名字|#序号` 就是靠它只替换一个片段，句子与同格其它标记一个字节都不动。
 */
export interface TableCellPart {
  /** 标记名；无名内联标记（匿名 @array）为 undefined */
  ident?: string;
  /** 格内出现顺序，1-based（跨具名 / 无名统一编号） */
  index: number;
  /** 标记内**值文本**的区间 [start, end)（即开标记之后、关标记之前） */
  start: number;
  end: number;
  /**
   * 该片段自己的值。
   * 注意无名 `@array` 给的是**它那个组**（`[8,7]`），不是整格的数组（`[[8,7]]`）——
   * 选择器寻址的是"标记"，所以写进去什么就读回什么。
   */
  value: unknown;
}

export interface TableCellPos {
  /** 整格文本（trim 后）的字符区间 [start, end) */
  start: number;
  end: number;
  /** 该格恰为一个内联标记时，标记内值文本的区间 */
  inner?: { start: number; end: number };
  /** 格内各内联标记的可写片段；无标记的格没有这个字段 */
  parts?: TableCellPart[];
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

/** 评论：存在文档正文里（约定统一放在末尾的评论区），不进配置、不落外部文件 */
export interface CommentEntry {
  /** 指向的目标：变量名 / 表名 / `表.id[.列]` / 块 id（不含 `^`） */
  target: string;
  /** 评论正文（trim 后） */
  text: string;
  /** 开标记的字符起点 */
  start: number;
  /** 关标记的字符终点 */
  end: number;
  /** 开标记所在行（1-based） */
  line: number;
}

export interface ParseResult {
  entries: ConfigEntry[];
  blocks: Block[];
  comments: CommentEntry[];
  errors: McError[];
}
