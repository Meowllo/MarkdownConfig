# mc CLI：安装与命令参考

`mc` 是 MarkdownConfig 命令行工具。

## 安装

工具通过 GitHub Release 分发（需要 Node.js 18+；网络受限时为终端配置代理）。**用固定版本 URL（不要用 latest，npx 会缓存导致升级不生效）**，下例为 v0.5.0：

- 零安装运行（首次自动下载官方 tgz、之后走缓存）：

  ```bash
  npx -y https://github.com/Meowllo/MarkdownConfig/releases/download/v0.5.0/markdownconfig.tgz <command>
  ```

- 全局安装：`npm install -g https://github.com/Meowllo/MarkdownConfig/releases/download/v0.5.0/markdownconfig.tgz`，之后直接用 `mc`。
- 升级（包名在 0.3.0 曾为 `@markdownconfig/core`，0.3.1 起固定为 `markdownconfig`）：先 `npm rm -g markdownconfig @markdownconfig/core 2>/dev/null` 再安装，避免 bin 冲突。
- Python 库（程序内直接读 .mc，读取时经 npx 自动调用同一版本 CLI）：`pip install https://github.com/Meowllo/MarkdownConfig/releases/download/v0.5.0/markdownconfig-py.tar.gz`。
- VS Code 编辑器：Release 下载 `markdownconfig-vscode.vsix` → Install from VSIX。
- 源码仓库：https://github.com/Meowllo/MarkdownConfig

## 命令一览

| 命令 | 用途 |
| --- | --- |
| `mc init <file.mc> [--force]` | 生成可直接校验通过的 .mc 骨架 |
| `mc init [dir]` | 初始化 `.mc/` 审计目录 |
| `mc validate <file>` | 校验语法与类型（通过输出 OK；出错带行号，常见误用带提示） |
| `mc export <file>` | 导出 canonical JSON（键递归排序、2 空格缩进） |
| `mc export <file> --order=declared` | 按声明顺序导出（默认按键排序） |
| `mc export <file> --allow-override` | 同名变量后者覆盖（默认重复声明报错） |
| `mc export <file> --fingerprint [--no-timestamp]` | 顶层带来源指纹 `$fingerprint` |
| `mc get <file> <name>` | 读取变量 / 表格 / 表格单元格（`TABLE.id.列`） |
| `mc blocks <file>` | 列出块（行区间、id、类型） |
| `mc tables <file> [--all]` | 列出已标记表（id 行数 / 行区间）+ 未标记表计数 |
| `mc set <file> <name> <value>` | 修改/设置变量（自动落审计日志） |
| `mc set <file> <TABLE>.<id>.<列> <value>` | 按 id 就地改表格单元格 |
| `mc add <file> <name> <value>` | 新增变量（自动落审计日志） |
| `mc comment <file> <target> <text>` | 添加评论（写入 journal，不进正文） |
| `mc comments <file>` | 列出未解决评论 |
| `mc resolve <file> <comment-id>` | 关闭评论 |
| `mc journal <file>` | 查看审计日志 |
| `mc version` | 版本号 |

公共开关：`--no-journal`（不写审计日志、不创建 `.mc/` 目录）、`--actor=human|agent`。

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
mc resolve app.mc c-2              # 3. 关闭对应评论
```

**程序读取（Python 示例）**：

```python
from markdownconfig import load_config
cfg = load_config("app.mc")        # 读取时调用 mc CLI，无需预先编译
print(cfg["server"]["port"])
print(cfg["METRICS"]["cpu"]["阈值"])
```

## 注意

- 审计日志 `.mc/journal.jsonl` 是 append-only 的审计轨；**正文才是真相**，不要用 journal 反推配置值。
- canonical JSON（键排序、2 空格）是跨语言一致性的基准；导出结果应可被任意语言的 JSON 解析器直接消费。
- `$fingerprint.sha256` 是**源文本**的哈希（`sha256(JSON.stringify(源文本))`），`sha256File` 才是**文件字节**的哈希；`generatedAt` 破坏字节稳定，要可复现输出用 `--no-timestamp`。

