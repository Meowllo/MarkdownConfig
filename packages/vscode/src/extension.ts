/** MarkdownConfig VS Code 扩展：入口 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { appendComment, buildConfig, canonicalJson, parse, removeCommentAt } from "markdownconfig";
import { CommentsProvider, McCommentNode } from "./comments";
import { assignBlockId, computeHighlights, findTargetForSelection, hoverAt, isMcFile } from "./pure";

const VALUE_COLOR = "#2E86DE";
const MARKER_COLOR = "#8A97A5";
const COMMENT_COLOR = "#B7791F";

export function activate(context: vscode.ExtensionContext): void {
  // ---- 装饰：config 值蓝色高亮 + 标记灰色 + 评论正文琥珀色（主题无关）----
  const valueType = vscode.window.createTextEditorDecorationType({
    color: VALUE_COLOR,
    fontWeight: "600",
  });
  const markerType = vscode.window.createTextEditorDecorationType({
    color: MARKER_COLOR,
    fontStyle: "italic",
  });
  const commentType = vscode.window.createTextEditorDecorationType({
    color: COMMENT_COLOR,
    fontStyle: "italic",
  });
  context.subscriptions.push(valueType, markerType, commentType);

  let timer: NodeJS.Timeout | undefined;
  const updateDecorations = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || !isMcFile(editor.document.fileName)) return;
    const source = editor.document.getText();
    const ranges = computeHighlights(source);
    const apply = (type: vscode.TextEditorDecorationType, kind: string): void => {
      editor.setDecorations(
        type,
        ranges
          .filter((r) => r.kind === kind)
          .map(
            (r) =>
              new vscode.Range(
                editor.document.positionAt(r.start),
                editor.document.positionAt(r.end),
              ),
          ),
      );
    };
    apply(valueType, "value");
    apply(markerType, "marker");
    apply(commentType, "comment");
  };
  const schedule = (editor: vscode.TextEditor | undefined): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      updateDecorations(editor);
    }, 250);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => updateDecorations(e)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) schedule(editor);
    }),
  );
  updateDecorations(vscode.window.activeTextEditor);

  // ---- 评论树 ----
  const commentsProvider = new CommentsProvider();
  const refreshComments = (): void => commentsProvider.refresh();
  context.subscriptions.push(
    vscode.window.createTreeView("mcComments", { treeDataProvider: commentsProvider }),
  );

  // ---- hover：显示变量名 / 类型 / 值 ----
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("markdown", {
      provideHover(document, position) {
        if (!isMcFile(document.fileName)) return undefined;
        const info = hoverAt(document.getText(), document.offsetAt(position));
        if (!info) return undefined;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**\`${info.name}\`** · \`${info.type}\` · 第 ${info.line} 行\n\n`);
        md.appendMarkdown("```json\n" + info.value + "\n```\n\n");
        const editArgs = encodeURIComponent(JSON.stringify({ name: info.name }));
        const commentArgs = encodeURIComponent(JSON.stringify({ name: info.name }));
        md.appendMarkdown(
          `[编辑值](command:mc.editValue?${editArgs}) · [添加评论](command:mc.addComment?${commentArgs})`,
        );
        md.isTrusted = true;
        return new vscode.Hover(md);
      },
    }),
  );

  // ---- 辅助 ----
  const currentMc = (): vscode.TextDocument | undefined => {
    const editor = vscode.window.activeTextEditor;
    return editor && isMcFile(editor.document.fileName) ? editor.document : undefined;
  };

  const findTargetAtCursor = (doc: vscode.TextDocument): string | undefined => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    const offset = doc.offsetAt(editor.selection.active);
    const source = doc.getText();
    const info = hoverAt(source, offset);
    if (info) return info.name;
    const res = parse(source);
    const line = editor.selection.active.line + 1; // 1-based
    const block = res.blocks.find((b) => line >= b.lines[0] && line <= b.lines[1]);
    return block?.id;
  };

  const findVarEntry = (
    doc: vscode.TextDocument,
    name: string | undefined,
  ): { kind: "var"; name: string; valueRaw: string; valueStart: number; valueEnd: number } | undefined => {
    const source = doc.getText();
    const res = parse(source);
    const target = name ?? findTargetAtCursor(doc);
    if (!target) return undefined;
    const entry = res.entries.find((e) => e.kind === "var" && e.name === target);
    if (!entry || entry.kind !== "var") return undefined;
    return {
      kind: "var",
      name: entry.name,
      valueRaw: entry.valueRaw,
      valueStart: entry.valueStart,
      valueEnd: entry.valueEnd,
    };
  };

  // ---- 命令 ----
  context.subscriptions.push(
    vscode.commands.registerCommand("mc.export", async () => {
      const doc = currentMc();
      if (!doc) return vscode.window.showWarningMessage("请先打开一个 .mc 文件");
      const res = parse(doc.getText());
      if (res.errors.length > 0) {
        return vscode.window.showErrorMessage(
          `校验失败：第 ${res.errors[0].line} 行 ${res.errors[0].message}`,
        );
      }
      const { config, errors } = buildConfig(res);
      if (errors.length > 0) return vscode.window.showErrorMessage(errors[0].message);
      const out = await vscode.workspace.openTextDocument({
        language: "json",
        content: canonicalJson(config),
      });
      await vscode.window.showTextDocument(out, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
      });
    }),

    vscode.commands.registerCommand("mc.addComment", async (arg?: { name?: string }) => {
      const doc = currentMc();
      if (!doc) return vscode.window.showWarningMessage("请先打开一个 .mc 文件");
      let target = arg?.name;
      let defaultText: string | undefined;

      // 支持选中文本：直接锚定到选中内容所在的变量/表格/块（无 id 的块自动生成 ^b-N）
      const editor = vscode.window.activeTextEditor;
      const sel = editor?.selection;
      if (!target && sel && !sel.isEmpty) {
        const source = doc.getText();
        const start = doc.offsetAt(sel.start);
        const end = doc.offsetAt(sel.end);
        const snippet = doc.getText(sel).trim();
        if (snippet.length > 0) defaultText = snippet.slice(0, 200);
        const t = findTargetForSelection(source, start, end);
        if (t.target) {
          target = t.target;
        } else if (t.autoAssign && t.block) {
          const { source: newSource, id } = assignBlockId(source, t.block);
          const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(source.length));
          const edit = new vscode.WorkspaceEdit();
          edit.replace(doc.uri, fullRange, newSource);
          await vscode.workspace.applyEdit(edit);
          await doc.save();
          target = id;
        }
      }

      if (!target) target = findTargetAtCursor(doc);
      if (!target) {
        const input = await vscode.window.showInputBox({
          prompt: "评论锚定目标（变量名或块 id）",
          placeHolder: "如 server.port 或 ^top",
        });
        if (!input) return;
        target = input.trim();
      }
      const text = await vscode.window.showInputBox({
        prompt: `评论内容（锚定 ${target}）`,
        value: defaultText,
      });
      if (!text) return;
      // 评论写进正文的评论区（append-only）：不做任何外部存储
      const cur = doc.getText();
      const edit2 = new vscode.WorkspaceEdit();
      edit2.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(cur.length)), appendComment(cur, target, text));
      await vscode.workspace.applyEdit(edit2);
      await doc.save();
      refreshComments();
      vscode.window.showInformationMessage(`评论已添加 → ${target}`);
    }),

    vscode.commands.registerCommand("mc.editValue", async (arg?: { name?: string }) => {
      const doc = currentMc();
      if (!doc) return vscode.window.showWarningMessage("请先打开一个 .mc 文件");
      const entry = findVarEntry(doc, arg?.name);
      if (!entry) return vscode.window.showWarningMessage("光标处没有可编辑的变量");
      const next = await vscode.window.showInputBox({
        prompt: `${entry.name} 的新值`,
        value: entry.valueRaw,
      });
      if (next === undefined || next === entry.valueRaw) return;
      if (next.includes("\n")) return vscode.window.showErrorMessage("暂不支持多行值");
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(entry.valueStart), doc.positionAt(entry.valueEnd)),
        next,
      );
      await vscode.workspace.applyEdit(edit);
      await doc.save();
      refreshComments();
      vscode.window.showInformationMessage(`${entry.name} = ${next}`);
    }),

    vscode.commands.registerCommand("mc.resolveComment", async (node?: McCommentNode) => {
      if (!node) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(node.file));
      const source = doc.getText();
      let next: string;
      try {
        next = removeCommentAt(source, node.comment.index);
      } catch (err) {
        return vscode.window.showErrorMessage(`删除评论失败：${String(err)}`);
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(0), doc.positionAt(source.length)),
        next,
      );
      await vscode.workspace.applyEdit(edit);
      await doc.save();
      refreshComments();
      vscode.window.showInformationMessage(`已解决（删除）评论 → ${node.comment.target}`);
    }),

    vscode.commands.registerCommand("mc.openTarget", async (node?: McCommentNode) => {
      if (!node) return;
      const uri = vscode.Uri.file(node.file);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      // 优先跳到被评论的目标；目标已被改名/删除时回落到评论自身所在行
      const res = parse(doc.getText());
      const entry = res.entries.find((e) => e.name === node.comment.target);
      const block = res.blocks.find((b) => b.id === node.comment.target);
      const line = entry ? entry.line : block ? block.lines[0] : node.comment.line;
      const pos = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }),

    vscode.commands.registerCommand("mc.refreshComments", refreshComments),

    // ---- 文档模式（预览中编辑）：Webview 渲染 + 点击块就地编辑 ----
    vscode.commands.registerCommand("mc.documentMode", async () => {
      const doc = currentMc();
      if (!doc) return vscode.window.showWarningMessage("请先打开一个 .mc 文件");
      panelUri = doc.uri;
      if (!docPanel) {
        docPanel = vscode.window.createWebviewPanel(
          "mcDocumentMode",
          "MarkdownConfig 文档模式",
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
          },
        );
        docPanel.onDidDispose(() => {
          docPanel = undefined;
          panelUri = undefined;
        });
        docPanel.webview.onDidReceiveMessage(async (msg) => {
          if (!msg) return;
          if (msg.type === "ready") {
            // webview 就绪握手：此时再发首帧渲染，避免消息早于监听器注册而丢失
            void sendRender();
            return;
          }
          if (msg.type === "error") {
            vscode.window.showErrorMessage(`文档模式内部错误：${String(msg.message ?? "")}`);
            return;
          }
          if (msg.type !== "edit") return;
          const uri = panelUri;
          if (!uri) return;
          const d = await vscode.workspace.openTextDocument(uri);
          const src = d.getText();
          const lines = src.split("\n");
          if (
            !Number.isInteger(msg.start) ||
            !Number.isInteger(msg.end) ||
            msg.start < 1 ||
            msg.end > lines.length
          ) {
            return; // 越界保护
          }
          const out = [
            ...lines.slice(0, msg.start - 1),
            ...String(msg.text ?? "").split("\n"),
            ...lines.slice(msg.end),
          ];
          const next = out.join("\n");
          const edit = new vscode.WorkspaceEdit();
          edit.replace(d.uri, new vscode.Range(d.positionAt(0), d.positionAt(src.length)), next);
          await vscode.workspace.applyEdit(edit);
          await d.save();
          docPanel?.webview.postMessage({ type: "render", source: next, errors: parse(next).errors });
        });
      }
      docPanel.title = `MarkdownConfig 文档模式 · ${path.basename(doc.fileName)}`;
      if (!docPanel.webview.html.includes("mcDocumentMode")) {
        // 仅首次创建时注入 html；复用面板不重载，避免闪烁与重新握手
        docPanel.webview.html = getPanelHtml(context, docPanel.webview);
      }
      docPanel.reveal(vscode.ViewColumn.Beside);
      void sendRender();
    }),
  );

  // ---- 文档模式：跟随活动编辑器 + 同步源文件变化 ----
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (!docPanel || !e || !isMcFile(e.document.fileName)) return;
      if (e.document.uri.toString() !== panelUri?.toString()) {
        panelUri = e.document.uri;
        docPanel.title = `MarkdownConfig 文档模式 · ${path.basename(e.document.fileName)}`;
        void sendRender();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (docPanel && panelUri && e.document.uri.toString() === panelUri.toString()) {
        scheduleRender();
      }
    }),
  );

  // ---- 收尾：不再有保存 watcher（人类改动交给 git 留痕）----
}

// ---- 文档模式（预览中编辑）：Webview 面板 ----
let docPanel: vscode.WebviewPanel | undefined;
let panelUri: vscode.Uri | undefined;

async function sendRender(): Promise<void> {
  if (!docPanel || !panelUri) return;
  try {
    const doc = await vscode.workspace.openTextDocument(panelUri);
    const source = doc.getText();
    docPanel.webview.postMessage({ type: "render", source, errors: parse(source).errors });
  } catch {
    /* 文件被删除等情况忽略 */
  }
}

let panelTimer: NodeJS.Timeout | undefined;
function scheduleRender(): void {
  if (panelTimer) clearTimeout(panelTimer);
  panelTimer = setTimeout(() => {
    panelTimer = undefined;
    void sendRender();
  }, 400);
}

function getPanelHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  // webview 脚本内联进 HTML：彻底避免外部脚本 404 / CSP / 路径解析类加载问题。
  // 任何初始化异常由 webview.js 顶层的 try/catch 直接显示到面板 #root。
  let webviewSrc = "/* webview.js 读取失败 */";
  try {
    webviewSrc = fs.readFileSync(
      path.join(context.extensionUri.fsPath, "out", "webview.js"),
      "utf8",
    );
  } catch (err) {
    webviewSrc = "/* " + String(err).replace(/\/\*/g, "/ *") + " */";
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data: vscode-webview:; script-src 'unsafe-inline'">
<style>
body { font-family: var(--vscode-font-family); margin: 0; padding: 12px 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); line-height: 1.6; }
#errors { display: none; background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 6px 10px; border-radius: 4px; margin-bottom: 12px; white-space: pre-wrap; }
.mc-block { position: relative; margin: 0 0 14px; padding: 2px 4px; border-radius: 6px; }
.mc-block:hover { background: var(--vscode-editorWidget-background); }
.mc-edit-btn { position: absolute; top: 2px; right: 4px; opacity: 0; transition: opacity .15s; font-size: 11px; padding: 1px 8px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
.mc-block:hover .mc-edit-btn { opacity: 1; }
.mc-value { color: #2E86DE; font-weight: 600; }
.mc-comment { color: #B7791F; font-style: italic; }
.mc-table-tag { display: inline-block; font-size: 12px; color: #8A97A5; border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 1px 8px; margin: 6px 0; }
.mc-edit { width: 100%; min-height: 80px; font-family: var(--vscode-editor-font-family); font-size: 13px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px; box-sizing: border-box; }
.mc-edit-footer { margin-top: 6px; display: flex; gap: 8px; }
.mc-edit-footer button { cursor: pointer; }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--vscode-panel-border); padding: 3px 10px; }
blockquote { border-left: 3px solid var(--vscode-panel-border); margin-left: 0; padding-left: 12px; color: var(--vscode-descriptionForeground); }
code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }
pre code { display: block; padding: 10px; overflow-x: auto; }
</style>
</head>
<body>
<div id="errors"></div>
<div id="root">文档模式加载中…</div>
<script>${webviewSrc}<\/script>
</body>
</html>`;
}

export function deactivate(): void {
  /* 无需清理 */
}
