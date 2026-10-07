# mc CLI：安装与命令参考

`mc` 是 MarkdownConfig 命令行工具。

## 安装

需要 Node.js 18+。**只有一个渠道：npm**（SDK 与 `mc` CLI 是同一个包，装一次两者都有、版本天然一致）：

```bash
npm i markdownconfig
```

- 之后用 `npx mc <命令>`（npx 解析到本项目的 `node_modules/.bin/mc`）。
- 只想零安装地跑一次：`npx -y markdownconfig@latest <command>`。
- 升级：`npm i markdownconfig@latest`。
- ⚠️ **升级后 `npx mc version` 核对一遍**：机器上留着旧版全局 `mc`（历史包名 `@markdownconfig/core`）时它可能被优先调用，症状是"新语法、新命令莫名报错"，而完全不像版本问题。
- 程序内读取用 SDK（`open()` → `McDoc`），见 [sdk.md](sdk.md)。
- 源码仓库：https://github.com/Meowllo/MarkdownConfig

## 命令一览

| 命令 | 用途 |
| --- | --- |
| `mc init <file.mc> [--force]` | 生成可直接校验通过的 .mc 骨架 |
| `mc validate <file>` | 校验语法与类型（通过输出 OK；出错带行号，常见误用带提示） |
| `mc export <file>` | 导出 canonical JSON（键递归排序、2 空格缩进） |
| `mc export <file> --order=declared` | 按声明顺序导出（默认按键排序） |
| `mc export <file> --allow-override` | 同名变量后者覆盖（默认重复声明报错） |
| `mc export <file> --fingerprint [--no-timestamp]` | 顶层带来源指纹 `$fingerprint` |
| `mc get <file> <name>` | 读取变量 / 表格 / 表格单元格（`TABLE.id.列`） |
| `mc get <file> <TABLE>.<id>.<列>#<标记名\|#序号>` | 读取该格内某个内联标记的值（见「片段寻址」） |
| `mc blocks <file>` | 列出块（行区间、id、类型） |
| `mc tables <file> [--all]` | 列出已标记表（id 行数 / 行区间）+ 未标记表计数 |
| `mc set <file> <name> <value>` | 修改变量 |
| `mc set <file> <TABLE>.<id>.<列> <value>` | 按 id 就地改表格单元格 |
| `mc set <file> <TABLE>.<id>.<列>#<标记名\|#序号> <value>` | **只改该格内某个内联标记**的值，句子与其它标记不动 |
| `mc add <file> <name> <value>` | 新增变量 |
| `mc comment <file> <target> <text>` | 追加一条评论到文末评论区 |
| `mc comments <file>` | 列出评论（带序号 `index`） |
| `mc resolve <file> <序号>` | 删除（解决）第 N 条评论 |
| `mc version` | 版本号 |

`mc` 只改正文，**不产生任何额外文件**；改动历史交给 git（`git log` / `git blame`）。

## 表格单元格的读写

表格读出为 `{ id: { 其余列 } }`（第一列是 id 列）。定位一个格子 = `<表名>.<id>.<列>`：

```bash
mc get app.mc METRICS.cpu.阈值        # → 80
mc set app.mc METRICS.cpu.阈值 85     # 只改这一格，标记与"人读注释"原样保留
```

* 该行只有一列数据时可省列名：`mc set app.mc METRICS.cpu 85`。
* id 列本身也可寻址（改名）：`mc set app.mc METRICS.cpu.id mem`。
* 命中不唯一（id 不存在 / 列不存在 / 一行多列却未指定列）会**报错并列出可选值**，不会猜。
* 写入后会**先复校验再落盘**：若改写会让文档校验失败（例如把 id 改成重复值），命令报错并**不修改文件**。

### 片段寻址：只改一格里的某一个标记

一格可以既有句子又有多个内联标记。列名后加 `#` 就能定位到其中**一个**：

```bash
# | aura | 身周 <!--@array range-->150<!--@/array--> px，每次 <!--@array dmg-->9/15<!--@/array--> 点伤害 |
mc get app.mc T_SKILL.aura.效果#dmg          # → [9,15]
mc set app.mc T_SKILL.aura.效果#dmg 20/30     # 只替换 9/15 → 20/30，句子与 range 一个字节都不动
mc set app.mc T_SKILL.aura.效果#1 200         # 也可以按序号（格内出现顺序，1-based）
```

* `#名字` 按标记名；`#序号` 按格内出现顺序（**无名 `@array` 只能这样寻址**）。
* 读回的是**该片段自己的值**：无名 `@array` 给的是它那个组（`[7,8]`），不是整格数组（`[[7,8]]`）。
* 新值走与 `mc set` 相同的解析规则（`type=string` 保留字面、百分号照常换算），且**值里不许出现标记**。
* **不带 `#` 时行为不变**：单个具名标记的格仍只替换标记内文本；其余情况整格替换 ——
  而整格替换含标记的格时，会往 **stderr** 打一条提示并列出可选片段（不阻塞、不污染 stdout）。
* 找不到名字/序号 → 报错并**列出可选片段**（如 `#1 range、#2 dmg`）；该格没有标记 → 报错并提示去掉 `#`。
* **id 列不支持按片段改**（改它等于改行 id）。
* 列名本身含 `#`（如 `C#`）时按整段列名匹配，不会被当选择器。

## 评论的读写

评论就存在正文里（文档末尾的「评论」区块），没有额外文件：

```bash
mc comment app.mc server.port "线上是 9090，需确认"   # append-only 追加
mc comments app.mc                                    # [{index, target, text, line}, …]
mc resolve app.mc 1                                   # 删除（解决）第 1 条
```

* 一条评论只含**目标 + 文本**：`<!--@comment target=目标-->文本<!--@/comment-->`；标记在渲染时隐藏，**文本可见**。
* 目标可以是变量名 / 表名 / `表.id.列` / 块 id；**多条评论可以指向同一个目标**，互不冲突。
* `mc resolve` 是**删除**而不是打状态；序号来自 `mc comments`。
* 评论**不进 `mc export`** 的配置输出。

## 典型流程

**创建并校验**：

```bash
mc init app.mc
# 编辑文件（写 Markdown + @var/@table 标记）
mc validate app.mc
mc export app.mc
```

**评论协作**：

```bash
mc comments app.mc                 # 1. 看人类提了哪些意见
mc set app.mc server.port 9000     # 2. 按意见修改
mc resolve app.mc 1                # 3. 删除（解决）对应评论
```

**程序读取（JS / TS，推荐）**：

```ts
import { open } from "markdownconfig";            // npm i markdownconfig

const doc = open("app.mc");
doc.value("server.port");                         // 8080（支持点号路径）
doc.cell("METRICS", "cpu", "阈值");                // 80
doc.rows("METRICS");                              // 行对象数组（含 id 列），形状跨版本稳定
```

缺表 / 缺 id / 缺列会**抛 `McConfigError` 并列出可选值**，不静默兜底。完整用法见 [sdk.md](sdk.md)。

**非 JS 语言的程序读取**：构建期跑 `mc export app.mc` 得到标准 JSON，交给该语言的标准 JSON 解析器；**形状适配请收敛到一个薄层**（导出形状会随语法演进，见下）。

## 注意

- 正文是唯一真相：值、说明、评论都在 `.mc` 里，**没有任何审计文件**。改动历史用 git 看（`git log -p app.mc`、`git blame`）。
- canonical JSON（键排序、2 空格）是跨语言一致性的基准；导出结果应可被任意语言的 JSON 解析器直接消费。
- **导出形状会随语法演进**（例如表格在 v0.5.0 由"对象数组"改为 `{id: {其余列}}`）。所以**不要把导出结构写进下游业务代码**；JS/TS 走 SDK 的稳定读取层，其它语言请把形状适配集中在一个薄层里。
- `$fingerprint.sha256` 是**源文本**的哈希（`sha256(JSON.stringify(源文本))`）；`sha256File` 才是**文件字节**的哈希（可直接 `shasum -a 256` 复算），且只在文档由文件读出时才有。`generatedAt` 破坏字节稳定，要可复现输出用 `--no-timestamp`。
- 想让配置级的差异在 `git diff` 里直接可读，可配一个 textconv（只影响显示，不影响合并）：

  ```bash
  git config diff.mc.textconv "mc export"      # 配合 .gitattributes: *.mc diff=mc
  ```

