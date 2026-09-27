/** 冒烟测试：mock vscode 模块后执行 activate()，验证扩展注册逻辑可真实运行 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("activate：mock vscode 下注册全部命令与钩子", () => {
  const registered = [];
  const disposables = [];

  const vscode = {
    window: {
      createTextEditorDecorationType: () => ({ dispose() {} }),
      onDidChangeActiveTextEditor: () => ({ dispose() {} }),
      createTreeView: () => ({ dispose() {} }),
      showWarningMessage: () => undefined,
      showErrorMessage: () => undefined,
      showInformationMessage: () => undefined,
      showInputBox: () => undefined,
      activeTextEditor: undefined,
    },
    workspace: {
      onDidChangeTextDocument: () => ({ dispose() {} }),
      onDidSaveTextDocument: () => ({ dispose() {} }),
      getConfiguration: () => ({ get: () => true }),
      openTextDocument: () => undefined,
      findFiles: () => [],
      applyEdit: () => true,
    },
    languages: {
      registerHoverProvider: () => ({ dispose() {} }),
    },
    commands: {
      registerCommand: (name, _fn) => {
        registered.push(name);
        return { dispose() {} };
      },
    },
    Uri: { file: (p) => p },
    ThemeIcon: class {},
    MarkdownString: class {},
    TreeItem: class {},
    ViewColumn: { Beside: 2 },
    Position: class {},
    Range: class {},
    Selection: class {},
    TextEditorRevealType: { InCenter: 1 },
    TreeView: class {},
    EventEmitter: class {
      fire() {}
      readonly = () => ({ dispose() {} });
    },
  };

  const Module = require("module");
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return vscode;
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    const ext = require("../out/extension.js");
    ext.activate({ subscriptions: disposables });
    const expected = [
      "mc.export",
      "mc.addComment",
      "mc.editValue",
      "mc.resolveComment",
      "mc.openTarget",
      "mc.refreshComments",
      "mc.documentMode",
    ];
    for (const name of expected) {
      assert.ok(registered.includes(name), `应注册命令 ${name}`);
    }
    assert.ok(disposables.length >= 4, `应挂载多个资源，实际 ${disposables.length}`);
  } finally {
    Module._load = origLoad;
  }
});
