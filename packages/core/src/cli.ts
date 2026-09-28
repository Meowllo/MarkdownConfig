#!/usr/bin/env node
/** mc CLI：MarkdownConfig 命令行工具 */

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
import type { McError, VarEntry } from "./types";

const VERSION = "0.3.1";

const HELP = `MarkdownConfig CLI v${VERSION}

用法:
  mc export <file> [--order=declared] [--allow-override] [--fingerprint]  导出配置为 JSON（canonical，字节稳定）
  mc get <file> <name>                                     读取单个变量/表格
  mc validate <file>                                       校验标记，错误带行号
  mc blocks <file>                                         列出块（id/type/行号）
  mc tables <file> [--all]                                 列出已标记表 + 未标记表计数
  mc set <file> <name> <value> [--actor=...]               就地修改变量值（落 journal）
  mc add <file> <name> <value> [--type=TYPE] [--actor=...] 文件末尾新增变量（落 journal）
  mc comment <file> <target> <text> [--actor=...]          对块/变量添加评论（落 journal）
  mc comments <file> [--all]                               列出评论（默认仅未解决）
  mc resolve <file> <comment-id> [--actor=...]             标记评论已解决
  mc journal <file> [--tail=N]                             查看审计日志
  mc log <file> <text> [--target=...] [--actor=...]        追加一条审计记录
  mc init [dir]                                            初始化 .mc 日志目录
  mc version                                               版本信息

选项:
  --actor=human|agent    记录操作者（默认 agent）
  --order=declared       导出按声明顺序（默认 canonical 排序）
  --allow-override       同名变量后者覆盖（默认报错）
  --fingerprint          导出顶层带来源指纹 \$fingerprint（sha256/版本/时间），供过期门禁
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
  return { abs, source: fs.readFileSync(abs, "utf8") };
}

function printErrors(errors: McError[]): void {
  for (const e of errors) console.error(`${e.line}: ${e.message}`);
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
    outConfig = {
      $fingerprint: {
        source: path.basename(abs),
        sha256: hashOf(source),
        mcVersion: VERSION,
        generatedAt: new Date().toISOString(),
      },
      ...config,
    };
  }
  const out =
    flags.order === "declared" ? declaredOrderJson(outConfig) : canonicalJson(outConfig);
  process.stdout.write(out);
}

function cmdGet(pos: string[], _flags: Record<string, string | boolean>): void {
  const [file, name] = pos;
  if (!file || !name) fail("用法: mc get <file> <name>");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  const entry = res.entries.find((e) => e.name === name);
  if (!entry) fail(`未找到变量: ${name}`);
  const val = entry.kind === "table" ? entry.rows : entry.value;
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
  for (const e of res.errors) console.log(`${e.line}: ${e.message}`);
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

  const marked = res.entries.filter((e) => e.kind === "table");
  const gfm = res.blocks.filter((b) => b.type === "table");
  const covered = new Set<number>();
  const rows: Array<{ name: string; count: number; start: number; end: number }> = [];
  for (const t of marked) {
    // 已标记表的表头行 = open 标记行 + 1
    const bi = gfm.findIndex((b) => b.lines[0] === t.line + 1);
    if (bi >= 0) covered.add(bi);
    rows.push({
      name: t.name,
      count: t.kind === "table" ? t.rows.length : 0,
      start: t.line,
      end: bi >= 0 ? gfm[bi].lines[1] : t.line,
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

function cmdSet(pos: string[], flags: Record<string, string | boolean>): void {
  const [file, name, value] = pos;
  if (!file || !name || value === undefined) fail("用法: mc set <file> <name> <value>");
  const { abs, source } = load(file);
  const res = parseOrExit(abs, source);
  const entry = res.entries.find((e) => e.kind === "var" && e.name === name) as
    | VarEntry
    | undefined;
  if (!entry) fail(`未找到变量 ${name}（新增请用 mc add）`);
  if (value.includes("\n")) fail("set 暂不支持多行值");
  const newSource = source.slice(0, entry.valueStart) + value + source.slice(entry.valueEnd);
  fs.writeFileSync(abs, newSource, "utf8");
  appendOp(abs, {
    op: "update",
    actor: actorOf(flags),
    target: name,
    hash: hashOf(value),
    prev_hash: hashOf(entry.valueRaw),
    text: `set ${name} = ${value}`,
  });
  process.stdout.write(`${name} = ${value}\n`);
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
  fs.appendFileSync(abs, snippet, "utf8");
  appendOp(abs, {
    op: "create",
    actor: actorOf(flags),
    target: name,
    hash: hashOf(value),
    prev_hash: null,
    text: `add ${name} = ${value}`,
  });
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

function cmdInit(pos: string[]): void {
  const dir = pos[0] ? path.resolve(pos[0]) : process.cwd();
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
      cmdInit(pos);
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
