/**
 * MarkdownConfig 核心 SDK 公共入口。
 *
 * 下游应当优先使用两条**稳定**通路，而不是自己拼 `mc export` + JSON 处理：
 *   - 读：`open()` → `McDoc`（见 `reader.ts`）。表永远是"行对象数组"，
 *     导出格式再变也不影响下游代码；
 *   - 写：`emitTsModule()`（见 `codegen.ts`）。声明式产出确定性代码，不手写字符串拼接。
 * CLI 与 SDK 是同一份实现的两个入口，行为必然一致。
 */

import { appendComment, COMMENT_HEADING, commentMarkup, removeCommentAt } from "./comments";
import { buildConfig, canonicalJson, declaredOrderJson, sortKeys } from "./config";
import { emitTsModule } from "./codegen";
import { hashOfSource, makeFingerprint, sha256File } from "./fingerprint";
import { inferValue, parseArrayValue, parseRangeValue } from "./infer";
import { scanMarkers, tokenize } from "./markers";
import { fromSource, McConfigError, McDoc, open } from "./reader";
import { lastHeadingTitle, parse } from "./scanner";
import { parseTable } from "./table";
import { VERSION } from "./version";

/** 便捷入口：读取 .mc 文件 → 配置对象（含校验结果） */
export function loadConfig(
  file: string,
  opts: { allowOverride?: boolean } = {},
): {
  config: Record<string, unknown>;
  errors: Array<{ line: number; message: string }>;
  parseErrors: Array<{ line: number; message: string }>;
  blocks: ReturnType<typeof parse>["blocks"];
  entries: ReturnType<typeof parse>["entries"];
  comments: ReturnType<typeof parse>["comments"];
} {
  const doc = open(file, opts);
  return {
    config: doc.raw,
    errors: doc.configErrors,
    parseErrors: doc.errors,
    blocks: doc.blocks,
    entries: doc.entries,
    comments: doc.comments,
  };
}

export {
  appendComment,
  buildConfig,
  canonicalJson,
  COMMENT_HEADING,
  commentMarkup,
  declaredOrderJson,
  emitTsModule,
  fromSource,
  hashOfSource,
  inferValue,
  lastHeadingTitle,
  makeFingerprint,
  McConfigError,
  McDoc,
  open,
  parse,
  parseArrayValue,
  parseRangeValue,
  parseTable,
  removeCommentAt,
  scanMarkers,
  sha256File,
  sortKeys,
  tokenize,
  VERSION,
};
export type { ConstDecl, EmitOptions } from "./codegen";
export type { Fingerprint } from "./fingerprint";
export type { McRow, McTable } from "./reader";
export type {
  ArrayEntry,
  Block,
  CommentEntry,
  ConfigEntry,
  McError,
  ParseResult,
  RangeEntry,
  TableCellPos,
  TableEntry,
  TableRowPos,
  VarEntry,
  VarResolvedType,
} from "./types";
export type {
  InlineIssue,
  InlineRegion,
  MarkerKind,
  MarkerToken,
  ScanResult,
  ScannedComment,
} from "./markers";
