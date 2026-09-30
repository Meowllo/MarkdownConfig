/**
 * 值类型推断：声明类型优先，否则按 JSON 语法推断。
 *
 * **本模块是"文本 → 值"的唯一入口**（`@var` 值、`@array` 元素、`@range` 两端、
 * 表格单元格、嵌套子区域全部经由 `inferValue`），所以两条全局不变式都放在这里：
 *   1. 解析结果里**不得出现内部占位符**（见 `PH`）；
 *   2. 百分号只认"落在值末尾"的那种写法（见 `percentToRatio`）。
 */

/**
 * 内部占位符（NUL）。它只在解析的**中间态**出现：`@array` 的嵌套子区域会先被替换成
 * `PH + 序号 + PH`，再按 `/` 切分，以便子区域不被 `/` 拆开。
 *
 * 它是内部实现细节，**绝不允许泄漏到解析结果里** —— 一旦泄漏，下游 `JSON.parse`
 * 拿到的是一个"看起来像数据"的字符串（含真 NUL），不报错、不告警，只是值不对，
 * 迁移期极难发现。守卫放在 `inferValue` 一处即可覆盖所有取值路径。
 */
export const PH = "\u0000";

/**
 * 百分数：`<数字>%`，且 `%` 必须落在**值的末尾**。
 * - `5%` → `0.05`；`5 %`（中间空白）也算 —— 数组的"整段单位"写法依赖这一点；
 * - `5%生命值` **不匹配**（`%` 后还有字符）→ 按普通文本走，读出字符串。
 */
const PERCENT_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*%$/;

/**
 * 百分数字面量 → 小数。不是百分数写法时返回 null。
 *
 * 精度说明：对 <2^53 的整数，`n / 100` 与十进制字面量 `0.0n` 是**同一个 double**
 * （两者都是同一个实数的正确舍入结果），所以 canonical JSON 字节稳定，
 * 不会冒出 `0.05000000000000001` 这种尾巴。
 */
export function percentToRatio(text: string): number | null {
  const m = PERCENT_RE.exec(text);
  if (!m) return null;
  return Number(m[1]) / 100;
}

export function inferValue(raw: string, declared?: string): { value: unknown; type: string } {
  const text = raw.trim();

  if (text.includes(PH)) {
    throw new Error(
      `值里出现了内部占位符（\\u0000）：${text.split(PH).join("«占位符»")}。这是解析缺陷，` +
        `请附上含该处的最小复现提 issue。`,
    );
  }

  if (declared) {
    switch (declared) {
      case "string":
      case "text":
        // 声明为字符串/文本时**不做**百分号转换：这是保留字面写的逃生口
        return { value: text, type: declared };
      case "number":
      case "int": {
        const ratio = percentToRatio(text);
        if (ratio !== null) {
          if (declared === "int" && !Number.isInteger(ratio)) {
            throw new Error(`invalid int: "${text}"（= ${ratio}，不是整数）`);
          }
          return { value: ratio, type: declared };
        }
        if (text === "") throw new Error(`invalid ${declared}: "${text}"`);
        const n = Number(text);
        if (Number.isNaN(n)) throw new Error(`invalid ${declared}: "${text}"`);
        if (declared === "int" && !Number.isInteger(n)) throw new Error(`invalid int: "${text}"`);
        return { value: n, type: declared };
      }
      case "boolean":
        if (text === "true") return { value: true, type: "boolean" };
        if (text === "false") return { value: false, type: "boolean" };
        throw new Error(`invalid boolean: "${text}"`);
      case "json":
        return { value: JSON.parse(text), type: "json" };
      default:
        throw new Error(`unknown type: ${declared}`);
    }
  }

  // 自动推断：先看是否是百分数（`%` 在末尾），再按 JSON 语法，最后落回字符串
  const ratio = percentToRatio(text);
  if (ratio !== null) return { value: ratio, type: "number" };

  try {
    const v = JSON.parse(text);
    const t =
      Array.isArray(v) || v === null || typeof v === "object"
        ? "json"
        : typeof v === "number"
          ? "number"
          : typeof v === "boolean"
            ? "boolean"
            : "string";
    return { value: v, type: t };
  } catch {
    // 不是合法 JSON → 视为字符串
  }
  return { value: text, type: "string" };
}

/**
 * 数组体的百分号归一化：把"整段单位"写法 `5/10/15 %` 改写成逐元素写法 `5%/10%/15%`，
 * 使下游只需处理一种形态（逐元素的 `%` 由 `inferValue` 处理）。
 *
 * 为什么必须给"混用"报错：`5/10%/15` 这种写法只有两种解释，静默选一种就等于制造
 * "看起来像数据"的错误结果（同 #16 的 D1 类问题）。
 *
 * @param elements 已按 `/` 切分并 trim 的元素。含**占位符**者（即嵌套子区域）视为
 *                 "非文本元素"：百分数只能作用于数字，与子区域共存即报错。
 */
export function normalizeArrayPercent(
  elements: string[],
): { elements: string[]; error?: string } {
  const isText = (e: string): boolean => !e.includes(PH);
  const last = elements.length > 0 ? elements[elements.length - 1] : "";

  // `%` 直接贴在嵌套 @array 后面（如 `5/<!--@array-->1/2<!--@/array--> %`）：
  // 按"标记外的文本 = 人读注释"这条规则它会被**静默丢掉**，而写的人显然是想表达单位。
  // 这种只能报错，不能猜。
  if (elements.some((e) => !isText(e) && /%\s*$/.test(e))) {
    return { elements, error: "% 只能作用于数字，不能贴在嵌套 @array 上" };
  }

  // 整段单位：末尾是一个**不与数字相连**的 `%`（`15 %`），与逐元素写法（`15%`）靠这层空白区分
  const whole = isText(last) && /\s%$/.test(last);
  const hasNonText = elements.some((e) => !isText(e));

  let out = elements;
  if (whole) {
    if (hasNonText) {
      return { elements, error: "整段百分数写法里不能含嵌套 @array（% 只能作用于数字）" };
    }
    const rest = elements.slice(0, -1);
    // 末尾那个 `%` 是"整段单位"，它本身不参与逐元素判定
    if (rest.some((e) => percentToRatio(e) !== null)) {
      return { elements, error: "百分号写法混用：整段 %（5/10/15 %）与逐元素 %（5%/10%）不能同时出现" };
    }
    // 剥掉整段单位 `%`，改写成逐元素写法，使下游只需处理一种形态
    out = rest.concat(last.replace(/\s*%$/, "").trim()).map((e) => `${e}%`);
  } else {
    const textCount = elements.filter(isText).length;
    const pctCount = elements.filter((e) => isText(e) && percentToRatio(e) !== null).length;
    if (pctCount === 0) return { elements };
    if (hasNonText) {
      return {
        elements,
        error: "百分数只能作用于数字，不能与嵌套 @array 混在同一个数组里",
      };
    }
    if (pctCount !== textCount) {
      return {
        elements,
        error: "百分号写法混用：数组里要么每个元素都带 %（5%/10%/15%），要么都不带（5/10/15）",
      };
    }
  }

  // 一旦进入百分数模式，每个文本元素都必须是"数字%"；否则 `a/b %` 会静默产出 `["a%","b%"]`
  const bad = out.find((e) => isText(e) && percentToRatio(e) === null);
  if (bad !== undefined) {
    return { elements, error: `百分数只能作用于数字，"${bad}" 不是数字` };
  }
  return { elements: out };
}

/**
 * 解析 @array 值：以 `/` 分隔元素，逐元素 trim 后按声明类型或自动推断。
 * 空文本 → 空数组。元素本身含 `/` 时需用 type=json 并写 JSON 数组（见 SPEC）。
 */
export function parseArrayValue(
  raw: string,
  declared?: string,
): { value: unknown[]; type: "array" } {
  const text = raw.trim();
  if (text === "") return { value: [], type: "array" };
  const plan = normalizeArrayPercent(text.split("/").map((p) => p.trim()));
  if (plan.error) throw new Error(plan.error);
  const items = plan.elements.map((el) => inferValue(el as string, declared).value);
  return { value: items, type: "array" };
}

/**
 * 解析 @range 值：形如 `1~5`（支持全角 ～、允许 **bold** 包裹），
 * 读出为 { min: 1, max: 5 }。两端必须都是数字，否则 fail loud。
 * 百分号：两端要么都带 `%`、要么都不带（同 @array 的"不做无理由猜测"原则）。
 */
export function parseRangeValue(raw: string): {
  value: { min: number; max: number };
  type: "range";
} {
  const text = raw.trim().replace(/\*\*/g, "").trim();
  const parts = text.split(/[~～]/).map((p) => p.trim());
  if (parts.length !== 2 || parts.some((p) => p === "")) {
    throw new Error(`invalid range: "${raw.trim()}"，需形如 1~5`);
  }
  const isPct = parts.map((p) => percentToRatio(p) !== null);
  if (isPct[0] !== isPct[1]) {
    throw new Error(
      `invalid range: "${raw.trim()}"，两端要么都带 %（1%~5%），要么都不带（1~5）`,
    );
  }
  const min = inferValue(parts[0], "number").value as number;
  const max = inferValue(parts[1], "number").value as number;
  return { value: { min, max }, type: "range" };
}
