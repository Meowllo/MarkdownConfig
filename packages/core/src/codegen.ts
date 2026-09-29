/**
 * 声明式代码发射器 —— 把"配置数据 → 代码"这一步收归工具，下游不写字符串拼接。
 *
 * ## 为什么存在
 * 下游原先这样产出配置模块：
 *   `L.push('export const MAX_WEAPONS = ' + MAX_WEAPONS + ';')`
 * 手工拼字符串会丢引号转义、丢类型、丢注释、还会因拼接顺序不同产出不稳定字节。
 * 本模块把这件事变成**声明**：给名字 + 值 + 可选注释，输出确定性文本。
 *
 * ## 确定性（硬要求）
 * 同样的输入必然产出**逐字节相同**的输出，这样下游才能用 `--check` 做"产物是否过期"门禁。
 * 因此：不写时间戳（除非显式给出 `fingerprint.generatedAt`）、不依赖字典序巧合、缩进固定。
 *
 * ## 与其他部分的分工
 *   - 读：`reader.ts` 的 `McDoc`（稳定形状）；
 *   - 写：本模块（确定性文本）；
 *   - **领域语义**（中文名映射、跨表校验、"两组并一组"这类设计规则）仍由下游写 ——
 *     那不是胶水，是业务规则，工具不该也不可能内置。
 */

import type { Fingerprint } from "./fingerprint";

export interface ConstDecl {
  /** 导出名；必须是合法标识符 */
  name: string;
  /** 声明值；与 `literal` 二选一 */
  value?: unknown;
  /**
   * 直接给定字面量文本（与 `value` 二选一）。
   * 用于需要多行排版、`as const`、或工具表达不了的形状 —— 逃生口，用它就不再享受自动转义。
   */
  literal?: string;
  /** TS 类型标注（如 `number[]`）；缺省保守推断（只有"同质标量数组"会加标注） */
  type?: string;
  /** JSDoc；字符串数组即多行 */
  doc?: string | string[];
}

export interface EmitOptions {
  /** 生成物的一句话说明 */
  title?: string;
  /** 数据来源，如 `docs/装备设计.mc` */
  source?: string;
  /** 生成器脚本，如 `scripts/gen-equip-config.mjs` */
  generator?: string;
  /** 追加的横幅行（原样写进顶部注释块） */
  banner?: string[];
  /**
   * 来源指纹：给出后自动导出 `SOURCE_SHA256` 与 `SOURCE_MC_VERSION` 两个常量，
   * 供下游做"产物是否与 .mc 一致"的离线门禁。传 `null` / 缺省则不导出。
   */
  fingerprint?: Fingerprint | null;
  /** 主体常量，按数组顺序输出 */
  consts: ConstDecl[];
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
/** 超过这个长度且是复合值 → 换多行，避免一行几千字符 */
const PRETTY_THRESHOLD = 100;
const INDENT = "    ";

function assertIdent(name: string, where: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`${where}：\`${name}\` 不是合法的 JS 标识符`);
  }
}

/** 保守类型推断：只有"同一标量类型的数组"才加标注，其余交给 TS 自己推 */
export function inferType(v: unknown): string | undefined {
  if (!Array.isArray(v)) return undefined;
  if (v.length === 0) return undefined;
  const kinds = new Set(
    v.map((x) => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x)),
  );
  if (kinds.size !== 1) return undefined;
  const k = [...kinds][0];
  if (k === "array") return undefined; // 嵌套数组交给 TS 推，标错反而更糟
  if (k === "number" || k === "string" || k === "boolean") return `${k}[]`;
  return undefined;
}

/** 值 → TS 字面量文本（复合且过长时换行；缩进由 base 决定） */
function literalOf(v: unknown, base: string): string {
  const compact = JSON.stringify(v);
  if (compact === undefined) {
    throw new Error(`无法序列化的值（${typeof v}）—— 请改用 literal 显式给出文本`);
  }
  if ((Array.isArray(v) || (v !== null && typeof v === "object")) && compact.length > PRETTY_THRESHOLD) {
    return JSON.stringify(v, null, INDENT)
      .split("\n")
      .map((line, i) => (i === 0 ? line : base + line))
      .join("\n");
  }
  return compact;
}

function docBlock(doc: string | string[] | undefined, indent: string): string[] {
  if (!doc) return [];
  const lines = Array.isArray(doc) ? doc : [doc];
  if (lines.length === 1 && lines[0] === "") return [];
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [`${indent}/**`, ...lines.map((l) => `${indent} *${l ? " " + l : ""}`), `${indent} */`];
}

/** 一组常量声明 → 模块文本（确定性；末尾恰好一个换行） */
export function emitTsModule(opts: EmitOptions): string {
  const out: string[] = [];

  // ---- 顶部注释块：说明 + 来源 + 生成器 + "派生物"提醒 ----
  const head: string[] = [];
  if (opts.title) head.push(opts.title);
  if (opts.source) head.push("", `来源：\`${opts.source}\``);
  if (opts.generator) head.push(`生成器：\`${opts.generator}\``);
  if (head.length > 0) {
    head.push("", "改数值 ⇒ 改 .mc，然后跑一次生成器；本文件是**派生物、不是第二个来源**。");
  }
  for (const b of opts.banner ?? []) head.push("", b);
  if (head.length > 0) {
    out.push("/**", ...head.map((l) => (l ? ` * ${l}` : " *")), " */", "");
  }

  // ---- 指纹常量 ----
  if (opts.fingerprint) {
    out.push(
      "/** 来源指纹（源文本的 sha256）—— 离线门禁用它核对「生成物是否过期」 */",
      `export const SOURCE_SHA256 = ${JSON.stringify(opts.fingerprint.sha256)};`,
      "/** 生成时用的 mc 版本 —— 便于发现「生成物是旧版工具产出的」 */",
      `export const SOURCE_MC_VERSION = ${JSON.stringify(opts.fingerprint.mcVersion)};`,
      "",
    );
  }

  // ---- 主体 ----
  for (const c of opts.consts) {
    assertIdent(c.name, "常量名");
    if (c.value === undefined && c.literal === undefined) {
      throw new Error(`常量 \`${c.name}\`：必须给出 value 或 literal`);
    }
    if (c.value !== undefined && c.literal !== undefined) {
      throw new Error(`常量 \`${c.name}\`：value 与 literal 只能给一个`);
    }
    out.push(...docBlock(c.doc, ""));
    const type = c.type ?? (c.value !== undefined ? inferType(c.value) : undefined);
    const literal = c.literal ?? literalOf(c.value, "");
    out.push(`export const ${c.name}${type ? `: ${type}` : ""} = ${literal};`, "");
  }

  return out.join("\n").replace(/\n+$/, "\n");
}
