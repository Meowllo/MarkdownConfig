#!/usr/bin/env node
/** mc CLI：MarkdownConfig 命令行工具 */

import * as fs from "fs";
import * as path from "path";
import { appendComment, removeCommentAt } from "./comments";
import { buildConfig, canonicalJson, declaredOrderJson } from "./config";
import { makeFingerprint } from "./fingerprint";
import { inferValue } from "./infer";
import { parse } from "./scanner";
import type { McError, ParseResult, TableEntry, VarEntry } from "./types";
import { VERSION } from "./version";

const HELP = `MarkdownConfig CLI v${VERSION}

用法:
  mc export <file> [--order=declared] [--allow-override] [--fingerprint]  导出配置为 JSON（canonical，字节稳定）
  mc get <file> <name>                                     读取变量 / 表格 / 表格单元格
  mc validate <file>                                       校验标记，错误带行号
  mc blocks <file>                                         列出块（id/type/行号）
  mc tables <file> [--all]                                 列出已标记表 + 未标记表计数
  mc set <file> <name> <value>                             就地修改变量值
  mc set <file> <TABLE>.<id>.<列> <value>                  就地修改表格单元格
  mc add <file> <name> <value> [--type=TYPE]                文件末尾新增变量
  mc comment <file> <target> <text>                        追加评论到文末评论区
  mc comments <file>                                       列出评论（带序号，供 resolve 用）
  mc resolve <file> <序号>                                  删除（解决）第 N 条评论
  mc init <file.mc> [--force]                              生成 .mc 骨架文件
  mc version                                               版本信息

选项:
  --order=declared       导出按声明顺序（默认 canonical 排序）
  --allow-override       同名变量后者覆盖（默认报错）
  --fingerprint          导出顶层带来源指纹 $fingerprint（sha256/sha256File/版本/时间）
  --no-timestamp         指纹不带 generatedAt（保证输出字节稳定）
  --all                  tables 列出未标记表明细
`;

function parseArgs(argv: string[]): { pos: string[]; flags: Record<string, string | boolean> } {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function fail(msg: string): never {
  console.error(`mc: ${msg}`);
  process.exit(1);
}

function load(file: string): { abs: string; source: string } {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) fail(`文件不存在: ${file}`);
  if (fs.statSync(abs).isDirectory()) fail(`这是一个目录，不是文件: ${file}`);
  return { abs, source: fs.readFileSync(abs, "utf8") };
}

/** 错误输出：message 一行，hint 另起一行缩进（把常见误用直接指向真因） */
function formatError(e: McError): string {
  return e.hint ? `${e.line}: ${e.message}\n     提示：${e.hint}` : `${e.line}: ${e.message}`;
}

function printErrors(errors: McError[]): void {
  for (const e of errors) console.error(formatError(e));
}

function parseOrExit(abs: string, source: string): ReturnType<typeof parse> {
  const res = parse(source);
  if (res.errors.length > 0) {
    printErrors(res.errors);
    fail(`校验失败，共 ${res.errors.length} 个错误`);
  }
  return res;
}

function cmdExport(pos: string[], flags: Record<string, string | boolean>): void {
  const [file] = pos;
  if (!file) fail("用法: mc export <file>");
  const { abs, source } = load(file);
  const res = parse(source);
  if (res.errors.length > 0) {
    printErrors(res.errors);
    fail(`校验失败，共 ${res.errors.length} 个错误（--relaxed 未实现，请先修正）`);
  }
  const { config, errors } = buildConfig(res, { allowOverride: !!flags["allow-override"] });
  if (errors.length > 0) {
    printErrors(errors);
    fail("配置组装失败");
  }
  let outConfig: Record<string, unknown> = config;
  if (flags.fingerprint) {
    // 与 SDK 的 McDoc.fingerprint() 共用同一实现（见 fingerprint.ts），两处哈希必须一致
    const fp = makeFingerprint(abs, source, { timestamp: !flags["no-timestamp"] });
    outConfig = { $fingerprint: fp, ...config };
  }
  const out =
    flags.order === "declared" ? declaredOrderJson(outConfig) : canonicalJson(outConfig);
  process.stdout.write(out);
}

/** 表格寻址：把 `TABLE.<id>[.<列>]` 解析为表 + id + 列（表名可含点，取最长前缀） */
function resolveTable(
  res: ReturnType<typeof parse>,
  name: string,
): { table: TableEntry; id: string; col?: string } | null {
  const tables = res.entries.filter((e): e is TableEntry => e.kind === "table");
  const parts = name.split(".");
  for (let k = parts.length - 1; k >= 1; k--) {
    const tname = parts.slice(0, k).join(".");
    const table = tables.find((t) => t.name === tname);
    if (!table) continue;
    const rest = parts.slice(k);
    if (rest.length === 1) return { table, id: rest[0] };
    if (rest.length === 2) return { table, id: rest[0], col: rest[1] };
    return null;
  }
  return null;
}

function cmdGet(pos: string[], _flags: Record<string, string | boolean>): void {
  const [file, name] = pos;
  if (!file || !name) fail("用法: mc get <file> <name>");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  const entry = res.entries.find((e) => e.name === name);
  let val: unknown;
  if (entry) {
    val = entry.kind === "table" ? entry.data : entry.value;
  } else {
    const target = resolveTable(res, name);
    if (!target) fail(`未找到变量/表格: ${name}`);
    const row = target.table.data[target.id];
    if (!row) {
      fail(`表格 ${target.table.name} 中不存在 id: ${target.id}（现有 id: ${Object.keys(target.table.data).join(", ")}）`);
    }
    const cells = target.table.positions[target.id]?.cells ?? {};
    if (target.col === undefined) val = row;
    else if (!Object.prototype.hasOwnProperty.call(cells, target.col)) {
      fail(
        `表格 ${target.table.name} 中不存在列: ${target.col}（可选：${Object.keys(cells).join(", ")}）`,
      );
    } else if (target.col === target.table.idColumn) val = target.id;
    else val = row[target.col];
  }
  process.stdout.write(JSON.stringify(val) + "\n");
}

function cmdValidate(pos: string[], _flags: Record<string, string | boolean>): void {
  const [file] = pos;
  if (!file) fail("用法: mc validate <file>");
  const { abs, source } = load(file);
  const res = parse(source);
  if (res.errors.length === 0) {
    console.log("OK");
    return;
  }
  for (const e of res.errors) console.log(formatError(e));
  process.exit(1);
}

function cmdBlocks(pos: string[], _flags: Record<string, string | boolean>): void {
  const [file] = pos;
  if (!file) fail("用法: mc blocks <file>");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  const out: Array<Record<string, unknown>> = res.blocks.map((b) => ({
    id: b.id ?? null,
    type: b.type,
    title: b.title ?? null,
    lines: b.lines,
  }));
  for (const e of res.entries) {
    out.push({
      id: e.name,
      type: e.kind === "table" ? "config-table" : "config",
      title: null,
      lines: [e.line, e.line],
    });
  }
  out.sort((a, b) => (a.lines as number[])[0] - (b.lines as number[])[0]);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

function cmdTables(pos: string[], flags: Record<string, string | boolean>): void {
  const [file] = pos;
  if (!file) fail("用法: mc tables <file>");
  const { source } = load(file);
  const res = parseOrExit(path.resolve(file), source);

  const marked = res.entries.filter((e): e is TableEntry => e.kind === "table");
  const gfm = res.blocks.filter((b) => b.type === "table");
  const covered = new Set<number>();
  const rows: Array<{ name: string; count: number; start: number; end: number }> = [];
  for (const t of marked) {
    // 表体行区间由解析结果给出（标记与表头之间允许空行）
    const bi = gfm.findIndex((b) => b.lines[0] >= t.line + 1 && b.lines[0] <= t.bodyLines[1]);
    if (bi >= 0) covered.add(bi);
    rows.push({
      name: t.name,
      count: Object.keys(t.data).length,
      start: t.line,
      end: t.bodyLines[1],
    });
  }
  const unmarked = gfm.filter((_, i) => !covered.has(i));

  const lines: string[] = rows.map(
    (r) => `${r.name.padEnd(16)} ${String(r.count).padStart(3)} 行    L${r.start}-L${r.end}`,
  );
  if (unmarked.length > 0) {
    lines.push(`（另有 ${unmarked.length} 张未标记的表 —— mc tables --all 列出）`);
    if (flags.all) {
      for (const b of unmarked) lines.push(`  未标记表 L${b.lines[0]}-L${b.lines[1]}`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
}

function cmdSet(pos: string[], flags: Record<string, string | boolean>): void {
  const [file, name, value] = pos;
  if (!file || !name || value === undefined) fail("用法: mc set <file> <name> <value>");
  if (value.includes("\n")) fail("set 暂不支持多行值");
  if (value.includes("<!--@")) fail("值里不能再写标记（<!--@…-->）");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);

  // 1) 变量（含点号命名空间）
  const entry = res.entries.find((e) => e.kind === "var" && e.name === name) as
    | VarEntry
    | undefined;
  if (entry) {
    const newSource = source.slice(0, entry.valueStart) + value + source.slice(entry.valueEnd);
    const after = parse(newSource);
    if (after.errors.length > 0) {
      fail(`改写会使文档校验失败，已放弃（文件未修改）：\n  ${after.errors.map(formatError).join("\n  ")}`);
    }
    fs.writeFileSync(abs, newSource, "utf8");
    process.stdout.write(`${name} = ${value}\n`);
    return;
  }

  // 2) 表格单元格：TABLE.<id>.<列>
  const exactTable = res.entries.find((e) => e.kind === "table" && e.name === name) as
    | TableEntry
    | undefined;
  if (exactTable) {
    fail(
      `表格 ${name} 需要指定 id 与列：mc set <file> ${name}.<id>.<列> <value>\n` +
        `     现有 id：${Object.keys(exactTable.data).join(", ") || "（空表）"}`,
    );
  }
  const target = resolveTable(res, name);
  if (target) {
    setTableCell(abs, source, target, value);
    return;
  }

  const head = name.split(".")[0];
  if (res.entries.some((e) => e.kind === "table" && e.name === head)) {
    fail(
      `未找到 ${name}：要改表格 ${head} 的单元格，请用 mc set <file> ${head}.<id>.<列> <value>`,
    );
  }
  fail(`未找到变量 ${name}（新增请用 mc add；表格单元格请用 <表名>.<id>.<列>）`);
}

/** 表格单元格就地写入：命中唯一行、唯一格，写完先复校验再落盘 */
function setTableCell(
  abs: string,
  source: string,
  target: { table: TableEntry; id: string; col?: string },
  value: string,
): void {
  const { table, id } = target;
  const row = table.data[id];
  if (!row) {
    fail(
      `表格 ${table.name} 中不存在 id: ${id}（现有 id: ${Object.keys(table.data).join(", ") || "（空表）"}）`,
    );
  }
  const allCols = Object.keys(table.positions[id].cells);
  const dataCols = Object.keys(row);
  let col = target.col;
  if (col === undefined) {
    if (dataCols.length !== 1) {
      fail(
        `表格 ${table.name} 的 ${id} 行有多列，请指定列：mc set <file> ${table.name}.${id}.<列> <value>\n` +
          `     可选列：${allCols.join(", ")}`,
      );
    }
    col = dataCols[0];
  }
  const pos = table.positions[id]?.cells[col];
  if (!pos) {
    fail(`表格 ${table.name} 中不存在列 ${col}（可选：${allCols.join(", ")}）`);
  }
  if (value.includes("|")) fail("值不能包含 |（会破坏表格结构）");

  // 单标记单元格 → 只替换标记内文本，标记与"尾巴"人读注释原样保留
  const from = pos.inner ? pos.inner.start : pos.start;
  const to = pos.inner ? pos.inner.end : pos.end;
  const newSource = source.slice(0, from) + value + source.slice(to);

  const after = parse(newSource);
  if (after.errors.length > 0) {
    fail(
      `改写会使文档校验失败，已放弃（文件未修改）：\n  ${after.errors.map(formatError).join("\n  ")}`,
    );
  }
  const verified = after.entries.find((e) => e.kind === "table" && e.name === table.name) as
    | TableEntry
    | undefined;
  const expectId = col === table.idColumn ? String(inferValue(value).value) : id;
  const verifiedRow = verified?.data[expectId];
  if (!verifiedRow || (col !== table.idColumn && !(col in verifiedRow))) {
    fail(`改写后无法按 ${table.name}.${id}.${col} 定位，已放弃（文件未修改）`);
  }

  fs.writeFileSync(abs, newSource, "utf8");
  process.stdout.write(`${table.name}.${id}.${col} = ${value}\n`);
}

function cmdAdd(pos: string[], flags: Record<string, string | boolean>): void {
  const [file, name, value] = pos;
  if (!file || !name || value === undefined) fail("用法: mc add <file> <name> <value>");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  if (res.entries.some((e) => e.name === name)) fail(`变量已存在: ${name}（修改请用 mc set）`);
  if (value.includes("\n")) fail("add 暂不支持多行值");
  const typeAttr = typeof flags.type === "string" ? ` type=${flags.type}` : "";
  const snippet = `\n<!--@var ${name}${typeAttr}-->${value}<!--@/var-->\n`;
  const newSource = source + snippet;
  const after = parse(newSource);
  if (after.errors.length > 0) {
    fail(`新增会使文档校验失败，已放弃（文件未修改）：\n  ${after.errors.map(formatError).join("\n  ")}`);
  }
  fs.writeFileSync(abs, newSource, "utf8");
  process.stdout.write(`已新增 ${name} = ${value}\n`);
}

/** 目标是否存在：变量名 / 表名 / 表.id[.列] / 块 id */
function targetExists(res: ParseResult, target: string): boolean {
  if (res.entries.some((e) => e.name === target)) return true;
  if (res.blocks.some((b) => b.id === target)) return true;
  return resolveTable(res, target) !== null;
}

function cmdComment(pos: string[], _flags: Record<string, string | boolean>): void {
  const [file, target, ...rest] = pos;
  const text = rest.join(" ");
  if (!file || !target || !text) fail("用法: mc comment <file> <target> <text>");
  if (text.includes("<!--@")) fail("评论内容里不能再写标记（<!--@…-->）");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  if (!targetExists(res, target)) {
    fail(
      `目标不存在: ${target}（可用：变量名 / 表名 / 表.id[.列] / 块 id；现有块 id：${
        res.blocks.filter((b) => b.id).map((b) => b.id).join(", ") || "无"
      }）`,
    );
  }
  const next = appendComment(source, target, text);
  fs.writeFileSync(abs, next, "utf8");
  process.stdout.write(`已添加评论 → ${target}\n`);
}

function cmdComments(pos: string[], _flags: Record<string, string | boolean>): void {
  const [file] = pos;
  if (!file) fail("用法: mc comments <file>");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  const list = res.comments.map((c, i) => ({
    index: i + 1,
    target: c.target,
    text: c.text,
    line: c.line,
  }));
  process.stdout.write(JSON.stringify(list, null, 2) + "\n");
}

function cmdResolve(pos: string[], _flags: Record<string, string | boolean>): void {
  const [file, n] = pos;
  if (!file || !n) fail("用法: mc resolve <file> <序号>（序号见 mc comments）");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  const idx = Number(n);
  if (!/^\d+$/.test(n)) fail(`序号必须是数字：${n}（用法: mc resolve <file> <序号>）`);
  if (idx < 1 || idx > res.comments.length) {
    const avail = res.comments.map((c, i) => `${i + 1}.${c.target}`).join(", ") || "（无）";
    fail(`没有第 ${n} 条评论（现有：${avail}）`);
  }
  const c = res.comments[idx - 1];
  fs.writeFileSync(abs, removeCommentAt(source, idx), "utf8");
  process.stdout.write(`已解决（删除）第 ${idx} 条评论 → ${c.target}\n`);
}

/** 新文档骨架：本身就是合法的 .mc（mc validate 必须通过） */
const SKELETON = [
  "# 文档标题",
  "",
  "> 摘要：什么情况下该读本文档、什么情况下该改本文档。",
  "",
  "## 小节标题",
  "",
  "连接超时：<!--@var TIMEOUT_MS-->3000<!--@/var--> 毫秒",
  "",
  "<!--@table ITEMS-->",
  "| id | 值 | 说明 |",
  "| --- | --- | --- |",
  "| item-a | 1 | 示例行；第一列固定为 id，逐行唯一 |",
  "<!--@/table-->",
  "",
  "> 想**展示**标记本身（写示例）时必须放进围栏代码块，直接写在正文里会被当成真配置：",
  "",
  "```text",
  "<!--@var NAME-->值<!--@/var-->",
  "```",
  "",
].join("\n");

function cmdInit(pos: string[], flags: Record<string, string | boolean>): void {
  const arg = pos[0];
  if (!arg || !/\.mc$/i.test(arg)) {
    fail("用法: mc init <file.mc>（生成骨架文件）");
  }
  const target = path.resolve(arg);
  if (fs.existsSync(target) && !flags.force) fail(`文件已存在: ${arg}（覆盖请加 --force）`);
  fs.writeFileSync(target, SKELETON, "utf8");
  process.stdout.write(`已生成骨架: ${arg}\n`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    process.stdout.write(HELP);
    return;
  }
  const cmd = argv[0];
  const { pos, flags } = parseArgs(argv.slice(1));
  switch (cmd) {
    case "export":
      cmdExport(pos, flags);
      break;
    case "get":
      cmdGet(pos, flags);
      break;
    case "validate":
      cmdValidate(pos, flags);
      break;
    case "blocks":
      cmdBlocks(pos, flags);
      break;
    case "tables":
      cmdTables(pos, flags);
      break;
    case "set":
      cmdSet(pos, flags);
      break;
    case "add":
      cmdAdd(pos, flags);
      break;
    case "comment":
      cmdComment(pos, flags);
      break;
    case "comments":
      cmdComments(pos, flags);
      break;
    case "resolve":
      cmdResolve(pos, flags);
      break;
    case "init":
      cmdInit(pos, flags);
      break;
    case "version":
    case "--version":
      process.stdout.write(VERSION + "\n");
      break;
    default:
      process.stderr.write(`mc: 未知命令 ${cmd}\n\n`);
      process.stderr.write(HELP);
      process.exit(2);
  }
}

// 管道被下游提前关闭（| head / | less / | grep -m1）不是错误：优雅退出，避免 EPIPE 崩溃（#9）
function installPipeGuard(): void {
  const onError = (err: NodeJS.ErrnoException): void => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  };
  process.stdout.on("error", onError);
  process.stderr.on("error", onError);
}

installPipeGuard();
main();
