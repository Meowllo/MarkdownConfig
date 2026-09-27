/** 配置组装：点号命名空间嵌套、重复/冲突检测、canonical 输出 */

import type { McError, ParseResult } from "./types";

export function buildConfig(
  result: ParseResult,
  opts: { allowOverride?: boolean } = {},
): { config: Record<string, unknown>; errors: McError[] } {
  const errors: McError[] = [];
  const ordered = [...result.entries].sort((a, b) => a.line - b.line);
  const root: Record<string, unknown> = {};

  const setPath = (name: string, value: unknown, line: number): void => {
    const parts = name.split(".");
    let node = root;
    for (let k = 0; k < parts.length; k++) {
      const key = parts[k];
      const last = k === parts.length - 1;
      const existing = node[key];
      if (last) {
        if (existing !== undefined) {
          if (opts.allowOverride) {
            node[key] = value;
            return;
          }
          errors.push({ line, message: `变量 ${name} 重复声明（--allow-override 可后者覆盖）` });
          return;
        }
        node[key] = value;
        return;
      }
      if (existing === undefined) {
        const next: Record<string, unknown> = {};
        node[key] = next;
        node = next;
        continue;
      }
      if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
        node = existing as Record<string, unknown>;
        continue;
      }
      errors.push({
        line,
        message: `命名冲突：${name} 与标量 ${parts.slice(0, k + 1).join(".")} 冲突`,
      });
      return;
    }
  };

  for (const e of ordered) {
    if (e.kind === "var") setPath(e.name, e.value, e.line);
    else if (e.kind === "array") setPath(e.name, e.value, e.line);
    else setPath(e.name, e.rows, e.line);
  }
  return { config: root, errors };
}

/** 键名递归排序（canonical） */
export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** canonical JSON：键名排序、2 空格缩进、字节稳定 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

/** 声明顺序 JSON（非 canonical，仅供人类阅读） */
export function declaredOrderJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
