# JS / TS SDK：把 .mc 读进代码、并把配置生成成代码

`markdownconfig` 是**一个包两个入口**：`mc` 命令行 + 同源的 JS/TS SDK。
两者共用同一套解析实现（`packages/core/src/*`），所以行为必然一致 —— **不需要也不要自己写解析器或 JSON 搬运**。

```
import { open, emitTsModule } from "markdownconfig";
```

* 读：`open()` → `McDoc`，表永远是"行对象数组"；
* 写：`emitTsModule()` 把配置声明式地生成成确定性代码。

## 什么时候用 SDK、什么时候用 CLI

| 场景 | 用哪个 | 理由 |
| --- | --- | --- |
| Agent 查 / 改文档、人工校验 | **CLI** | 零依赖、可复制粘贴、改动留给 git |
| 程序在运行时读配置（Node / 构建脚本 / 编辑器插件） | **SDK** | 不 spawn 进程、不经过 JSON 字符串往返、**拿到形状稳定承诺** |
| 把配置生成进源码（游戏 / 小程序等读不了文件的运行时） | **SDK + `emitTsModule`** | 走我们的读取与发射逻辑，不手写字符串拼接 |
| 非 JS 语言 | CLI（或各自的薄封装，如 Python 库） | canonical JSON 是跨语言契约 |

**关键区别**：CLI 的 `export` 输出是**序列化契约**（形状随语法演进），SDK 的 `McDoc` 是**稳定读取层**。下游代码应当依赖后者。

## 安装

```bash
# 首选：npm registry（可写 ^0.6.0 这类范围，跟随补丁/小版本升级）
npm i markdownconfig

# 离线 / 受限环境（构建插件里 PATH 窄、没网）：固定版本 URL
npm i https://github.com/Meowllo/MarkdownConfig/releases/download/v0.6.0/markdownconfig.tgz
```

* 需要 Node.js 18+；包**没有任何运行时依赖**（只用 Node 内置模块），可被 esbuild / rollup 直接打包。
* 装到项目里（`npm i`，不是 `npm i -g`）才能 `import`；`-g` 装的是 `mc` 命令。
* 只想跑 CLI：`npx markdownconfig export app.mc`。
* 子路径导出：`markdownconfig`（主入口）、`markdownconfig/reader`、`markdownconfig/codegen`、`markdownconfig/scanner`、`markdownconfig/table`、`markdownconfig/markers`。

## 读取：`McDoc`

```ts
import { open, McConfigError } from "markdownconfig";

const doc = open("example.mc");              // 也可 fromSource(text, name) 用于内存内容

doc.rows("T_ITEMS");                         // 行对象数组（含 id 列、按文档列序）
doc.row("T_ITEMS", "alpha");                 // 按 id 取一行
doc.cell("T_ITEMS", "alpha", "weight");      // 取一个格子
doc.value("server.timeoutMs");               // 变量；支持点号路径，与 mc get 一致
doc.table("T_ITEMS");                        // { idColumn, columns, ids, rows }
doc.tableNames();                            // 已标记的表名
doc.comments;                                // 正文里的评论（target / text / line）
doc.errors;                                  // 语法错误（不抛）
doc.configErrors;                            // 配置构建错误（重名等）
doc.ok;                                      // 以上都为 0
doc.allErrors;                               // 两者合并，便于一次报全
doc.fingerprint({ timestamp: false });       // 来源指纹；timestamp:false → 字节可复现
doc.raw;                                     // 原始序列化形状（逃生口，见下）
```

### 形状稳定承诺（这是用 SDK 的主要理由）

| 方法 | 承诺 |
| --- | --- |
| `rows(name)` | **永远**是行对象数组；每行的键序 = 文档列序，**id 列在首位**；行序 = 文档行序 |
| `columns` | 表头列名，含 id 列（首位） |
| `ids` | id 列表，按文档行序 |
| `value(name)` | 字面名优先，其次按 `.` 拆路径逐级下钻（`server.port`） |

举例：v0.5.0 把表格的**导出形状**从"对象数组"改成了 `{id: {其余列}}`，但 `rows()` 一直保持数组 —— 所以写成下面这样的下游代码**跨版本都不用改**：

```ts
const limits = {};
for (const r of doc.rows("T_LIMITS")) limits[r.key] = r.value;   // r.key / r.value 始终可用
```

**不要**用 `doc.raw` 或 `mc export` 的 JSON 去喂业务代码：那部分不享受承诺，形状变了就得改你的项目。

### fail loud

缺表 / 缺 id / 缺列 / 缺变量一律**抛 `McConfigError`**，消息里直接给可选值，不做静默兜底：

```
未找到已标记的表 `T_ITEMS`。文档中已标记的表：T_LIMITS, T_TAGS
表 `T_ITEMS` 中不存在 id `alpha`。现有 id：alpha, beta
表 `T_ITEMS` 的 `beta` 行不存在列 `cost`。可选列：id, weight, note
```

`open()` / `fromSource()` 自身不因**语法**错误抛异常（错误在 `doc.errors` 里），由你决定策略；只有"你要的东西不存在"才抛。

## 生成派生代码：`emitTsModule`

游戏 / 小程序这类运行时**读不了文件、也跑不了 CLI**，必须在构建期把配置落成源码。这一步也由工具做，不手写字符串拼接：

```js
import { open, emitTsModule } from "markdownconfig";
import { writeFileSync } from "node:fs";

const doc = open("example.mc");

// 领域校验仍由你写（这是设计规则，不是胶水）
const limits = {};
for (const r of doc.rows("T_LIMITS")) limits[r.key] = r.value;
if (!Number.isInteger(limits.maxSlots)) throw new Error("maxSlots 必须是整数");

const text = emitTsModule({
  title: "config.gen.ts —— 自动生成，不要手改。",
  source: "example.mc",
  generator: "scripts/gen-config.mjs",
  fingerprint: doc.fingerprint({ timestamp: false }),   // → SOURCE_SHA256 / SOURCE_MC_VERSION
  consts: [
    { name: "MAX_SLOTS", value: limits.maxSlots, doc: "最大槽位数" },
    { name: "RETRY", value: { base: limits.retryBase } },
    { name: "TIER_WEIGHTS", value: weights, doc: ["各档位权重", "行 = 第几档"] },
    { name: "TABLE", literal: "{\n    a: 1,\n} as const" },   // 逃生口：多行 / as const
  ],
});

writeFileSync("generated/config.gen.ts", text);
```

输出形态：

```ts
/**
 * config.gen.ts —— 自动生成，不要手改。
 *
 * 来源：`example.mc`
 * 生成器：`scripts/gen-config.mjs`
 *
 * 改数值 ⇒ 改 .mc，然后跑一次生成器；本文件是**派生物、不是第二个来源**。
 */

/** 来源指纹（源文本的 sha256）—— 离线门禁用它核对「生成物是否过期」 */
export const SOURCE_SHA256 = "cacc2ba1…";
/** 生成时用的 mc 版本 —— 便于发现「生成物是旧版工具产出的」 */
export const SOURCE_MC_VERSION = "0.6.0";

/** 最大槽位数 */
export const MAX_SLOTS = 4;
```

`ConstDecl` 字段：

| 字段 | 说明 |
| --- | --- |
| `name` | 导出名，必须是合法标识符（否则报错） |
| `value` | 任意 JS 值；自动 `JSON.stringify` 转义 |
| `literal` | 直接给字面量文本（与 `value` 二选一）；多行、`as const`、工具表达不了的形状用它 |
| `type` | TS 类型标注；缺省保守推断（**只有"同质标量数组"**会加标注，如 `number[]`） |
| `doc` | JSDoc，字符串或字符串数组 |

**确定性是硬要求**：同样输入必然逐字节相同的输出（所以 `fingerprint` 要传 `timestamp: false`），这样才能用 `--check` 做门禁：

```js
// scripts/gen-x.mjs --check
const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
if (cur !== text) { console.error("产物与 .mc 不一致，跑一次生成器"); process.exit(1); }
```

> 现成范例：仓库 `scripts/gen-golden.mjs` 用 SDK 读 fixtures 生成黄金语料。

## 常用写法对照

| CLI | SDK |
| --- | --- |
| `mc export f.mc` | `JSON.stringify(doc.raw)` / `canonicalJson(doc.raw)` |
| `mc export f.mc --fingerprint --no-timestamp` | `doc.fingerprint({ timestamp: false })` |
| `mc get f.mc server.port` | `doc.value("server.port")` |
| `mc get f.mc T.cpu.阈值` | `doc.cell("T", "cpu", "阈值")` |
| `mc validate f.mc` | `doc.errors` / `doc.allErrors` |
| `mc blocks f.mc` | `doc.blocks` |
| `mc comments f.mc` | `doc.comments` |
| `mc version` | `VERSION` |

`mc set/add/comment/resolve` 没有 SDK 对应方法 —— 它们会**改写文档正文**，属于"编辑"，请走 CLI 或编辑器（改动留给 git）。

## 常见坑

* **别把 `mc export` 的 JSON 结构写进业务代码**。要读就用 `rows()` / `cell()` / `value()`；导出形状只在跨语言场景下才需要关心。
* **别自己找 CLI**。SDK 不需要 CLI；只有非 JS 语言才需要（Python 库已内置查找逻辑）。
* **内存内容用 `fromSource()`**：这样 `fingerprint()` 不会写 `sha256File`（否则那个哈希描述的是盘上旧内容，做"产物过期"门禁会误判）。
* 生成器脚本里**不要**手拼 `"export const X = " + v`：引号转义、类型标注、字节稳定性都由 `emitTsModule` 负责。
* 领域校验（中文名映射、跨表引用、设计约束）**仍然要自己写** —— 那是业务规则，工具不该内置。
