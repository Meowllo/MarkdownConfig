/**
 * 来源指纹（`$fingerprint`）的**唯一实现**。
 *
 * 为什么要一个模块：CLI（`mc export --fingerprint`）与 SDK（`McDoc.fingerprint()`）
 * 必须给出**完全相同**的哈希，否则下游的"产物是否过期"门禁会两套算法打架。
 *
 * 两个哈希，含义不同，别混：
 *   - `sha256`     = `sha256(JSON.stringify(源文本))` —— **源文本**的哈希（历史上的默认指纹）
 *   - `sha256File` = 文件**字节**的哈希 —— 可直接用 `shasum -a 256 <file>` 复算
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { VERSION } from "./version";

export interface Fingerprint {
  /** 来源文件名（basename）；内存文档为占位名 */
  source: string;
  /** 源文本哈希：sha256(JSON.stringify(source)) */
  sha256: string;
  /**
   * 文件字节哈希：可直接 `shasum -a 256` 复算。
   * **仅当文档确实从磁盘读出时才有**；`fromSource()` 的内存文档不写这个字段
   * （否则它描述的是磁盘旧内容而不是你手上这份，用来做"产物过期"门禁会误判）。
   */
  sha256File?: string;
  /** 产出该指纹的工具版本 */
  mcVersion: string;
  /** 生成时间；`timestamp: false` 时不写（保证输出字节可复现） */
  generatedAt?: string;
}

/** 源文本指纹：sha256(JSON.stringify(源文本))。注意不是文件字节。 */
export function hashOfSource(source: string): string {
  return crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

/** 文件字节的 sha256（hex） */
export function sha256File(abs: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

/**
 * 组装指纹。
 * @param fileBytes 是否附带文件字节哈希（默认 true）；文档来自内存时传 false，
 *        这样不会把一个"与手上内容不符的盘上哈希"混进产物。
 */
export function makeFingerprint(
  abs: string,
  source: string,
  opts: { timestamp?: boolean; fileBytes?: boolean } = {},
): Fingerprint {
  const fp: Fingerprint = {
    source: path.basename(abs),
    sha256: hashOfSource(source),
    mcVersion: VERSION,
  };
  if (opts.fileBytes !== false) fp.sha256File = sha256File(abs);
  if (opts.timestamp !== false) fp.generatedAt = new Date().toISOString();
  return fp;
}
