/** 用 esbuild 把 markdownconfig 内联进 out/extension.js（唯一运行时依赖 vscode） */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(root, "src", "extension.ts")],
  outfile: path.join(root, "out", "extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  logLevel: "info",
});
