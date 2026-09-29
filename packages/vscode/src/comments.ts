/** 评论树（activity bar 侧边栏）：直接从 .mc 正文解析评论区，不读任何外部文件 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parse } from "markdownconfig";
import type { CommentEntry } from "markdownconfig";

/** 评论节点：除评论本身外还要记住它在文件里的序号（resolve 用序号删除） */
export interface McComment {
  target: string;
  text: string;
  line: number;
  /** 1-based，按文档出现顺序 */
  index: number;
}

export class McCommentNode {
  constructor(
    public readonly file: string,
    public readonly comment: McComment,
  ) {}
}

export class CommentsProvider implements vscode.TreeDataProvider<McCommentNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(node: McCommentNode): vscode.TreeItem {
    const item = new vscode.TreeItem(`[${node.comment.target}] ${node.comment.text}`);
    item.description = `${path.basename(node.file)} · 第 ${node.comment.index} 条`;
    item.tooltip = new vscode.MarkdownString(
      `**${node.file}**\n\n指向 \`${node.comment.target}\` · 第 ${node.comment.line} 行\n\n---\n${node.comment.text}`,
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
      let source: string;
      try {
        source = fs.readFileSync(uri.fsPath, "utf8");
      } catch {
        continue;
      }
      const res = parse(source);
      res.comments.forEach((c: CommentEntry, i: number) => {
        nodes.push(
          new McCommentNode(uri.fsPath, {
            target: c.target,
            text: c.text,
            line: c.line,
            index: i + 1,
          }),
        );
      });
    }
    return nodes;
  }
}
