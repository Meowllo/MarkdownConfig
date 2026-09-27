# MarkdownConfig — VS Code 扩展

`.mc`（Markdown 超集）文件的编辑与协作插件。依赖核心 SDK `@markdownconfig/core`（仓库内 `packages/core`）。

## 功能

- **识别 `.mc` 为 Markdown**：可直接使用内置 Markdown 预览、大纲等能力（config 标记是 HTML 注释，预览时自动隐藏，值直接显示）。
- **config 值蓝色高亮**：`@var` 的值以主题无关的蓝色加粗显示，标记本身灰色斜体。
- **hover 变量信息**：悬停在值或标记上显示变量名 / 类型 / 值，并提供「编辑值」「添加评论」快捷入口。
- **评论（类飞书）**：活动栏「MarkdownConfig」面板列出当前工作区所有未解决评论（读取 `.mc/journal.jsonl`）；支持添加评论、标记解决、点击跳转到目标位置。
  - **选中文本直接评论**：选中任意文本 → 添加评论，自动锚定到选中范围内的变量名 / 表格名 / 块 id；若命中无 id 的段落或标题，自动生成 `^b-N` 写入块尾再锚定。评论输入框默认带入选中文本。
- **导出配置 JSON**：编辑器标题栏按钮，把当前文件的 config 以 canonical JSON 打开在侧栏。
- **人工编辑留痕**：保存 `.mc` 时自动比对上次快照并写入 journal（actor=human）。**首次保存自动创建 journal + 快照**，之后每次保存把改动写入 journal：config 路径（如 `METRICS`、`server.port`）+ 行级文本 diff（如 `文本 L27 修改`）双轨记录；CLI/扩展自身刚写入（5 秒内）自动跳过，避免重复记录。**文件有校验错误时也不跳过**：保留上次有效 config 快照，照常记录文本 diff 并注明「校验错误 N 个（文本已记录）」。
- **文档模式（预览中编辑）**：编辑器标题栏「文档模式」按钮（`mc.documentMode`）在侧栏打开 Webview 渲染面板——config 值蓝色标识、表格显示「配置表：NAME」标签、块 id 隐藏；每块右上角悬停出现「编辑块」按钮，点击后该块以 textarea 就地编辑**原始 markdown**（含标记），保存按行号回写源文件并实时重渲染。标记不经富文本模型，不会丢失；源文件始终是真相。

## 使用

### 方式一：安装 VSIX（推荐）

```bash
npm run build      # 先在 packages/core 与 packages/vscode 构建
npx vsce package   # 生成 markdownconfig-vscode-*.vsix
```

然后在 VS Code 中：扩展面板 → `...` → `从 VSIX 安装…` → 选择生成的 `.vsix`。

### 方式二：F5 调试运行

1. 在 `packages/vscode` 下打开文件夹。
2. 按 `F5`（已配置 `Extension Development Host` + 自动构建）。

## 设置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `markdownconfig.watchHumanEdits` | `true` | 保存时自动记录人工编辑到 journal（首个保存自动建 journal+快照；有校验错误时也记录文本 diff 并注明错误数） |
| `markdownconfig.highlightConfigValues` | `true` | 是否蓝色高亮 config 值（装饰层） |

## 命令

| 命令 | 说明 |
| --- | --- |
| `mc.export` | 导出配置 JSON |
| `mc.addComment` | 添加评论：有选中文本 → 锚定选中内容（无 id 块自动生成 `^b-N`）；否则锚定光标所在变量/块 |
| `mc.editValue` | 编辑当前变量值 |
| `mc.resolveComment` | 标记评论已解决（评论树右键/行内按钮） |
| `mc.refreshComments` | 刷新评论树 |
| `mc.openTarget` | 打开评论锚定目标（点击评论） |
| `mc.documentMode` | 在侧栏打开文档模式面板（渲染预览 + 点击块就地编辑原始 markdown） |

## 开发

```bash
npm install   # 安装依赖（含 file:../core）
npm test      # 构建 + 纯逻辑单测（node --test）
```

说明：编辑器 UI 层（decorations/hover/树视图）依赖 VS Code 运行时，无法在无头环境执行；纯逻辑（高亮区间计算、hover 命中、diff 路径、.mc 判定）已由 `test/highlights.test.mjs` 覆盖。
