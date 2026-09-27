/** 黄金语料生成：由规范实现（参考实现）重新生成所有期望 JSON */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig, canonicalJson, parse } from "../packages/core/dist/index.js";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "core",
  "test",
  "fixtures",
);

let n = 0;
for (const f of fs.readdirSync(fixtures).sort()) {
  if (!f.endsWith(".mc") || f.startsWith("invalid")) continue;
  const source = fs.readFileSync(path.join(fixtures, f), "utf8");
  const res = parse(source);
  if (res.errors.length > 0) {
    console.error(`跳过（有错误）: ${f}`);
    continue;
  }
  const { config, errors } = buildConfig(res);
  if (errors.length > 0) {
    console.error(`跳过（组装错误）: ${f}`);
    continue;
  }
  fs.writeFileSync(path.join(fixtures, f.replace(/\.mc$/, ".json")), canonicalJson(config));
  n++;
}
console.log(`已重新生成 ${n} 个黄金语料期望文件`);
