/** 用 esbuild 打包 webview（浏览器环境，内联 markdown-it + core 扫描器） */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [path.join(root, "src", "webview.js")],
  outfile: path.join(root, "out", "webview.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  logLevel: "info",
});
