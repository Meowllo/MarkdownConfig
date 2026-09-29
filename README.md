# MarkdownConfig

一种**Markdown 版本的配置源**：**Markdown 超集 + 结构化配置声明**。

程序按文档里声明的 config 运行，所以文档就是权威设计真相；人类照常书写阅读，Agent 可结构化读取 / 编辑。相比 JSON/YAML 可读性更好，相比表格更自由（非结构化的自然语言描述也能直接当配置源）。

* 文件后缀：`.mc`（与主流格式无冲突）
* 语法规范：见 [SPEC.md](SPEC.md)（唯一权威）
* 设计原则：**文本是真相（含评论），一切都在正文里**；**编译产物 = 标准 JSON**；**语法极小**
* 版本与变更：全项目（CLI / SDK / Python 库 / VS Code 扩展 / Agent Skill / 规范）统一版号，当前 `v0.6.0`；**留痕与版本控制交给 git**（`.mc` 不生成任何审计文件或日志目录）

## 一行示例

```
连接超时：<!--@var TIMEOUT_MS-->3000<!--@/var-->毫秒
```

渲染后文档只显示「连接超时：3000 毫秒」；`mc export` 输出 `{"TIMEOUT_MS": 3000}`。

表格（第一列固定为 id 列，读出为 `{id: {其余列}}`）：

```
<!--@table T_ARMOR-->
| 部位 | 护甲 | 说明 |
| --- | --- | --- |
| head | 5 | 头部 |
| body | 8 | 躯干 |
<!--@/table-->
```

⇒ `{"T_ARMOR": {"head": {"护甲": 5, "说明": "头部"}, "body": {"护甲": 8, "说明": "躯干"}}}`

## 目录结构

```
MarkdownConfig/
├── SPEC.md                  # 语法规范（唯一权威）
├── README.md                # 本文件
├── examples/                # 示例 .mc 文件
├── packages/core/           # 核心：TypeScript SDK + mc CLI（单一事实实现）
│   ├── src/                 # markers（标记词法/嵌套）/ scanner / table / infer / config / comments
│   │                        # reader（稳定读取层）/ codegen（代码生成）/ fingerprint / version / cli
│   └── test/fixtures/       # 黄金语料（.mc + 期望 .json）
├── packages/vscode/         # VS Code 扩展（高亮 / hover / 评论面板 / 文档模式预览编辑）
├── python/markdownconfig/   # Python Tier-1 读取库（读取时经 npx 调 CLI；GitHub Release 分发）
├── skill/                   # Agent Skill：教 Agent 如何用 .mc（含 JS/TS SDK 详细用法）
├── scripts/gen-golden.mjs   # 由参考实现重新生成黄金语料
└── bin/mc                   # 仓库级 CLI 包装（把 bin 加入 PATH 即可用）
```

## 快速开始

### 0. 直接安装（无需克隆）

> **首选 npm registry**（固定版本号保证可复现，也可用 `^0.6.0` 接收补丁与小版本升级）。
> 离线 / 受限环境（构建插件里 PATH 窄、无 registry 通路）改用 Release 的固定版本 tgz —— 把下面的 `markdownconfig@0.6.0` 换成 `https://github.com/Meowllo/MarkdownConfig/releases/download/v0.6.0/markdownconfig.tgz` 即可。

```
# JS / TS 程序内读取配置（需要 Node.js 18+）—— 下游读配置的推荐通路
npm i markdownconfig
#   import { open, emitTsModule } from "markdownconfig";

# CLI 免安装运行
npx -y markdownconfig@0.6.0 export app.mc

# CLI 全局安装
npm install -g markdownconfig@0.6.0
# 从旧版升级（0.3.0 时包名曾为 @markdownconfig/core，0.3.1 起固定为 markdownconfig，之后不再变更）：
#   npm rm -g markdownconfig @markdownconfig/core 2>/dev/null
#   npm i -g markdownconfig@0.6.0

# Python 库（读取时经 npx 自动调用同一版本 CLI，无需单独安装）
pip install https://github.com/Meowllo/MarkdownConfig/releases/download/v0.6.0/markdownconfig-py.tar.gz

# VS Code 扩展：Release 下载 markdownconfig-vscode.vsix → 扩展面板「从 VSIX 安装」

# Agent Skill（给其他 Agent 用的 .mc 操作技能）：
# 下载 markdownconfig-skill.tar.gz，解压到你的 Agent 技能目录（如 ~/.workbuddy/skills/）：
#   mkdir -p <skills_dir>/markdownconfig && tar xzf markdownconfig-skill.tar.gz -C <skills_dir>/markdownconfig
```

### 1. 构建核心（TypeScript）

```
cd packages/core
npm install
npm run build      # 产出 dist/（SDK + mc CLI）
npm test           # 黄金语料 / 校验 / 类型 / 块扫描 / 嵌套数组 / 表格 / CLI 端到端
```

### 2. 使用 mc CLI

```
# 方式一：把仓库 bin 加入 PATH
export PATH="$PATH:<repo>/bin"

# 方式二：直接用 node 运行
node packages/core/dist/cli.js export examples/app.mc
```

常用命令：

```
mc init new.mc                            # 生成可直接校验通过的 .mc 骨架
mc export examples/app.mc                 # 导出配置 JSON（canonical，字节稳定）
mc export examples/app.mc --fingerprint   # 顶层加 $fingerprint（sha256 / sha256File / 版本）
mc get examples/app.mc server.port        # 读取单个变量 → 8080
mc get examples/app.mc METRICS.cpu.等级    # 读取表格单元格 → "test"
mc validate examples/app.mc               # 校验标记（错误带行号，误用带提示）
mc blocks examples/app.mc                 # 块索引（id/type/行号，Agent 局部读取用）
mc tables examples/app.mc                 # 列出已标记表（id 行数 / 行区间）
mc set examples/app.mc server.port 9090   # 就地改变量
mc set examples/app.mc METRICS.cpu.阈值 85  # 按 id 就地改表格单元格
mc add examples/app.mc debug.level 3      # 末尾新增变量
mc comment examples/app.mc server.port "建议改回 8080"   # 追加评论到文末评论区
mc comments examples/app.mc               # 列出评论（带序号）
mc resolve examples/app.mc 1              # 删除（解决）第 1 条评论
```

### 3. Python 读取（Tier-1：读取时才跑 CLI）

```
import markdownconfig

cfg = markdownconfig.load("examples/app.mc")

print(cfg["server"]["port"])          # 8080
print(cfg["METRICS"]["cpu"])          # {"指标": "cpu", "阈值": 80, "等级": "test"}
print(cfg["METRICS"]["cpu"]["等级"])   # "test"
```

未把 `mc` 加入 PATH 时，用环境变量指定：

```
MC_CLI="node /path/to/packages/core/dist/cli.js" python3 your_program.py
```

### 4. JS / TS 读取（**下游读配置的推荐通路**）

`markdownconfig` 是一个包两个入口（`mc` CLI + 同源 SDK）。**读取逻辑由工具定义**，下游不要把 `mc export` 的 JSON 结构写进业务代码 —— 那样导出形状一变就得改你的项目。

#### 4.1 读：`McDoc`（形状稳定）

```
npm i markdownconfig
```

```ts
import { open } from "markdownconfig";

const doc = open("examples/app.mc");

doc.value("server.port");                       // 8080（支持点号路径，与 mc get 一致）
doc.cell("METRICS", "cpu", "阈值");              // 80
doc.rows("METRICS");                            // 行对象数组（含 id 列、键序=文档列序）—— 跨版本稳定
doc.row("METRICS", "cpu");                      // 按 id 取一行
doc.fingerprint({ timestamp: false });          // 来源指纹（与 mc export --fingerprint 同结果）
```

* 缺表 / 缺 id / 缺列 / 缺变量 → **抛 `McConfigError` 并列出可选值**，不静默兜底。
* `rows()` 永远是"行对象数组、含 id 列"，因此 v0.5.0 那种导出形状变更**不影响下游代码**。
* `doc.raw` 是原始序列化形状（逃生口），**不享受形状稳定承诺**。

#### 4.2 写：`emitTsModule`（确定性代码生成）

游戏 / 小程序等运行时不读文件，需构建期把配置落成源码 —— 这一步也由工具做，不手写字符串拼接：

```ts
import { open, emitTsModule } from "markdownconfig";

const doc = open("docs/局内成长设计.mc");
const fw = {};
for (const r of doc.rows("T_FRAMEWORK")) fw[r.key] = r.value;   // 领域校验自己写

const text = emitTsModule({
  title: "growthConfig.gen.ts —— 自动生成，不要手改。",
  source: "docs/局内成长设计.mc",
  generator: "scripts/gen-growth-config.mjs",
  fingerprint: doc.fingerprint({ timestamp: false }),           // → SOURCE_SHA256 / SOURCE_MC_VERSION
  consts: [{ name: "MAX_WEAPONS", value: fw.skillSlots, doc: "局内技能格数" }],
});
```

同输入产出**逐字节相同**的输出，可直接用 `--check` 做「产物是否过期」门禁。完整用法（含 `ConstDecl` 字段、错误处理、与 CLI 的对照、常见坑）见 [skill/references/sdk.md](skill/references/sdk.md)。

### 5. VS Code 扩展

把 `.mc` 识别为 Markdown（自带源码编辑 + 内置 Markdown 预览双模式），并补齐：

- **config 值蓝色高亮**（主题无关）、标记灰色斜体
- **hover** 显示变量名 / 类型 / 值，附「编辑值」「添加评论」入口
- **评论面板**（活动栏 MarkdownConfig）：列出工作区所有评论（直接解析 `.mc` 正文的评论区），支持添加 / 删除 / 跳转目标；**选中文本可直接评论**，自动锚定到变量 / 表格 / 块 id，无 id 的段落或标题自动生成 `^b-N`
- **导出配置 JSON**：编辑器标题栏按钮
- **评论正文琥珀色高亮**：标记灰色、评论文字可见可读；改动历史交给 git，不再做保存留痕
- **文档模式（预览中编辑）**：标题栏「文档模式」→ 侧栏 Webview 渲染面板；config 值蓝色标识、表格显示「配置表：NAME」标签、块 id 隐藏；悬停块右上角「编辑块」→ 就地编辑**原始 markdown（含标记）**

安装方式一（VSIX，推荐）：从 Release 下载 `markdownconfig-vscode.vsix` → 扩展面板 `...` → 「从 VSIX 安装…」。

安装方式二（开发调试）：在 `packages/vscode` 下按 `F5`。

### 6. 测试

```
cd packages/core && npm test                                  # core
cd packages/vscode && npm test                                # 扩展（含 mock vscode 冒烟）
MC_CLI="node <repo>/packages/core/dist/cli.js" python3 python/tests/test_mcpy.py   # Python 冒烟
node scripts/gen-golden.mjs                                   # 重建黄金语料（改解析逻辑后必跑）
```

## 通用性（跨语言策略）

* **Tier 0**：构建期 `mc export` 编译为 JSON，任何语言标准库读取，零成本。**形状适配应集中在一个薄层**（导出形状会随语法演进）。
* **Tier 1（当前实现）**：语言侧薄封装 —— JS/TS 直接**进程内**调用 SDK（`open()` → `McDoc`，无需 CLI、零运行时依赖）；`python/markdownconfig` 读取时调用 CLI（经 npx 自动获取同一版本）。
* **Tier 2（未来，按需）**：原生解析器移植（C/C++/Java/Go/Rust…），以黄金语料为一致性基准。

**同语言优先走 SDK**：只有 JS/TS 能拿到"读取契约"（形状稳定 + `emitTsModule` 代码生成）。其它语言请把 JSON 形状适配收敛到一个薄层，别散进业务代码。

## 路线图

* [x] P0 语法规范 + 示例
* [x] P1 核心 SDK + mc CLI + Python Tier-1 读取库 + 黄金语料
* [x] P2 ToHuman：VS Code 扩展（高亮 / hover / 评论面板 / 导出 JSON / 文档模式预览编辑）
* [x] P3 Skill：markdownconfig 技能文档，含 JS/TS SDK 详细用法
* [x] 发布：GitHub 公开仓库 https://github.com/Meowllo/MarkdownConfig ；npm registry `markdownconfig`
* [x] v0.5.0：表格 id 列语义 + `mc set` 就地改格、`@array` 嵌套、报错指路、指纹补 `sha256File`
* [x] v0.6.0：评论搬进正文（`@comment` + 文末评论区）、删除全部审计功能（`.mc/` 目录、快照、watcher、哈希链）—— 留痕交给 git
* [x] v0.6.0（读取层，纯加法）：`McDoc` 稳定读取层 + `emitTsModule` 代码生成 + 发布 npm registry
* [ ] Obsidian 插件（已暂缓，后续按需排期）
