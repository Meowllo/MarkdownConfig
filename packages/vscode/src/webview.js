/**
 * MarkdownConfig 文档模式（Webview）：渲染 .mc 为文档，点击块就地编辑（原始 markdown 行），保存回写源文件
 * 由 esbuild 打包为 out/webview.js（含 markdown-it 与 core 扫描器，无 node 依赖）
 */
import MarkdownIt from "markdown-it";
import { parse } from "@markdownconfig/core/dist/scanner.js";
import { preprocessForRender } from "./render-preprocess";

const root = document.getElementById("root");
const errorsEl = document.getElementById("errors");

// 初始占位：脚本未运行 / 运行中 / 失败时都可见，杜绝"纯空白"。
if (root) {
  root.textContent = "打开一个 .mc 文件后，使用「MarkdownConfig: 在文档模式中打开」";
}

let vscode = null;
let md = null;
let source = "";
let rawLines = [];
let lastRender = { source: "", errors: [] };
let editing = false;

// 运行时错误上报到扩展（最先注册，确保初始化异常也不丢失）
window.addEventListener("error", (e) => {
  try {
    if (vscode) {
      vscode.postMessage({ type: "error", message: String((e && e.message) || e) });
    }
  } catch {
    /* 忽略 */
  }
});

function render(data) {
  if (editing) return; // 用户正在编辑块时不打断
  lastRender = data;
  source = data.source;
  rawLines = source.split("\n");

  const errs = data.errors ?? [];
  if (errs.length > 0) {
    errorsEl.style.display = "block";
    errorsEl.textContent = "校验错误：" + errs.map((e) => `L${e.line} ${e.message}`).join("；");
  } else {
    errorsEl.style.display = "none";
  }

  let res;
  try {
    res = parse(source);
  } catch (err) {
    errorsEl.style.display = "block";
    errorsEl.textContent = "解析失败：" + String((err && err.message) || err);
    return;
  }
  if (res.blocks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mc-empty";
    empty.textContent = "文档为空或暂无可渲染块";
    root.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const b of res.blocks) {
    const raw = rawLines.slice(b.lines[0] - 1, b.lines[1]).join("\n");
    const html = md.render(preprocessForRender(raw));
    const div = document.createElement("div");
    div.className = "mc-block";
    div.dataset.start = String(b.lines[0]);
    div.dataset.end = String(b.lines[1]);
    if (b.id) div.dataset.id = b.id;
    div.innerHTML = html;

    const btn = document.createElement("button");
    btn.className = "mc-edit-btn";
    btn.textContent = b.id ? `编辑块（${b.id}）` : "编辑块";
    btn.addEventListener("click", () => startEdit(div));
    div.appendChild(btn);
    frag.appendChild(div);
  }
  root.replaceChildren(frag);
}

function startEdit(div) {
  if (editing) return;
  editing = true;
  const start = Number(div.dataset.start);
  const end = Number(div.dataset.end);
  const raw = rawLines.slice(start - 1, end).join("\n");

  div.classList.add("editing");
  div.innerHTML = "";
  const ta = document.createElement("textarea");
  ta.className = "mc-edit";
  ta.value = raw;
  ta.spellcheck = false;

  const footer = document.createElement("div");
  footer.className = "mc-edit-footer";
  const save = document.createElement("button");
  save.textContent = "保存";
  const cancel = document.createElement("button");
  cancel.textContent = "取消";
  footer.append(save, cancel);
  div.append(ta, footer);
  ta.focus();

  const close = (ok) => {
    editing = false;
    if (ok) {
      vscode.postMessage({ type: "edit", start, end, text: ta.value });
      div.classList.remove("editing");
      div.innerHTML = "";
      div.textContent = "保存中…";
    } else {
      div.classList.remove("editing");
      render(lastRender);
    }
  };
  save.addEventListener("click", () => close(true));
  cancel.addEventListener("click", () => close(false));
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      close(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    }
  });
}

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg && msg.type === "render") render(msg);
});

function boot() {
  vscode = acquireVsCodeApi();
  md = new MarkdownIt({ html: true, linkify: true });
  // 就绪握手：webview 加载完成后请求首帧渲染（避免 postMessage 早于监听器注册而丢失）
  vscode.postMessage({ type: "ready" });
}

try {
  boot();
} catch (err) {
  const text = "文档模式初始化失败：" + String((err && err.message) || err);
  if (root) root.textContent = text;
  try {
    if (vscode) {
      vscode.postMessage({ type: "error", message: String((err && err.stack) || err) });
    }
  } catch {
    /* 忽略 */
  }
}
