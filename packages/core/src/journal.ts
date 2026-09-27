/** journal：append-only 审计日志（文本为真相，op 只留痕） */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { sortKeys } from "./config";
import type { JournalOp } from "./types";

/** 向上查找 .mc/ 目录；找不到返回 null */
export function findJournalDir(filePath: string): string | null {
  let dir = path.dirname(path.resolve(filePath));
  for (;;) {
    const candidate = path.join(dir, ".mc");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 确保 journal 目录存在（就近创建于文件所在目录） */
export function ensureJournalDir(filePath: string): string {
  const found = findJournalDir(filePath);
  if (found) return found;
  const jdir = path.join(path.dirname(path.resolve(filePath)), ".mc");
  fs.mkdirSync(jdir, { recursive: true });
  return jdir;
}

function journalFile(jdir: string): string {
  return path.join(jdir, "journal.jsonl");
}

/** sha256（canonical JSON 表示） */
export function hashOf(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(sortKeys(value))).digest("hex");
}

/** 相对 journal 目录的文件标识（POSIX 分隔符） */
function relFile(jdir: string, filePath: string): string {
  return path.relative(jdir, path.resolve(filePath)).split(path.sep).join("/");
}

/** 追加一条 op（自动补 ts/file） */
export function appendOp(
  filePath: string,
  op: Omit<JournalOp, "ts" | "file"> & { file?: string },
): JournalOp {
  const jdir = ensureJournalDir(filePath);
  const full: JournalOp = {
    ...op,
    ts: new Date().toISOString(),
    file: op.file ?? relFile(jdir, filePath),
  };
  fs.appendFileSync(journalFile(jdir), JSON.stringify(full) + "\n", "utf8");
  return full;
}

/** 某 target 上一条 op 的 hash（用于串链） */
export function prevHash(filePath: string, target: string): string | null {
  const ops = readOps(filePath);
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].target === target && ops[i].hash) return ops[i].hash as string;
  }
  return null;
}

/** 读取某文件全部 op */
export function readOps(filePath: string): JournalOp[] {
  const jdir = findJournalDir(filePath);
  if (!jdir) return [];
  const jf = journalFile(jdir);
  if (!fs.existsSync(jf)) return [];
  const want = relFile(jdir, filePath);
  return fs
    .readFileSync(jf, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as JournalOp;
      } catch {
        return null;
      }
    })
    .filter((x): x is JournalOp => x !== null)
    .filter((op) => op.file === want);
}

/** 全部评论（含状态折叠） */
export function allComments(filePath: string): JournalOp[] {
  const ops = readOps(filePath);
  const status = new Map<string, string>();
  const comments: JournalOp[] = [];
  for (const op of ops) {
    if (op.op === "comment" && op.id) {
      status.set(op.id, op.status ?? "open");
      comments.push({ ...op, status: status.get(op.id) });
    } else if (op.op === "resolve" && op.target) {
      status.set(op.target, "resolved");
      for (const c of comments) if (c.id === op.target) c.status = "resolved";
    }
  }
  return comments;
}

/** 未解决评论 */
export function openComments(filePath: string): JournalOp[] {
  return allComments(filePath).filter((c) => c.status === "open");
}

/** 生成不冲突的评论 id */
export function nextCommentId(filePath: string): string {
  const existing = new Set(allComments(filePath).map((c) => c.id));
  let n = 1;
  while (existing.has(`c-${n}`)) n++;
  return `c-${n}`;
}
