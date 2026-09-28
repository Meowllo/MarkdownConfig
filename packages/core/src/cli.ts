#!/usr/bin/env node
/** mc CLI：MarkdownConfig 命令行工具 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { buildConfig, canonicalJson, declaredOrderJson } from "./config";
import {
  allComments,
  appendOp,
  hashOf,
  nextCommentId,
  openComments,
  readOps,
} from "./journal";
import { parse } from "./scanner";
import { inferValue } from "./infer";
import type { McError, TableEntry, VarEntry } from "./types";

const VERSION = "0.5.0";

const HELP = `MarkdownConfig CLI v${VERSION}

用法:
  mc export <file> [--order=declared] [--allow-override] [--fingerprint]  导出配置为 JSON（canonical，字节稳定）
  mc get <file> <name>                                     读取变量 / 表格 / 表格单元格
  mc validate <file>                                       校验标记，错误带行号
  mc blocks <file>                                         列出块（id/type/行号）
  mc tables <file> [--all]                                 列出已标记表 + 未标记表计数
  mc set <file> <name> <value> [--actor=...]               就地修改变量值（落 journal）
  mc set <file> <TABLE>.<id>.<列> <value>                  就地修改表格单元格（落 journal）
  mc add <file> <name> <value> [--type=TYPE] [--actor=...] 文件末尾新增变量（落 journal）
  mc comment <file> <target> <text> [--actor=...]          对块/变量添加评论（落 journal）
  mc comments <file> [--all]                               列出评论（默认仅未解决）
  mc resolve <file> <comment-id> [--actor=...]             标记评论已解决
  mc journal <file> [--tail=N]                             查看审计日志
  mc log <file> <text> [--target=...] [--actor=...]        追加一条审计记录
  mc init <file.mc> [--force]                              生成 .mc 骨架文件
  mc init [dir]                                            初始化 .mc 日志目录
  mc version                                               版本信息

选项:
  --actor=human|agent    记录操作者（默认 agent）
  --order=declared       导出按声明顺序（默认 canonical 排序）
  --allow-override       同名变量后者覆盖（默认报错）
  --fingerprint          导出顶层带来源指纹 $fingerprint（sha256/sha256File/版本/时间）
  --no-timestamp         指纹不带 generatedAt（保证输出字节稳定）
  --no-journal           不写入审计日志
  --all                  评论包含已解决；tables 列出未标记表明细
  --tail=N               journal 只显示最近 N 条
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

/** 文件字节的 sha256（hex）—— 下游可直接用 shasum -a 256 复算 */
function sha256File(abs: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
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
    const fp: Record<string, unknown> = {
      source: path.basename(abs),
      // 源文本指纹：sha256(JSON.stringify(源文本))，不是文件字节
      sha256: hashOf(source),
      // 文件字节指纹：改注释也算变，可用 shasum -a 256 复算
      sha256File: sha256File(abs),
      mcVersion: VERSION,
    };
    // generatedAt 会破坏字节稳定：需要可复现输出时加 --no-timestamp
    if (!flags["no-timestamp"]) fp.generatedAt = new Date().toISOString();
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

function actorOf(flags: Record<string, string | boolean>): string {
  return typeof flags.actor === "string" ? flags.actor : "agent";
}

/** 是否写入审计日志（--no-journal 时不落 .mc/ 目录，避免在 git 仓库里凭空多出目录） */
function journalEnabled(flags: Record<string, string | boolean>): boolean {
  return !flags["no-journal"];
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
    if (journalEnabled(flags)) {
      appendOp(abs, {
        op: "update",
        actor: actorOf(flags),
        target: name,
        hash: hashOf(value),
        prev_hash: hashOf(entry.valueRaw),
        text: `set ${name} = ${value}`,
      });
    }
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
    setTableCell(abs, source, target, value, flags);
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
  flags: Record<string, string | boolean>,
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
  const label = `${table.name}.${id}.${col}`;
  if (journalEnabled(flags)) {
    appendOp(abs, {
      op: "update",
      actor: actorOf(flags),
      target: label,
      hash: hashOf(value),
      prev_hash: hashOf(source.slice(from, to)),
      text: `set ${label} = ${value}`,
    });
  }
  process.stdout.write(`${label} = ${value}\n`);
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
  if (journalEnabled(flags)) {
    appendOp(abs, {
      op: "create",
      actor: actorOf(flags),
      target: name,
      hash: hashOf(value),
      prev_hash: null,
      text: `add ${name} = ${value}`,
    });
  }
  process.stdout.write(`已新增 ${name} = ${value}\n`);
}

function cmdComment(pos: string[], flags: Record<string, string | boolean>): void {
  const [file, target, ...rest] = pos;
  const text = rest.join(" ");
  if (!file || !target || !text) fail("用法: mc comment <file> <target> <text>");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  const ok =
    res.entries.some((e) => e.name === target) || res.blocks.some((b) => b.id === target);
  if (!ok) fail(`目标不存在: ${target}`);
  const id = nextCommentId(abs);
  appendOp(abs, {
    op: "comment",
    actor: actorOf(flags),
    target,
    text,
    id,
    status: "open",
  });
  process.stdout.write(`评论已添加: ${id} → ${target}\n`);
}

function cmdComments(pos: string[], flags: Record<string, string | boolean>): void {
  const [file] = pos;
  if (!file) fail("用法: mc comments <file>");
  const { abs } = load(file);
  const list = flags.all ? allComments(abs) : openComments(abs);
  process.stdout.write(JSON.stringify(list, null, 2) + "\n");
}

function cmdResolve(pos: string[], flags: Record<string, string | boolean>): void {
  const [file, id] = pos;
  if (!file || !id) fail("用法: mc resolve <file> <comment-id>");
  const { abs } = load(file);
  const found = allComments(abs).find((c) => c.id === id);
  if (!found) fail(`评论不存在: ${id}`);
  if (found.status === "resolved") fail(`评论已解决: ${id}`);
  appendOp(abs, {
    op: "resolve",
    actor: actorOf(flags),
    target: id,
    text: "resolved",
  });
  process.stdout.write(`已解决: ${id}\n`);
}

function cmdJournal(pos: string[], flags: Record<string, string | boolean>): void {
  const [file] = pos;
  if (!file) fail("用法: mc journal <file>");
  const { abs } = load(file);
  let ops = readOps(abs);
  const tail = flags.tail !== undefined ? Number(flags.tail) : NaN;
  if (!Number.isNaN(tail) && Number.isFinite(tail)) ops = ops.slice(-tail);
  process.stdout.write(JSON.stringify(ops, null, 2) + "\n");
}

function cmdLog(pos: string[], flags: Record<string, string | boolean>): void {
  const [file, ...rest] = pos;
  const text = rest.join(" ");
  if (!file || !text) fail("用法: mc log <file> <text>");
  const { abs } = load(file);
  appendOp(abs, {
    op: "log",
    actor: actorOf(flags),
    target: typeof flags.target === "string" ? flags.target : undefined,
    text,
  });
  process.stdout.write("已记录\n");
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
  if (arg && /\.mc$/i.test(arg)) {
    const target = path.resolve(arg);
    if (fs.existsSync(target) && !flags.force) fail(`文件已存在: ${arg}（覆盖请加 --force）`);
    fs.writeFileSync(target, SKELETON, "utf8");
    process.stdout.write(`已生成骨架: ${arg}\n`);
    return;
  }
  const dir = arg ? path.resolve(arg) : process.cwd();
  const jdir = path.join(dir, ".mc");
  fs.mkdirSync(jdir, { recursive: true });
  const jf = path.join(jdir, "journal.jsonl");
  if (!fs.existsSync(jf)) fs.writeFileSync(jf, "", "utf8");
  process.stdout.write(`已初始化: ${jdir}\n`);
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
    case "journal":
      cmdJournal(pos, flags);
      break;
    case "log":
      cmdLog(pos, flags);
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
