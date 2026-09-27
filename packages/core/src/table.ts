/** GFM 子集表格解析：表头 = 键，单元格类型自动推断，空单元格 → null */

import { inferValue } from "./infer";

export function parseTable(
  lines: string[],
): { rows: Record<string, unknown>[]; error?: string } {
  const clean = lines.filter((l) => l.trim() !== "");
  if (clean.length < 2) {
    return { rows: [], error: "表格需要表头行和分隔行" };
  }

  const split = (line: string): string[] => {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  };

  const header = split(clean[0]);
  const sep = split(clean[1]);
  if (sep.length === 0 || !sep.every((c) => /^:?-{1,}:?$/.test(c))) {
    return { rows: [], error: "第二行必须是分隔行（如 | --- | --- |）" };
  }
  if (new Set(header).size !== header.length) {
    return { rows: [], error: "表头列名重复" };
  }

  const rows: Record<string, unknown>[] = [];
  for (let i = 2; i < clean.length; i++) {
    const cells = split(clean[i]);
    if (cells.length !== header.length) {
      return {
        rows: [],
        error: `第 ${i + 1} 行有 ${cells.length} 个单元格，表头为 ${header.length} 个`,
      };
    }
    const row: Record<string, unknown> = {};
    header.forEach((h, j) => {
      const cell = cells[j];
      row[h] = cell === "" ? null : inferValue(cell).value;
    });
    rows.push(row);
  }
  return { rows };
}
