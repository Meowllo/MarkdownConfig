/** MarkdownConfig 核心 SDK 公共入口 */

import * as fs from "fs";
import { buildConfig, canonicalJson, declaredOrderJson, sortKeys } from "./config";
import { inferValue, parseArrayValue, parseRangeValue } from "./infer";
import {
  allComments,
  appendOp,
  ensureJournalDir,
  findJournalDir,
  hashOf,
  nextCommentId,
  openComments,
  prevHash,
  readOps,
} from "./journal";
import { scanMarkers, tokenize } from "./markers";
import { parse } from "./scanner";
import { parseTable } from "./table";

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
} {
  const source = fs.readFileSync(file, "utf8");
  const result = parse(source);
  const { config, errors } = buildConfig(result, opts);
  return {
    config,
    errors,
    parseErrors: result.errors,
    blocks: result.blocks,
    entries: result.entries,
  };
}

export {
  allComments,
  appendOp,
  buildConfig,
  canonicalJson,
  declaredOrderJson,
  ensureJournalDir,
  findJournalDir,
  hashOf,
  inferValue,
  nextCommentId,
  openComments,
  parse,
  parseArrayValue,
  parseRangeValue,
  parseTable,
  prevHash,
  readOps,
  scanMarkers,
  sortKeys,
  tokenize,
};
export type {
  ArrayEntry,
  Block,
  ConfigEntry,
  JournalOp,
  JournalOpType,
  McError,
  ParseResult,
  RangeEntry,
  TableCellPos,
  TableEntry,
  TableRowPos,
  VarEntry,
  VarResolvedType,
} from "./types";
export type { InlineIssue, InlineRegion, MarkerKind, MarkerToken, ScanResult } from "./markers";
