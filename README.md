# MarkdownConfig

一种比 Markdown 更适合「人类 + Agent」协作的文档格式：**Markdown 超集 + 结构化配置声明 + 审计留痕**。

人类照常书写阅读，Agent 可结构化读取 / 编辑，程序把文档中的 config 当作配置源读取。



* 文件后缀：`.mc`（与主流格式无冲突）

* 语法规范：见 [SPEC.md](SPEC.md)

* 设计原则：**文本是真相，journal 只做审计**；**编译产物 = 标准 JSON**；**语法极小**

## 一行示例



```
连接超时：\<!--@var TIMEOUT\_MS-->3000\<!--@/var-->毫秒
```

渲染后文档只显示「连接超时：3000 毫秒」；`mc export` 输出 `{"TIMEOUT_MS": 3000}`。

## 目录结构



```
MarkdownConfig/

├── SPEC.md                  # P0：语法规范

├── examples/                # 示例 .mc 文件

├── packages/core/           # P1：TypeScript 核心 SDK + mc CLI

│   ├── src/                 # 扫描器 / 类型推断 / 表格 / 校验 / journal

│   └── test/fixtures/       # 黄金语料（.mc + 期望 .json）

├── packages/vscode/         # P2：VS Code 扩展（高亮 / hover / 评论 / watcher / 文档模式）

├── packages/markdownconfig/ # 发布包（mc CLI + 库，零依赖；经 GitHub Release 分发）

├── python/markdownconfig/   # Python Tier-1 读取库（读取时经 npx 调 CLI；GitHub Release 分发）

├── scripts/gen-golden.mjs   # 由规范实现重新生成黄金语料

├── dist/                    # 打包产物（markdownconfig-vscode-*.vsix）

└── bin/mc                   # 仓库级 CLI 包装（把 bin 加入 PATH 即可用）
```

## 快速开始

### 0. 直接安装（无需克隆，通过 GitHub Release）

> 用固定版本 URL（不要用 latest）：npx 按 URL 缓存，latest 更新后不会自动刷新；固定版本也保证可复现。下例为 v0.2.0。

```
# CLI 免安装运行（需要 Node.js 18+）
npx -y https://github.com/Meowllo/MarkdownConfig/releases/download/v0.2.0/markdownconfig.tgz export app.mc

# CLI 全局安装
npm install -g https://github.com/Meowllo/MarkdownConfig/releases/download/v0.2.0/markdownconfig.tgz

# Python 库（读取时经 npx 自动调用同一版本 CLI，无需单独安装）
pip install https://github.com/Meowllo/MarkdownConfig/releases/download/v0.2.0/markdownconfig-py.tar.gz

# VS Code 扩展：Release 下载 markdownconfig-vscode.vsix → 扩展面板「从 VSIX 安装」
```

### 1. 构建核心（TypeScript）



```
cd packages/core

npm install

npm run build      # 产出 dist/（SDK + mc CLI）

npm test           # 9 个测试：黄金语料 / 校验 / 类型 / 块扫描 / journal 闭环
```

### 2. 使用 mc CLI



```
\# 方式一：把仓库 bin 加入 PATH

export PATH="\$PATH:/Users/sunmingjun/Projects/MarkdownConfig/bin"

\# 方式二：直接用 node 运行

node packages/core/dist/cli.js export examples/app.mc
```

常用命令：



```
mc export examples/app.mc                 # 导出配置 JSON（canonical，字节稳定）

mc get examples/app.mc server.port        # 读取单个变量 → 8080

mc validate examples/app.mc               # 校验标记（错误带行号）

mc blocks examples/app.mc                 # 块索引（id/type/行号，Agent 局部读取用）

mc set examples/app.mc server.port 9090   # 就地改值 + 落 journal

mc add examples/app.mc debug.level 3      # 末尾新增变量 + 落 journal

mc comment examples/app.mc server.port "建议改回 8080"   # 锚定评论（落 journal）

mc comments examples/app.mc               # 查看未解决评论

mc resolve examples/app.mc c-1            # 标记评论已解决

mc journal examples/app.mc                # 审计日志（哈希链）

mc init                                   # 初始化 .mc/journal.jsonl
```

### 3. Python 读取（Tier-1：读取时才跑 CLI）



```
import markdownconfig

cfg = markdownconfig.load("examples/app.mc")

print(cfg\["server"]\["port"])   # 8080

print(cfg\["METRICS"]\[0])       # {"指标": "cpu", "阈值": 80, "等级": "warn"}
```

未把 `mc` 加入 PATH 时，用环境变量指定：



```
MC\_CLI="node /path/to/packages/core/dist/cli.js" python3 your\_program.py
```

### 4. TypeScript 读取



```
import { loadConfig, canonicalJson } from "@markdownconfig/core";

const { config, errors, parseErrors } = loadConfig("examples/app.mc");

if (errors.length || parseErrors.length) throw new Error("配置校验失败");

console.log(config.server.port); // 8080
```

### 5. VS Code 扩展（P2）

把 `.mc` 识别为 Markdown（自带源码编辑 + 内置 Markdown 预览双模式），并补齐：

- **config 值蓝色高亮**（主题无关）、标记灰色斜体
- **hover** 显示变量名 / 类型 / 值，附「编辑值」「添加评论」入口
- **评论面板**（活动栏 MarkdownConfig）：列出工作区未解决评论，支持添加 / 解决 / 跳转目标（读取 `.mc/journal.jsonl`）；**选中文本可直接评论**，自动锚定到变量 / 表格 / 块 id，无 id 的段落或标题自动生成 `^b-N`
- **导出配置 JSON**：编辑器标题栏按钮
- **人工编辑留痕**：保存 `.mc` 时自动比对上次快照，把改动写入 journal（actor=human）；**首次保存自动创建 journal + 快照**，之后每次保存 **config 路径 + 行级文本 diff** 双轨留痕；CLI/扩展 5 秒内写入自动跳过；**文件有校验错误时也照常记录文本 diff**（保留上次有效 config 快照，注明「校验错误 N 个」）
- **文档模式（预览中编辑）**：标题栏「文档模式」→ 侧栏 Webview 渲染面板；config 值蓝色标识、表格显示「配置表：NAME」标签、块 id 隐藏；悬停块右上角「编辑块」→ 该块以 textarea 就地编辑**原始 markdown（含标记）**，保存按行号回写源文件并重渲染（标记不经富文本模型、不会丢失）

安装方式一（VSIX，推荐）：

```
cd packages/vscode && npm install && npm test   # 构建 + 全部测试（21 项）
cd packages/vscode && npm run build
# 打包：npx vsce package --no-dependencies（staging 目录，见扩展 README）
```

VS Code 扩展面板 → `...` → 「从 VSIX 安装…」→ 选择 `dist/markdownconfig-vscode-0.2.2.vsix`。

安装方式二（开发调试）：在 `packages/vscode` 下按 `F5`。

## 通用性（跨语言策略）



* **Tier 0**：构建期 `mc export` 编译为 JSON，任何语言标准库读取，零成本。

* **Tier 1（当前实现）**：语言侧薄封装，读取时调用 CLI—— 本仓库的 `python/markdownconfig`（经 GitHub Release 分发）即此形态；找不到本地 mc 时自动经 npx 拉取 Release 包。

* **Tier 2（未来，按需）**：原生解析器移植（C/C++/Java/Go/Rust…），以黄金语料为一致性基准。

## 测试



```
cd packages/core && npm test        # 核心测试（黄金语料 + 类型等 9 项）

MC\_CLI="node \<repo>/packages/core/dist/cli.js" python3 python/tests/test\_mcpy.py   # Python 冒烟测试

node scripts/gen-golden.mjs         # 由规范实现重新生成黄金语料（确定性校验）

cd packages/vscode && npm test      # 扩展纯逻辑 20 项 + mock vscode 冒烟 1 项
```

## 路线图



* [x] P0 语法规范 + 示例

* [x] P1 核心 SDK + mc CLI + Python Tier-1 读取库 + 黄金语料

* [x] P2 ToHuman：VS Code 扩展（config 值蓝色高亮 / hover 变量名 / 评论面板+选中文本评论 / 导出 JSON / watcher 双轨留痕 / **文档模式预览编辑**；.mc 注册为 Markdown 双模式）— 已产出 `dist/markdownconfig-vscode-0.2.2.vsix`（文档模式：webview 脚本内联进面板 HTML，消除外部脚本加载失败导致的空白；初始化错误直接显示在面板上）；`TYPE` 支持 `string|number|int|boolean|json|text`

* [x] P3 Skill：markdownconfig 技能文档（介绍 .mc 是什么、如何创建/查阅/编辑/读评论/作为配置源/从 .md 转换），随 GitHub Release 生效

* [x] 发布：GitHub 公开仓库 https://github.com/Meowllo/MarkdownConfig （Release 托管 CLI tgz / Python sdist / VS Code vsix；npm、PyPI 暂缓）

* [ ] Obsidian 插件（已暂缓，后续按需排期）