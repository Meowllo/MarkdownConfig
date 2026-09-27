/** 保存 watcher：人类编辑 .mc 后，比对上次快照并把改动写入 journal（自动创建 journal）
 *  双轨留痕：config 路径 diff + 行级文本 diff；文件有校验错误时仍记录文本改动并注明错误数 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { appendOp, buildConfig, findJournalDir, parse, readOps } from "@markdownconfig/core";
import { diffPaths, isMcFile, summarizeTextDiff } from "./pure";

interface FileState {
  config: Record<string, unknown>;
  text: string;
}

export function setupWatcher(context: vscode.ExtensionContext, onChanged?: () => void): void {
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!isMcFile(doc.fileName)) return;
      const cfg = vscode.workspace.getConfiguration("markdownconfig");
      if (!cfg.get<boolean>("watchHumanEdits", true)) return;

      const source = doc.getText();
      const res = parse(source);
      const hasErrors = res.errors.length > 0;

      // CLI / 扩展刚写过（5 秒内有 op）→ 跳过，避免与 agent 操作重复记录
      const ops = readOps(doc.fileName);
      if (ops.length > 0) {
        const last = ops[ops.length - 1];
        try {
          if (Date.now() - Date.parse(last.ts) < 5000) return;
        } catch {
          /* 时间解析失败则继续 */
        }
      }

      // journal 目录：已有则用；否则自动创建（首个 .mc 保存即建快照，之后每次保存 diff 留痕）
      const jdir = findJournalDir(doc.fileName) ?? path.join(path.dirname(doc.fileName), ".mc");
      try {
        fs.mkdirSync(jdir, { recursive: true });
      } catch {
        return; // 目录创建失败则不记录
      }

      const statePath = path.join(jdir, "state.json");
      let state: Record<string, string> = {};
      try {
        state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      } catch {
        /* 首次记录 */
      }
      const rel = path.relative(jdir, doc.fileName).split(path.sep).join("/");

      // 兼容旧格式（直接是 config JSON）与新格式（{config, text}）
      let prevConfig: Record<string, unknown> | null = null;
      let prevText: string | null = null;
      const raw = state[rel];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && "config" in parsed) {
            prevConfig = (parsed as FileState).config;
            prevText = (parsed as FileState).text;
          } else {
            prevConfig = parsed as Record<string, unknown>;
          }
        } catch {
          /* 忽略坏状态 */
        }
      }

      // 有错误时不更新 config（保留上次有效配置），文本照常快照
      const curConfig = hasErrors ? prevConfig : buildConfig(res).config;
      const next: FileState = { config: curConfig ?? {}, text: source };
      state[rel] = JSON.stringify(next);
      try {
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      } catch {
        /* 忽略写失败 */
      }

      // 双轨留痕：config 路径 diff（仅当解析有效）+ 行级文本 diff（任何改动）
      const configChanged =
        !hasErrors && prevConfig !== null ? diffPaths(prevConfig, curConfig ?? {}) : [];
      const textChanged = prevText !== null ? summarizeTextDiff(prevText, source) : [];

      if (prevText !== null && (configChanged.length > 0 || textChanged.length > 0)) {
        const parts: string[] = [];
        if (configChanged.length > 0) {
          parts.push(configChanged.slice(0, 10).join(", ") + (configChanged.length > 10 ? "…" : ""));
        }
        if (textChanged.length > 0) {
          parts.push(`文本 ${textChanged.join(", ")}`);
        }
        if (hasErrors) {
          parts.push(`校验错误 ${res.errors.length} 个（文本已记录）`);
        }
        appendOp(doc.fileName, {
          op: "log",
          actor: "human",
          text: `人工编辑: ${parts.join("; ")}`,
        });
        onChanged?.();
      }
    }),
  );
}
