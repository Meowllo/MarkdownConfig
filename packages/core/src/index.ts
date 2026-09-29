/** MarkdownConfig 核心 SDK 公共入口 */

import * as fs from "fs";
import { appendComment, COMMENT_HEADING, commentMarkup, removeCommentAt } from "./comments";
import { buildConfig, canonicalJson, declaredOrderJson, sortKeys } from "./config";
import { inferValue, parseArrayValue, parseRangeValue } from "./infer";
import { scanMarkers, tokenize } from "./markers";
import { lastHeadingTitle, parse } from "./scanner";
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
  comments: ReturnType<typeof parse>["comments"];
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
    comments: result.comments,
  };
}

export {
  appendComment,
  buildConfig,
  canonicalJson,
  COMMENT_HEADING,
  commentMarkup,
  declaredOrderJson,
  inferValue,
  lastHeadingTitle,
  parse,
  parseArrayValue,
  parseRangeValue,
  parseTable,
  removeCommentAt,
  scanMarkers,
  sortKeys,
  tokenize,
};
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
