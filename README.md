# MarkdownConfig

一种**Markdown 版本的配置源**：**Markdown 超集 + 结构化配置声明**。

程序按文档里声明的 config 运行，所以文档就是权威设计真相；人类照常书写阅读，Agent 可结构化读取 / 编辑。相比 JSON/YAML 可读性更好，相比表格更自由（非结构化的自然语言描述也能直接当配置源）。

* 文件后缀：`.mc`（与主流格式无冲突）
* 语法规范：见 [SPEC.md](SPEC.md)（唯一权威）
* 设计原则：**文本是真相（含评论），一切都在正文里**；**编译产物 = 标准 JSON**；**语法极小**
* 版本与变更：**全项目统一版号** —— npm 包（SDK + CLI）/ Agent Skill / 规范同号，当前 `v0.7.0`；**留痕与版本控制交给 git**（`.mc` 不生成任何审计文件或日志目录）
* 只提供 **一个 npm 包**（`markdownconfig`）：SDK 与 `mc` CLI 由同一个包提供，装一次两者都有、版本天然一致

## 一行示例

```
连接超时：<!--@var TIMEOUT_MS-->3000<!--@/var-->毫秒
```

渲染后文档只显示「连接超时：3000 毫秒」；`mc export` 输出 `{"TIMEOUT_MS": 3000}`。

表格（第一列固定为 id 列，读出为 `{id: {其余列}}`）：

```
<!--@table T_LIMITS-->
| 项 | 值 | 说明 |
| --- | --- | --- |
| timeout | 5 | 超时秒数 |
| retries | 8 | 重试次数 |
<!--@/table-->
```

⇒ `{"T_LIMITS": {"timeout": {"值": 5, "说明": "超时秒数"}, "retries": {"值": 8, "说明": "重试次数"}}}`

## 目录结构

```
MarkdownConfig/
├── SPEC.md                  # 语法规范（唯一权威）
├── README.md                # 本文件
├── examples/                # 示例 .mc 文件
├── skill/                   # Agent Skill：教 Agent 如何用 .mc（含 JS/TS SDK 详细用法）
├── packages/core/           # 唯一的包：TypeScript SDK + mc CLI（单一事实实现）
│   ├── src/                 # markers（标记词法/嵌套）/ scanner / table / infer / config / comments
│   │                        # reader（稳定读取层）/ codegen（代码生成）/ fingerprint / version / cli
│   └── test/fixtures/       # 黄金语料（.mc + 期望 .json）
├── scripts/gen-golden.mjs   # 由参考实现重新生成黄金语料
└── bin/mc                   # 仓库级 CLI 包装（开发时把 bin 加入 PATH）
```

> VS Code 扩展与 Python 读取库已**不再是本仓库的一部分**：扩展已独立出去单独维护（仓库地址待发布）；Python 库暂时不再维护。

## 安装（两步）

需要 Node.js 18+。

### 1. Agent 技能（让 Agent 会读写 `.mc`）

```bash
mkdir -p ~/.agents/skills/markdownconfig && curl -sSL https://github.com/Meowllo/MarkdownConfig/releases/download/v0.7.0/markdownconfig-skill.tar.gz | tar xz -C ~/.agents/skills/markdownconfig
```

装到各主流 Agent 共用的技能目录 `~/.agents/skills/`。只有人用、不需要 Agent 时可以跳过这步。

### 2. 工具（SDK + CLI）

```bash
npm i markdownconfig
```

一条命令同时得到 SDK 与 `mc` CLI —— 它们是同一个包，所以**不会出现"SDK 升了但 CLI 没升"**：

```ts
import { open } from "markdownconfig";        // SDK：进程内读取，无需 CLI
```

```bash
npx mc export app.mc                          # CLI：npx 解析到本地 node_modules/.bin/mc
```

### 升级

重复上面两步即可：

```bash
npm i markdownconfig@latest      # SDK 与 CLI 一起更新
```

（技能包同理：重新下载并覆盖 `~/.agents/skills/markdownconfig`。技能里写着"用哪个版本的工具"，所以工具升级后技能也建议一起换。）

* 从 **0.3.0 之前**升级：那时的包名是 `@markdownconfig/core`，先卸掉旧包再装，并 **`npx mc version` 核对结果** —— 机器上留着旧版时它可能被优先调用。
* 破坏性变更与迁移说明见 [SPEC.md](SPEC.md) 的变更记录，以及各版本的 Release notes。

## 从源码构建（开发用）

```
cd packages/core
npm install
npm run build      # 产出 dist/（SDK + mc CLI）
npm test           # 黄金语料 / 校验 / 类型 / 块扫描 / 嵌套数组 / 表格 / 读取层 / CLI 端到端
```

仓库里开发时直接跑 CLI：

```
node packages/core/dist/cli.js export examples/app.mc
# 或把仓库 bin 加入 PATH：export PATH="$PATH:<repo>/bin"
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

## JS / TS 读取（**下游读配置的推荐通路**）

`markdownconfig` 是一个包两个入口（`mc` CLI + 同源 SDK）。**读取逻辑由工具定义**，下游不要把 `mc export` 的 JSON 结构写进业务代码 —— 那样导出形状一变就得改你的项目。

### 读：`McDoc`（形状稳定）
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

### 写：`emitTsModule`（确定性代码生成）

游戏 / 小程序等运行时不读文件，需构建期把配置落成源码 —— 这一步也由工具做，不手写字符串拼接：

```ts
import { open, emitTsModule } from "markdownconfig";

const doc = open("example.mc");

// 领域校验自己写（这是业务规则，不是胶水）
const limits = {};
for (const r of doc.rows("T_LIMITS")) limits[r.key] = r.value;
if (!Number.isInteger(limits.maxSlots)) throw new Error("maxSlots 必须是整数");

const text = emitTsModule({
  title: "config.gen.ts —— 自动生成，不要手改。",
  source: "example.mc",
  generator: "scripts/gen-config.mjs",
  fingerprint: doc.fingerprint({ timestamp: false }),           // → SOURCE_SHA256 / SOURCE_MC_VERSION
  consts: [{ name: "MAX_SLOTS", value: limits.maxSlots, doc: "最大槽位数" }],
});
```

同输入产出**逐字节相同**的输出，可直接用 `--check` 做「产物是否过期」门禁。完整用法（含 `ConstDecl` 字段、错误处理、与 CLI 的对照、常见坑）见 [skill/references/sdk.md](skill/references/sdk.md)。

## 测试

```
cd packages/core && npm test        # 单测 + CLI 端到端
node scripts/gen-golden.mjs         # 重建黄金语料（改解析逻辑后必跑）
```

## 跨语言策略

`.mc` 与 `mc export` 输出的 canonical JSON 与语言无关，任何语言都能读。但**同语言优先走工具提供的读取通路**：

* **JS / TS（本仓库）**：进程内调用 SDK（`open()` → `McDoc`），拿到**形状稳定的读取契约**与 `emitTsModule` 代码生成，不必自己解析 JSON。
* **其它语言**：构建期 `mc export` 编译为 JSON 再由标准库读取；请把**形状适配收敛到一个薄层**（导出形状会随语法演进）。
* 原生解析器移植（C/C++/Java/Go/Rust…）暂不提供，未来按需，以黄金语料为一致性基准。

**为什么不要直接消费导出的 JSON 形状**：那是**序列化契约**，随语法演进（v0.5.0 就把表格从"对象数组"改成了 `{id: {其余列}}`，打挂过真实下游）。SDK 的 `rows()` 是**读取契约**，形状稳定。

## 路线图

* [x] P0 语法规范 + 示例
* [x] P1 核心 SDK + mc CLI + 黄金语料
* [x] P2 Agent Skill：markdownconfig 技能文档，含 JS/TS SDK 详细用法
* [x] P3 发布：GitHub 公开仓库 + npm registry `markdownconfig`
* [x] v0.5.0：表格 id 列语义 + `mc set` 就地改格、`@array` 嵌套、报错指路、指纹补 `sha256File`
* [x] v0.6.0：评论搬进正文（`@comment` + 文末评论区）、删除全部审计功能（`.mc/` 目录、快照、watcher、哈希链）—— 留痕交给 git
* [x] v0.6.0：`McDoc` 稳定读取层 + `emitTsModule` 代码生成
* [x] v0.7.0：**安装收敛为两步**（Skill + 一条 npm 命令）；SDK 与 CLI 合并为一个包的两种入口；Python 库停止维护、VS Code 扩展独立出去
* [ ] Obsidian 插件（已暂缓，后续按需排期）
