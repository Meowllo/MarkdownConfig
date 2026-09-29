/**
 * 评论区：评论就是正文里的一段标记区域，**不存在额外文件**。
 *
 * 约定（见 SPEC §5）：
 * - 所有评论集中放在文档末尾的「评论」区块（`## 评论`），但位置不做强制校验；
 * - 一条评论 = `<!--@comment target=目标-->文本<!--@/comment-->`，只含目标与文本；
 * - 允许多条评论指向同一个目标（各自独立，不冲突）；
 * - **append-only**：新增只追加到最后一条评论之后；`resolve` 即删除该条。
 *
 * 本模块是"改正文"的唯一实现：CLI 与编辑器共用。
 */

import { scanMarkers } from "./markers";
import { lastHeadingTitle } from "./scanner";

/** 评论区标题（约定；重命名只会让 `mc comment` 再建一个区块，不影响解析） */
export const COMMENT_HEADING = "评论";

/** 一条评论的标记文本 */
export function commentMarkup(target: string, text: string): string {
  return `<!--@comment target=${target}-->${text}<!--@/comment-->`;
}

/**
 * 追加一条评论（append-only）：
 * - 已有评论 → 接在最后一条之后；
 * - 没有评论 → 追加到文件末尾；若文末不是「评论」区块，先补 `## 评论` 标题。
 */
export function appendComment(source: string, target: string, text: string): string {
  const { comments } = scanMarkers(source);
  const marker = commentMarkup(target, text);

  if (comments.length > 0) {
    const last = comments[comments.length - 1];
    const head = source.slice(0, last.end).replace(/\s*$/, "");
    const tail = source
      .slice(last.end)
      .replace(/^\s*/, "")
      .replace(/\s*$/, "");
    return head + "\n\n" + marker + (tail ? "\n\n" + tail + "\n" : "\n");
  }

  const body = source.replace(/\s*$/, "");
  const area = lastHeadingTitle(source) === COMMENT_HEADING ? "" : `## ${COMMENT_HEADING}\n\n`;
  return body + (body ? "\n\n" : "") + area + marker + "\n";
}

/**
 * 删除第 index 条评论（1-based，按文档出现顺序）——`mc resolve` 的语义。
 * 连同该评论所在整行与紧随其后的空行一起删，避免残留连续空行。
 */
export function removeCommentAt(source: string, index: number): string {
  const { comments } = scanMarkers(source);
  const c = comments[index - 1];
  if (!c) {
    throw new Error(`没有第 ${index} 条评论（本文件共 ${comments.length} 条）`);
  }

  // 该评论所在行若只有空白前缀，则连整行一起删
  let start = c.start;
  const lineStart = source.lastIndexOf("\n", c.start - 1) + 1;
  if (source.slice(lineStart, c.start).trim() === "") start = lineStart;

  // 吃掉该行剩余部分（含换行）
  let end = c.end;
  while (end < source.length && source[end] !== "\n") end++;
  if (end < source.length) end++;

  // 再吃掉紧随其后的空行
  for (;;) {
    const m = source.slice(end).match(/^[ \t]*\r?\n/);
    if (!m) break;
    end += m[0].length;
  }

  return source.slice(0, start) + source.slice(end);
}
