/** 评论树（activity bar 侧边栏）：从 journal 读取未解决评论 */

import * as path from "path";
import * as vscode from "vscode";
import { allComments } from "@markdownconfig/core";
import type { JournalOp } from "@markdownconfig/core";

export class McCommentNode {
  constructor(
    public readonly file: string,
    public readonly comment: JournalOp,
  ) {}
}

export class CommentsProvider implements vscode.TreeDataProvider<McCommentNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: McCommentNode): vscode.TreeItem {
    const item = new vscode.TreeItem(`[${node.comment.target ?? "?"}] ${node.comment.text ?? ""}`);
    item.description = `${path.basename(node.file)} · ${node.comment.id}`;
    item.tooltip = new vscode.MarkdownString(
      `**${node.file}**\n\n${node.comment.text ?? ""}\n\n---\n${node.comment.actor} · ${node.comment.ts}`,
    );
    item.contextValue = "mcComment";
    item.iconPath = new vscode.ThemeIcon("comment");
    item.command = {
      command: "mc.openTarget",
      title: "打开目标",
      arguments: [node],
    };
    return item;
  }

  async getChildren(): Promise<McCommentNode[]> {
    const files = await vscode.workspace.findFiles("**/*.mc", "**/node_modules/**", 500);
    const nodes: McCommentNode[] = [];
    for (const uri of files) {
      for (const c of allComments(uri.fsPath)) {
        if (c.status === "open") nodes.push(new McCommentNode(uri.fsPath, c));
      }
    }
    nodes.sort((a, b) => (a.comment.ts < b.comment.ts ? 1 : -1));
    return nodes;
  }
}
