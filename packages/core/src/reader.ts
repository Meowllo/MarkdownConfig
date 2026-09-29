/**
 * 稳定读取层 —— 下游**唯一该直接依赖**的读取接口。
 *
 * ## 为什么存在
 * `mc export` 的输出是**序列化契约**（给跨语言用的 JSON，形状会随语法演进，例如 v0.5.0
 * 表格由"对象数组"改为"id→对象"）。下游若直接消费那个形状，一次形状变更就要改自己的
 * 项目代码。本层把"文档长什么样"与"下游看到什么"解耦：
 *
 *   - 表 → `rows()` 永远返回**行对象数组**（含 id 列，按文档列序）；
 *   - 变量 → `value()` 直接给 JS 值。
 *
 * 于是"读取逻辑"由工具定义、由工具维护；导出格式再变，只改这一层，下游代码不动。
 *
 * ## 契约（改动即破坏性变更）
 *   - `rows()` 顺序 = 文档行序；每行的键序 = 文档列序，id 列在首位。
 *   - `columns` 顺序 = 文档列序（含 id 列，在首位）。
 *   - `value()` 支持点号路径（`server.port`，与 `mc get` 一致）；字面名优先（表名可含点）。
 *   - 缺项 / 缺 id / 缺列 → **抛 `McConfigError`**（fail loud，消息里给可选值），不返回空值。
 *   - 新增方法/字段是小版本；改已有方法语义是大版本。
 *
 * ## 逃生口
 * 需要原始序列化形状（例如做通用 JSON 变换）时用 `raw`，但**那部分不享受形状稳定承诺**。
 */

import * as fs from "fs";
import { buildConfig } from "./config";
import { makeFingerprint, type Fingerprint } from "./fingerprint";
import { parse } from "./scanner";
import type { Block, CommentEntry, ConfigEntry, McError, TableEntry } from "./types";

/** 一行表格数据：列名 → 值；**含 id 列** */
export type McRow = Record<string, unknown>;

export interface McTable {
  name: string;
  /** 第一列的表头名（id 列） */
  idColumn: string;
  /** 列名，按文档列序，含 id 列（在首位） */
  columns: string[];
  /** id，按文档行序 */
  ids: string[];
  /** 行数据，按文档行序；每行含 id 列 */
  rows: McRow[];
}

/** 读取层的失败出口：配置/文档不符合预期（不是解析语法错误） */
export class McConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McConfigError";
  }
}

const list = (xs: string[]): string => (xs.length > 0 ? xs.join(", ") : "（无）");

export class McDoc {
  readonly file: string;
  readonly source: string;
  /** 解析出的条目（含位置信息），供需要落点的用法 */
  readonly entries: ConfigEntry[];
  readonly blocks: Block[];
  readonly comments: CommentEntry[];
  /** 语法/校验错误（**不抛**，由调用方决定策略） */
  readonly errors: McError[];
  /** 原始配置：形状同 `mc export`（**不享受形状稳定承诺**，仅作逃生口） */
  readonly raw: Record<string, unknown>;
  /** 配置构建期的错误（重名、类型冲突等），与 `errors` 分开是有意的 */
  readonly configErrors: McError[];
  /** 是否从磁盘读出（决定 `fingerprint()` 是否附带文件字节哈希） */
  readonly fromDisk: boolean;

  private readonly tables: Map<string, TableEntry>;

  constructor(
    file: string,
    source: string,
    opts: { allowOverride?: boolean; fromDisk?: boolean } = {},
  ) {
    this.file = file;
    this.source = source;
    this.fromDisk = opts.fromDisk === true;
    const result = parse(source);
    const built = buildConfig(result, opts);
    this.entries = result.entries;
    this.blocks = result.blocks;
    this.comments = result.comments;
    this.errors = result.errors;
    this.configErrors = built.errors;
    this.raw = built.config;
    this.tables = new Map();
    for (const e of result.entries) {
      if (e.kind === "table") this.tables.set(e.name, e);
    }
  }

  /** 是否有语法或构建错误 */
  get ok(): boolean {
    return this.errors.length === 0 && this.configErrors.length === 0;
  }

  /** 全部错误（语法 + 构建），便于一次性报给用户 */
  get allErrors(): McError[] {
    return [...this.errors, ...this.configErrors];
  }

  /** 来源指纹；`timestamp:false` 时输出字节可复现（内存文档不含 `sha256File`，见 fingerprint.ts） */
  fingerprint(opts: { timestamp?: boolean } = {}): Fingerprint {
    const onDisk = this.fromDisk && fs.existsSync(this.file);
    return makeFingerprint(this.file, this.source, { ...opts, fileBytes: onDisk });
  }

  /** 已标记的表名 */
  tableNames(): string[] {
    return [...this.tables.keys()];
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.raw, name);
  }

  /** 变量/表格的值；支持点号路径（与 `mc get server.port` 一致）。不存在则抛。 */
  value(name: string): unknown {
    // 先按字面名匹配（表名可含点，如 `db.pools`，字面名优先）
    if (this.has(name)) return this.raw[name];
    if (name.includes(".")) {
      const parts = name.split(".");
      let cur: unknown = this.raw;
      for (const p of parts) {
        if (
          cur !== null &&
          typeof cur === "object" &&
          !Array.isArray(cur) &&
          Object.prototype.hasOwnProperty.call(cur, p)
        ) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          cur = undefined;
          break;
        }
      }
      if (cur !== undefined) return cur;
    }
    throw new McConfigError(
      `未找到配置项 \`${name}\`。文档中可读的名字：${list(Object.keys(this.raw))}`,
    );
  }

  /** 表视图；表不存在则抛（消息里列出已标记的表） */
  table(name: string): McTable {
    const t = this.tables.get(name);
    if (!t) {
      throw new McConfigError(
        `未找到已标记的表 \`${name}\`。文档中已标记的表：${list(this.tableNames())}` +
          `（确认表被 <!--@table ${name}--> 与 <!--@/table--> 包住）`,
      );
    }
    const columns = [t.idColumn, ...this.columnsOf(t)];
    const ids = Object.keys(t.data);
    // 按文档列序重建行（id 列在首位），并补上 id 列的值
    const rows = ids.map((id) => {
      const row: McRow = { [t.idColumn]: id };
      for (const c of columns) {
        if (c === t.idColumn) continue;
        if (Object.prototype.hasOwnProperty.call(t.data[id], c)) row[c] = t.data[id][c];
      }
      return row;
    });
    return { name, idColumn: t.idColumn, columns, ids, rows };
  }

  /** 行对象数组（稳定形状：含 id 列、按文档列序与行序） */
  rows(name: string): McRow[] {
    return this.table(name).rows;
  }

  /** 按 id 取一行；不存在则抛（消息里列出现有 id） */
  row(name: string, id: string): McRow {
    const t = this.table(name);
    const idx = t.ids.indexOf(id);
    if (idx < 0) {
      throw new McConfigError(
        `表 \`${name}\` 中不存在 id \`${id}\`。现有 id：${list(t.ids)}`,
      );
    }
    return t.rows[idx];
  }

  /** 取一个格子；列名不存在则抛（消息里列出可选列） */
  cell(name: string, id: string, col: string): unknown {
    const r = this.row(name, id);
    if (!Object.prototype.hasOwnProperty.call(r, col)) {
      throw new McConfigError(
        `表 \`${name}\` 的 \`${id}\` 行不存在列 \`${col}\`。可选列：${list(Object.keys(r))}`,
      );
    }
    return r[col];
  }

  /** id 列数据之外的表头列（保持文档列序） */
  private columnsOf(t: TableEntry): string[] {
    for (const id of Object.keys(t.data)) {
      return Object.keys(t.data[id]);
    }
    // 空表（只有表头）：从源文本里读表头行
    return this.headerCells(t).filter((c) => c !== t.idColumn);
  }

  /** 从源文本读表头单元格（空表兜底用） */
  private headerCells(t: TableEntry): string[] {
    const lines = this.source.split("\n");
    const [start] = t.bodyLines;
    const line = lines[start - 1] ?? "";
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  }
}

/** 从文件打开（读盘一次，源文本缓存进对象） */
export function open(file: string, opts: { allowOverride?: boolean } = {}): McDoc {
  if (!fs.existsSync(file)) {
    throw new McConfigError(`文件不存在：${file}`);
  }
  return new McDoc(file, fs.readFileSync(file, "utf8"), { ...opts, fromDisk: true });
}

/** 从已有源文本构造（例如编辑器里未落盘的内容、或字符串快照） */
export function fromSource(
  source: string,
  file = "<memory>",
  opts: { allowOverride?: boolean } = {},
): McDoc {
  return new McDoc(file, source, opts);
}
