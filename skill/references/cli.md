# mc CLI：安装与命令参考

`mc` 是 MarkdownConfig 命令行工具。

## 安装

工具通过 GitHub Release 分发（需要 Node.js 18+；网络受限时为终端配置代理）。**用固定版本 URL（不要用 latest，npx 会缓存导致升级不生效）**，下例为 v0.3.1：

- 零安装运行（首次自动下载官方 tgz、之后走缓存）：

  ```bash
  npx -y https://github.com/Meowllo/MarkdownConfig/releases/download/v0.3.1/markdownconfig.tgz <command>
  ```

- 全局安装：`npm install -g https://github.com/Meowllo/MarkdownConfig/releases/download/v0.3.1/markdownconfig.tgz`，之后直接用 `mc`。
- 升级（包名在 0.3.0 曾为 `@markdownconfig/core`，0.3.1 起固定为 `markdownconfig`）：先 `npm rm -g markdownconfig @markdownconfig/core 2>/dev/null` 再安装，避免 bin 冲突。
- Python 库（程序内直接读 .mc，读取时经 npx 自动调用同一版本 CLI）：`pip install https://github.com/Meowllo/MarkdownConfig/releases/download/v0.3.1/markdownconfig-py.tar.gz`。
- VS Code 编辑器：Release 下载 `markdownconfig-vscode.vsix` → Install from VSIX。
- 源码仓库：https://github.com/Meowllo/MarkdownConfig

## 命令一览

| 命令 | 用途 |
| --- | --- |
| `mc init <file>` | 初始化 .mc 文件骨架 |
| `mc validate <file>` | 校验语法与类型（通过无输出；出错带行号） |
| `mc export <file>` | 导出 canonical JSON（键递归排序、2 空格缩进） |
| `mc export <file> --order=declared` | 按声明顺序导出（默认按键排序） |
| `mc export <file> --allow-override` | 同名变量后者覆盖（默认重复声明报错） |
| `mc export <file> --fingerprint` | 顶层带来源指纹 `$fingerprint`（source/sha256/版本/时间），供过期门禁 |
| `mc get <file> <name>` | 读取单个变量值 |
| `mc blocks <file>` | 列出块（行区间、id、类型） |
| `mc tables <file> [--all]` | 列出已标记表 + 未标记表计数（`--all` 列明细） |
| `mc set <file> <name> <value>` | 修改/设置变量（自动落审计日志） |
| `mc add <file> <name> <value>` | 新增变量（自动落审计日志） |
| `mc comment <file> <target> <text>` | 添加评论（写入 journal，不进正文） |
| `mc comments <file>` | 列出未解决评论 |
| `mc resolve <file> <comment-id>` | 关闭评论 |
| `mc journal <file>` | 查看审计日志 |
| `mc log <file>` | 查看变更摘要 |
| `mc version` | 版本号 |

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
```

## 注意

- 审计日志 `.mc/journal.jsonl` 是 append-only 的审计轨；**正文才是真相**，不要用 journal 反推配置值。
- canonical JSON（键排序、2 空格）是跨语言一致性的基准；导出结果应可被任意语言的 JSON 解析器直接消费。
