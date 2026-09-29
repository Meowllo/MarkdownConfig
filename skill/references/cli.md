# mc CLI：安装与命令参考

`mc` 是 MarkdownConfig 命令行工具。

## 安装

需要 Node.js 18+；网络受限时为终端配置代理。

- **零安装运行**（npm registry，固定版本保证可复现）：

  ```bash
  npx -y markdownconfig@0.6.0 <command>
  ```

- 全局安装：`npm install -g markdownconfig@0.6.0`，之后直接用 `mc`。
- 升级（包名在 0.3.0 曾为 `@markdownconfig/core`，0.3.1 起固定为 `markdownconfig`）：先 `npm rm -g markdownconfig @markdownconfig/core 2>/dev/null` 再安装，避免 bin 冲突。
- **JS / TS 程序内读取**：`npm i markdownconfig`，用 SDK（`open()` → `McDoc`），见 [sdk.md](sdk.md)。**这是同语言读取的推荐通路**。
- **离线 / 受限环境**（PATH 窄、无 registry 通路）：改用 Release 固定版本 tgz ——
  `npx -y https://github.com/Meowllo/MarkdownConfig/releases/download/v0.6.0/markdownconfig.tgz <command>`，或 `npm i -g <该 URL>`。
- Python 库（读取时经 npx 自动调用同一版本 CLI）：`pip install https://github.com/Meowllo/MarkdownConfig/releases/download/v0.6.0/markdownconfig-py.tar.gz`。
- VS Code 编辑器：Release 下载 `markdownconfig-vscode.vsix` → Install from VSIX。
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
| `mc blocks <file>` | 列出块（行区间、id、类型） |
| `mc tables <file> [--all]` | 列出已标记表（id 行数 / 行区间）+ 未标记表计数 |
| `mc set <file> <name> <value>` | 修改变量 |
| `mc set <file> <TABLE>.<id>.<列> <value>` | 按 id 就地改表格单元格 |
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

**非 JS 语言的程序读取（Python 示例）**：

```python
from markdownconfig import load_config
cfg = load_config("app.mc")        # 读取时调用 mc CLI，无需预先编译
print(cfg["server"]["port"])
print(cfg["METRICS"]["cpu"]["阈值"])
```

## 注意

- 正文是唯一真相：值、说明、评论都在 `.mc` 里，**没有任何审计文件**。改动历史用 git 看（`git log -p app.mc`、`git blame`）。
- canonical JSON（键排序、2 空格）是跨语言一致性的基准；导出结果应可被任意语言的 JSON 解析器直接消费。
- **导出形状会随语法演进**（例如表格在 v0.5.0 由"对象数组"改为 `{id: {其余列}}`）。所以**不要把导出结构写进下游业务代码**；JS/TS 走 SDK 的稳定读取层，其它语言请把形状适配集中在一个薄层里。
- `$fingerprint.sha256` 是**源文本**的哈希（`sha256(JSON.stringify(源文本))`）；`sha256File` 才是**文件字节**的哈希（可直接 `shasum -a 256` 复算），且只在文档由文件读出时才有。`generatedAt` 破坏字节稳定，要可复现输出用 `--no-timestamp`。
- 想让配置级的差异在 `git diff` 里直接可读，可配一个 textconv（只影响显示，不影响合并）：

  ```bash
  git config diff.mc.textconv "mc export"      # 配合 .gitattributes: *.mc diff=mc
  ```

