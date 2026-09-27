/** 值类型推断：声明类型优先，否则按 JSON 语法推断 */

export function inferValue(raw: string, declared?: string): { value: unknown; type: string } {
  const text = raw.trim();

  if (declared) {
    switch (declared) {
      case "string":
      case "text":
        return { value: text, type: declared };
      case "number": {
        if (text === "") throw new Error(`invalid number: "${text}"`);
        const n = Number(text);
        if (Number.isNaN(n)) throw new Error(`invalid number: "${text}"`);
        return { value: n, type: "number" };
      }
      case "int": {
        if (text === "") throw new Error(`invalid int: "${text}"`);
        const n = Number(text);
        if (Number.isNaN(n) || !Number.isInteger(n)) throw new Error(`invalid int: "${text}"`);
        return { value: n, type: "int" };
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

  // 自动推断：尝试按 JSON 语法解析
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
 * 解析 @array 值：以 `/` 分隔元素，逐元素 trim 后按声明类型或自动推断。
 * 空文本 → 空数组。元素本身含 `/` 时需用 type=json 并写 JSON 数组（见 SPEC）。
 */
export function parseArrayValue(
  raw: string,
  declared?: string,
): { value: unknown[]; type: "array" } {
  const text = raw.trim();
  if (text === "") return { value: [], type: "array" };
  const items = text.split("/").map((part) => inferValue(part.trim(), declared).value);
  return { value: items, type: "array" };
}

/**
 * 解析 @range 值：形如 `1~5`（支持全角 ～、允许 **bold** 包裹），
 * 读出为 { min: 1, max: 5 }。两端必须都是数字，否则 fail loud。
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
  const min = inferValue(parts[0], "number").value as number;
  const max = inferValue(parts[1], "number").value as number;
  return { value: { min, max }, type: "range" };
}
