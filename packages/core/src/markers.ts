/**
 * 标记词法与内联区域扫描（@var / @array / @range / @comment 的统一实现）
 *
 * 为什么单独一层：`@array` 支持嵌套后，"标记内的标记"不再能被正则直切，
 * 顶层扫描、表格单元格、数组元素三处都需要同一套"配对 + 递归"逻辑。
 * 本模块是**唯一实现**，其余模块只消费 scanMarkers() 的结果。
 */

import { inferValue, parseRangeValue } from "./infer";
import type { CommentEntry } from "./types";

export type MarkerKind = "var" | "array" | "range" | "comment";

export interface MarkerToken {
  open: boolean;
  kind: MarkerKind;
  /** 名称；无名（仅用于嵌套 @array）时为 undefined */
  ident?: string;
  /** @comment 的 target 属性 */
  target?: string;
  declared?: string;
  /** 标记完整区间 [start, end) */
  start: number;
  end: number;
}

export interface InlineIssue {
  /** 出问题的字符位置 */
  at: number;
  message: string;
  hint?: string;
}

export interface InlineRegion {
  kind: MarkerKind;
  ident?: string;
  declared?: string;
  /** 解析后的类型（var 为推断/声明结果，array/range 固定为自身） */
  type: string;
  value: unknown;
  /** 开标记区间 [start, end) */
  start: number;
  end: number;
  /** 值文本区间（开标记结束 → 关标记开始），供就地改写 */
  contentStart: number;
  contentEnd: number;
}

export interface ScanResult {
  regions: InlineRegion[];
  /** 评论（不含行号，由调用方补） */
  comments: ScannedComment[];
  issues: InlineIssue[];
}

/** 评论区域（行号由 scanner 补成 CommentEntry） */
export type ScannedComment = Omit<CommentEntry, "line">;

interface ArrayRead {
  region: InlineRegion;
  /** token 下标：紧邻匹配的关闭标记之后 */
  next: number;
  issues: InlineIssue[];
}

/**
 * 名称可省略（无名嵌套 @array）；@comment 用 target= 属性。
 * target 用 `[^>\n]+?` 且**非贪婪**：否则正文不含空格时会把 `-->` 一起吞掉，
 * 连关闭标记 `<!--@/comment-->` 也被吃掉（正文里没有空白就一路吃到底）。
 */
const TOKEN_RE =
  /<!--@comment(?:\s+target=([^>\n]+?))?\s*-->|<!--@(var|array|range)(?:\s+([A-Za-z_][\w.-]*))?(?:\s+type=([A-Za-z]+))?\s*-->|<!--@\/(var|array|range|comment)\s*-->/g;

/**
 * target 只要求"非空且不含空白"：变量名/表名是 ASCII，但 `表.id.列` 里的
 * id 与列名可以是中文，所以这里不做字符集限制；目标是否存在由 `mc comment` 校验。
 */
const TARGET_RE = /^\^?\S+$/;

/** 占位符：把已解析的嵌套区域替换成单个不可与正文混淆的元素，再按 `/` 切分 */
const PH = "\u0000";
const PH_RE = /^\u0000(\d+)\u0000$/;

const NEST_HINT =
  "正文里的标记会被当成真配置。若这只是一段说明或示例，请把它放进 ``` 围栏代码块。";

export function tokenize(src: string): MarkerToken[] {
  const out: MarkerToken[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    // 判别开/闭：只有关闭分支会用到 m[5]（开分支不会设置它）
    if (m[5] !== undefined) {
      out.push({
        open: false,
        kind: m[5] as MarkerKind,
        start: m.index,
        end: m.index + m[0].length,
      });
      continue;
    }
    const isComment = m[2] === undefined;
    out.push({
      open: true,
      kind: isComment ? "comment" : (m[2] as MarkerKind),
      ident: isComment ? undefined : m[3],
      target: isComment ? m[1] : undefined,
      declared: isComment ? undefined : m[4],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

function label(t: { kind: MarkerKind; ident?: string }): string {
  return `@${t.kind}${t.ident ? " " + t.ident : ""}`;
}

interface ArrayChild {
  start: number;
  end: number;
  value: unknown;
  ident?: string;
}

/**
 * 按数组体切分：文本段与 `/` 分隔的元素照常推断；
 * 具名子区域 → 对象元素 `{名: 值}`，无名子区域 → 裸子数组元素。
 *
 * 内外两个调用方共用这一处实现：
 * - 顶层/嵌套 `@array` 的标记之间（readArray）
 * - 表格单元格（整格即一个数组体）
 */
export function splitArrayBody(
  src: string,
  from: number,
  to: number,
  children: ArrayChild[],
  declared: string | undefined,
  issues: InlineIssue[],
  errAt: number,
  name = "",
): unknown[] {
  let body = src.slice(from, to);
  // 从右往左替换，保证前面的偏移不被改写
  for (let k = children.length - 1; k >= 0; k--) {
    const c = children[k];
    body = body.slice(0, c.start - from) + PH + k + PH + body.slice(c.end - from);
  }

  const value: unknown[] = [];
  const text = body.trim();
  if (text === "") return value;

  for (const rawEl of text.split("/")) {
    const el = rawEl.trim();
    const ph = el.match(PH_RE);
    if (ph) {
      const c = children[Number(ph[1])];
      value.push(c.ident ? { [c.ident]: c.value } : c.value);
      continue;
    }
    try {
      value.push(inferValue(el, declared).value);
    } catch (e) {
      issues.push({
        at: errAt,
        message: `${name ? name + " " : ""}元素解析失败：${(e as Error).message}`,
      });
    }
  }
  return value;
}

/** 递归解析一个 @array 区域（含其嵌套子数组） */
function readArray(src: string, tokens: MarkerToken[], openIdx: number): ArrayRead {
  const open = tokens[openIdx];
  const name = label(open);
  const issues: InlineIssue[] = [];
  const children: ArrayChild[] = [];
  let i = openIdx + 1;
  let closeStart = -1;
  let closeEnd = -1;

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.open) {
      if (t.kind === "array") {
        const sub = readArray(src, tokens, i);
        children.push({ start: t.start, end: sub.region.end, value: sub.region.value, ident: t.ident });
        issues.push(...sub.issues);
        i = sub.next;
        continue;
      }
      issues.push({
        at: t.start,
        message: `${name} 内不允许嵌套 @${t.kind}（数组内只支持嵌套 @array）`,
      });
      i++;
      continue;
    }
    if (t.kind === "array") {
      closeStart = t.start;
      closeEnd = t.end;
      break;
    }
    issues.push({ at: t.start, message: `${name} 内不应出现 <!--@/${t.kind}-->` });
    i++;
  }

  if (closeStart < 0) {
    issues.push({ at: open.start, message: `${name} 未闭合`, hint: NEST_HINT });
    return {
      region: {
        kind: "array",
        ident: open.ident,
        declared: open.declared,
        type: "array",
        value: [],
        start: open.start,
        end: open.end,
        contentStart: open.end,
        contentEnd: open.end,
      },
      next: tokens.length,
      issues,
    };
  }

  const contentStart = open.end;
  const contentEnd = closeStart;

  const seen = new Set<string>();
  for (const c of children) {
    if (!c.ident) continue;
    if (seen.has(c.ident)) {
      issues.push({ at: c.start, message: `${name} 内嵌套数组名重复：${c.ident}` });
    }
    seen.add(c.ident);
  }

  const value = splitArrayBody(
    src,
    contentStart,
    contentEnd,
    children,
    open.declared,
    issues,
    open.start,
    name,
  );

  return {
    region: {
      kind: "array",
      ident: open.ident,
      declared: open.declared,
      type: "array",
      value,
      start: open.start,
      end: closeEnd,
      contentStart,
      contentEnd,
    },
    next: i + 1,
    issues,
  };
}

/**
 * 扫描一段文本里的全部顶层标记区域。
 * @var/@range/@comment 不允许嵌套；@array 可嵌套 @array（递归解析）。
 */
export function scanMarkers(src: string): ScanResult {
  const tokens = tokenize(src);
  const regions: InlineRegion[] = [];
  const comments: ScannedComment[] = [];
  const issues: InlineIssue[] = [];

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (!t.open) {
      issues.push({
        at: t.start,
        message: `@${t.kind} 关闭标记缺少对应的开始标记`,
        hint: NEST_HINT,
      });
      i++;
      continue;
    }

    if (t.kind === "array") {
      const sub = readArray(src, tokens, i);
      regions.push(sub.region);
      issues.push(...sub.issues);
      i = sub.next;
      continue;
    }

    // @var / @range / @comment：下一个标记必须就是对应的关闭标记
    const close = tokens[i + 1];
    const name = label(t);
    if (!close || close.open) {
      issues.push({ at: t.start, message: `${name} 未闭合：内容里不允许嵌套其它标记`, hint: NEST_HINT });
      i++;
      continue;
    }
    if (close.kind !== t.kind) {
      issues.push({
        at: close.start,
        message: `${name} 的关闭标记错配（应为 <!--@/${t.kind}-->）`,
      });
      i++;
      continue;
    }

    const contentStart = t.end;
    const contentEnd = close.start;
    const raw = src.slice(contentStart, contentEnd);
    i += 2;

    if (t.kind === "comment") {
      const target = t.target;
      if (!target) {
        issues.push({
          at: t.start,
          message: "@comment 缺少 target（应写成 <!--@comment target=名字-->文本<!--@/comment-->）",
        });
        continue;
      }
      if (!TARGET_RE.test(target)) {
        issues.push({
          at: t.start,
          message: `@comment 的 target 非法：${target}（不能含空白；应为变量名 / 表名 / 表.id[.列] / 块 id）`,
        });
        continue;
      }
      if (raw.trim() === "") {
        issues.push({ at: t.start, message: "@comment 的评论内容为空" });
        continue;
      }
      comments.push({
        target: target.replace(/^\^/, ""),
        text: raw.trim(),
        start: t.start,
        end: close.end,
      });
      continue;
    }

    try {
      if (t.kind === "var") {
        if (raw.includes("\n") && t.declared !== "json" && t.declared !== "text") {
          issues.push({
            at: t.start,
            message: `${name} 的值含换行，需声明 type=json 或 type=text`,
          });
        } else {
          const { value, type } = inferValue(raw, t.declared);
          regions.push({
            kind: "var",
            ident: t.ident,
            declared: t.declared,
            type,
            value,
            start: t.start,
            end: close.end,
            contentStart,
            contentEnd,
          });
        }
      } else {
        if (raw.includes("\n")) {
          issues.push({ at: t.start, message: `${name} 必须写在一行（形如 1~5）` });
        } else {
          regions.push({
            kind: "range",
            ident: t.ident,
            declared: t.declared,
            type: "range",
            value: parseRangeValue(raw).value,
            start: t.start,
            end: close.end,
            contentStart,
            contentEnd,
          });
        }
      }
    } catch (e) {
      issues.push({ at: t.start, message: `${name}: ${(e as Error).message}` });
    }
  }

  return { regions, comments, issues };
}
