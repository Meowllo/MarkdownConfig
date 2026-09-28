# MarkdownConfig 交接文档（HANDOFF）

> 受众：接手本项目的 Agent / 开发者。你应当熟悉 Markdown、Node/TypeScript、Python，
> 但
>
> **不需要**
>
> 预先了解本项目的历史。本文讲清楚：这是什么、为什么这么设计、代码在哪、
> 怎么构建发布、有哪些坑、下一步做什么。
> 交接时的项目状态：最新 Release 
>
> **v0.3.0**
>
> ，SPEC 
>
> **v0.4**
>
> ，仓库
> [https://github.com/Meowllo/MarkdownConfig](https://github.com/Meowllo/MarkdownConfig)
>
>  （public，默认分支 
>
> `main`
>
> ）。
> 交接日期：2026-09-28。



***

## 1. 这个项目是什么（一句话）

**MarkdownConfig（**`.mc`**）是 Markdown 的严格超集**：正文就是普通 Markdown，人类照常写、

照常读；额外用少量 **HTML 注释标记**把文档里的值 / 表格 / 区间 "声明" 成配置项（config），

Agent 能按结构索引、局部读取与编辑，程序能把它当**配置源**读出标准 JSON。

一句话区分：



* `.md` 是 "给人读的文档"；

* `.mc` 是 "**给人读、给 Agent 协作、也给程序当配置源**的文档 "。

它要替代的痛点是：**设计文档（.md）和程序配置（.json/.yaml/.env）各写各的、互相漂移**；

以及大 Markdown 文档里 Agent 只能靠 NLP 猜内容位置、无法安全地局部编辑。



***

## 2. 背景：为什么会有这个项目

发起者（人类）在做 "人类 + Agent 协作" 的工作流时，希望一份文档同时满足：



1. 像 `.md` 一样方便人类查阅和编辑；

2. Agent 能按结构索引、**局部读取 / 局部编辑**（不必整篇重写）；

3. 人类与 Agent 的每次编辑都**留痕、可追溯**；

4. 支持跳转到同文档 / 跨文档的章节或 block；

5. 外部代码能读取文档中的结构化数据，把文档**作为配置源**；

6. 有类似飞书文档的**评论**功能：人类在评论里提修改意见，Agent 读评论后修改。

约束（发起者反复强调，贯穿所有决策）：



* **用最少的开发量**完成需求；

* **最小化普及成本**（让人 / Agent 容易接受、容易从现有 .md 迁移）；

* 目标是像 JSON 一样**所有编程语言都能用**的通用配置源。



***

## 3. 核心设计决策（根本，勿轻易推翻）

接手后如果想 "重构"，先确认没有违背下面这些已经被验证过的决策：



1. **文本是真相（source of truth），journal 只做审计。**

   `.mc` 正文是唯一权威；`.mc/journal.jsonl` 是 append-only 的审计轨，

   **绝不能用 journal 反推配置值**。任何时候 `mc export` 都从正文实时解析。

2. **块 ID 源码可见（Obsidian 风格&#x20;**`^id`**）。**

   锚点直接写在源文件里（`# 标题 ^h1`、段落后单独一行 `^b12`），不依赖隐藏索引文件，

   人类和 Agent 都能看见、能跳转、能评论。

3. **Markdown 严格超集。**

   所有 CommonMark / GFM 内容原样合法；`.mc` 只 "增加" 标记，不改变 Markdown 语义。

   现有 `.md` 升级 = 改后缀 + 插标记，**不重写原文**（保留段落、顺序、措辞）。

4. **标记复用 HTML 注释&#x20;**`<!--@...-->`**。**

   标准 Markdown 渲染器（GitHub 等）会自动隐藏 HTML 注释，因此**标记零渲染成本**，

   编辑器也能直接在开源 Markdown 编辑器上改造，而不必从零写解析 / 渲染。

   新增语法时优先复用这套注释，而不是发明新符号。

5. **canonical JSON 是第一公民。**

   `mc export` 默认输出 "键名递归排序 + 2 空格缩进" 的 JSON，**同输入永远同输出（字节稳定）**。

   跨语言通用性靠 JSON，不靠各语言各自解析。

6. **fail loud（而不是静默兜底）。**

   标记未闭合、类型不匹配、名字非法等，必须报错并带行号；宁可让用户立刻看到，也不要静默

   产出错误配置。唯一被发起者明确接受的 "静默" 是：**单元格标记关闭后的 "尾巴" 文本当人读注释**

   （不报错、不进配置、但保留在源文件）。



***

## 4. 架构与代码地图

### 4.1 目录与职责



```
MarkdownConfig/

├── SPEC.md                  # 语法规范（权威，当前 v0.4）

├── README.md                # 项目介绍 + 快速开始

├── HANDOFF.md               # 本文件

├── bin/mc                   # 仓库级 CLI 包装（require packages/core/dist/cli.js）

├── scripts/gen-golden.mjs    # 由参考实现重新生成黄金语料期望 JSON

├── examples/                # 示例 .mc（app.mc 等；含 examples/.mc 审计目录）

│

├── packages/core/           # ★ 核心：TypeScript SDK + mc CLI（单一事实实现）

│   ├── src/

│   │   ├── types.ts         # 全部类型定义（Var/Array/Range/Table Entry、Block、JournalOp）

│   │   ├── infer.ts         # 值推断 inferValue / parseArrayValue / parseRangeValue

│   │   ├── scanner.ts       # ★ 主解析器 parse()：fence/table 感知、块扫描、错误收集

│   │   ├── table.ts         # GFM 表格解析 parseTable() + 单元格三态 parseCell()

│   │   ├── config.ts        # buildConfig()：点号命名空间嵌套、去重/冲突、canonical

│   │   ├── journal.ts       # 审计日志读写、哈希链、评论、hashOf

│   │   ├── cli.ts           # ★ mc 命令行入口（命令分发、VERSION、HELP）

│   │   └── index.ts         # SDK 公共导出

│   ├── dist/                # tsc 产物（gitignore；发布与 npx 用）

│   └── test/

│       ├── core.test.mjs    # 核心测试（node --test，14 个）

│       └── fixtures/        # 黄金语料：\*.mc + 同名期望 \*.json

│

├── packages/vscode/         # VS Code 扩展（预览/编辑/评论/留痕）

│   ├── src/

│   │   ├── extension.ts     # 激活、命令注册、webview、文档模式

│   │   ├── pure.ts          # 纯逻辑（高亮/hover/选中锚定/LCS 文本 diff），可单测

│   │   ├── render-preprocess.ts  # 渲染前：标记→蓝色 span / 表格标签（仅影响显示）

│   │   ├── watcher.ts       # 保存时比对快照、双轨留痕（actor=human）

│   │   ├── comments.ts      # 评论数据接入

│   │   └── webview.js       # 文档模式 webview（构建时内联，避免外链加载失败空白）

│   ├── test/                # 纯逻辑测试（23 个）

│   ├── scripts/             # esbuild 打包 bundle / bundle-webview

│   └── resources/icon.svg

│

├── python/                  # Python Tier-1 读取库（读取时经 npx 调 CLI，零依赖）

│   ├── markdownconfig/\_\_init\_\_.py

│   └── tests/test\_mcpy.py

│

├── skill/                   # ★ Agent Skill：教 Agent 如何用 .mc

│   ├── SKILL.md

│   └── references/{syntax.md, cli.md}

│

└── packages/markdownconfig/ # ⚠ 历史残留：0.2.0 时代的发布包，已被 packages/core 取代
```

> `packages/markdownconfig/`
>
>  是早期包结构的遗留，
>
> **当前发布以&#x20;**
>
> `packages/core`
>
> **&#x20;为准**
>
> 。
> 接手后可在确认无引用后清理（见 §9 教训：包名变更）。

### 4.2 解析数据流（理解这条线就理解了核心）



```
源文本 source

&#x20; │

&#x20; ├─ scanner.fenceRanges()      → 围栏代码块区间（围栏内标记一律忽略）

&#x20; ├─ scanner.scanBlocks()       → 文档结构块（heading/paragraph/table）+ ^id

&#x20; │

&#x20; ├─ Pass1：定位独占行的 @table 区域（含非法表名检测，#2）

&#x20; ├─ Pass2：BLOCK\_RE 扫顶层 @var/@array/@range（跳过 fence 与 table 区域）

&#x20; │         表格内联标记不在此处理

&#x20; └─ Pass3：对每个 table 区域调 table.parseTable()

&#x20;             └─ parseCell()：单元格三态（裸值 / 对象 / 尾巴=注释）

&#x20; │

&#x20; ├─ result.entries（Var/Array/Range/Table）+ blocks + errors（已按 行:消息 去重）

&#x20; │

&#x20; └─ config.buildConfig()  → 点号命名空间嵌套、重复/冲突检测

&#x20;       └─ canonicalJson() / declaredOrderJson() → 输出
```

两套并行的 "块" 模型，不要混淆：



* **文档结构块**（heading /paragraph/table，用 `^id` 锚定）：服务 "人类阅读结构 + Agent 局部浏览"；

* **config 块**（@var/@array/@range/@table，用**变量名**寻址）：服务 "程序读取配置"。

**分块索引不预先创建、不落盘**：每次 `mc` 命令都实时 parse（纯文本解析足够快），

journal 只做审计。大文件定位手段：`mc get`（按变量名）、`mc blocks`（行区间）、

`mc tables`（表清单）、`mc export`（稀疏 JSON 目录）。



***

## 5. 语法与类型速览（细节以 SPEC.md 为准）



| 块   | 语法                                                    | 导出                     |
| --- | ----------------------------------------------------- | ---------------------- |
| 单变量 | `<!--@var NAME [type=T]-->VALUE<!--@/var-->`          | `{NAME: VALUE}`        |
| 数组  | `<!--@array NAME [type=T]-->1/2/3<!--@/array-->`      | `{NAME:[1,2,3]}`       |
| 区间  | `<!--@range NAME-->1~5<!--@/range-->`                 | `{NAME:{min:1,max:5}}` |
| 表格  | `<!--@table NAME-->` 换行 + GFM 表 + 换行 `<!--@/table-->` | `{NAME:[ {列:值}, … ]}`  |



* `NAME`：匹配 `[A-Za-z_][A-Za-z0-9_.]*`，支持点号命名空间（`server.port` → 嵌套对象）。

  **表名 / 变量名不可用非 ASCII（中文）**，否则报错（#2）。

* 标量类型：`string | number | int | boolean | json | text`；缺省自动按 JSON 推断

  （`42`→number，`true`→boolean，`[1,2]`→json，普通文本→string），空单元格→`null`。

* `@range`：`~` 分隔（支持全角 `～`）、允许 `**bold**`、两端必须数字、必须单行。

* 数组以 `/` 分隔、逐元素推断，空值→`[]`，可跨行。

* **单元格三态**：整格一个标记→**裸值**；整格多个标记→对象 `{名:值}`；

  标记关闭后的尾巴→**人读注释**（不进配置、保留源文件）。

* 无 `@` 的普通 HTML 注释 `<!-- ... -->` 忽略；围栏代码块内的标记忽略。

* 想在文档里**展示标记本身（写示例）必须放进围栏**，否则会被当成真配置（#14）。



***

## 6. 构建 / 测试 / 发布流程

### 6.1 环境



* Node v22.23.2、npm 10.9.8、GitHub CLI gh 2.101.0（已登录账号 `Meowllo`）。

* 系统 Python `/usr/bin/python3`（3.9，sandbox 内无 pytest；冒烟脚本可直接跑）。

* **网络：终端访问 GitHub / 下载 Release /npx 远程包都必须走代理**：

  `HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897`

  （Clash Verge，HTTP/HTTPS/SOCKS 同端口）。不走代理直连 github 会 i/o timeout。

* gh 的 GraphQL 端点在本环境连续 EOF：**查 issue 优先用&#x20;**`gh api`**&#x20;REST**；

  网络偶发 TLS handshake timeout / EOF，重试即可（对象往往实际已上传）。

### 6.2 测试（交付前必须全绿）



```
\# Core（构建 + node --test，当前 14 个）

cd packages/core && npm test

\# VS Code（构建 core + tsc + 打包 + node --test，当前 23 个）

cd packages/vscode && npm test

\# Python 冒烟（用本地 CLI，避免网络）

MC\_CLI="node /Users/sunmingjun/Projects/MarkdownConfig/packages/core/dist/cli.js" \\

&#x20; /usr/bin/python3 /Users/sunmingjun/Projects/MarkdownConfig/python/tests/test\_mcpy.py

\# 重新生成黄金语料（改动解析逻辑后）

node scripts/gen-golden.mjs
```

### 6.3 打包四个发布资产



```
\# 1) CLI tgz（npm pack 产出 scoped 名，复制为固定资产名）

cd packages/core && npm run build && npm pack

cp markdownconfig-core-\<VER>.tgz markdownconfig.tgz

\# 2) Python sdist（build 模块装在 user site，需 PYTHONPATH；隔离构建）

cd ../../python

PYTHONPATH=/Users/sunmingjun/Library/Python/3.9/lib/python/site-packages \\

&#x20; /usr/bin/python3 -m build --sdist

cp dist/markdownconfig-\<VER>.tar.gz markdownconfig-py.tar.gz

\# 3) VS Code vsix（staging 目录 + vsce，走代理下 vsce）

cd ../packages/vscode && npm run build

rm -rf .stage markdownconfig-vscode.vsix && mkdir .stage

cp -R out resources/icon.svg package.json README.md .vscodeignore .stage/

(cd .stage && HTTPS\_PROXY=http://127.0.0.1:7897 HTTP\_PROXY=http://127.0.0.1:7897 \\

&#x20; npx --yes @vscode/vsce package --no-dependencies --out ../markdownconfig-vscode.vsix)

rm -rf .stage

\# 4) Skill tar.gz（包内顶层直接是 SKILL.md + references/）

cd ../.. && (cd skill && tar czf markdownconfig-skill.tar.gz SKILL.md references)
```

### 6.4 发布 Release + 推送



```
\# 提交代码（dist/out/tgz/vsix 均已 gitignore）

git add -A && git commit -m "..."&#x20;

HTTPS\_PROXY=http://127.0.0.1:7897 HTTP\_PROXY=http://127.0.0.1:7897 git push origin main

\# 创建 Release 并上传资产

HTTPS\_PROXY=... gh release create v\<X.Y.Z> --title "v\<X.Y.Z>" --notes "..."

HTTPS\_PROXY=... gh release upload v\<X.Y.Z> \\

&#x20; markdownconfig.tgz markdownconfig-py.tar.gz markdownconfig-vscode.vsix markdownconfig-skill.tar.gz \\

&#x20; \--clobber

\# 验证远程固定版本 URL（这是 Skill 教 Agent 用的真实命令）

HTTPS\_PROXY=... npx -y \\

&#x20; https://github.com/Meowllo/MarkdownConfig/releases/download/v\<X.Y.Z>/markdownconfig.tgz version
```

### 6.5 版本号约定（当前有点不同步，留意）



| 组件                                           | 当前版本                         |
| -------------------------------------------- | ---------------------------- |
| `packages/core` package.json / CLI `VERSION` | 0.3.1                        |
| Python 库 /pyproject                          | 0.3.1                        |
| VS Code 扩展                                   | 0.4.0                        |
| SPEC                                         | v0.4                         |
| GitHub Release / pin URL                     | **v0.3.1**（跟 CLI/core 工具版本走） |

发布与文档统一 **pin 固定版本 URL，不用&#x20;**`latest`（npx 按 URL 缓存，latest 升级不生效）。

建议后续把 "工具版本 / SPEC 版本 / 扩展版本" 的关系在发版时明确，避免进一步发散。



***

## 7. 当前状态与待办（open issues）

v0.3.0 已闭环 issue #1–#6。**v0.3.1 已修复 #7、#8、#9**（见下方标注）。其余 **#10–#14 仍 OPEN**，按性质归类：

**Bug / 失效（建议优先）**



* **#7 Skill frontmatter 用了&#x20;**`***`**&#x20;而非&#x20;**`---`：宿主解析器读不到 name/description，

  **skill 装了但永不触发、且不报错**（静默失效）。改动极小（`skill/SKILL.md` 两处分隔符），

  但影响最严重，**建议第一个修**。注意：仓库 `skill/` 与发布 tar.gz 都要改并重发。

* **#9 EPIPE 未处理**：`mc ... | head/less/grep -m1` 时进程崩溃、退出码非 0。

  修法：CLI 入口加 `process.stdout.on('error', e => e.code==='EPIPE' ? process.exit(0) : throw e)`。

* **#8 全局安装无法原地升级**：包名在 0.2.0（`markdownconfig`）→ 0.3.0（`@markdownconfig/core`）

  之间变了，npm 视为不同包、拒绝覆盖 bin。需在文档写明 " 先 `npm rm -g markdownconfig` 再装 "，

  或把对外发布包名固定回 `markdownconfig`。

**功能缺口（配置闭环相关）**



* **#12 表格单元格没有 "就地写入" 命令**：`mc set` 只支持 @var，而配置大多在表格里；

  Agent 改表格只能做脆弱的文本手术。建议 `mc set <file> TABLE.<key> <v>` /

  `--where=key=.. --col=..`，天然落 journal。

* **#13 键值对表（key/value 两列）无官方写法**：下游要自己 reduce 成 map、且无重复 key 校验。

  建议 `@table type=map key=key value=value` 或独立 `@map`；至少把 "key 重复" 变报错。

* **#11 @array 不支持嵌套 "组"**：表达 "三选一" 会被压平、改变概率（属数值改动）。

  当前退路是该格用 `@var type=json` 手写嵌套 JSON。

**文档缺口**



* **#10&#x20;**`$fingerprint.sha256`**&#x20;算法未文档化**：实测 = `sha256(JSON.stringify(源文本字符串))`，

  **不是文件字节的 sha256**（外层 JSON.stringify 反直觉）；另需注明 `generatedAt` 会破坏字节稳定。

* **#14 正文里的标记会被当真配置**，但报错只说 "关闭标记缺少开始"，没提示 "示例要放围栏"。

  建议报错追加围栏提示，并在 syntax.md 反向提醒。

建议排期：**#7、#9、#8 已在 v0.3.1 修复**；下一步 **#12、#13（表格配置闭环，价值最高）**；

\#10、#14 随文档一起补；#11 按需。



***

## 8. 开发规范（请遵守发起者的偏好）



* **最小开发量 / 最小普及成本**：能复用 HTML 注释、复用现有开源 Markdown 编辑器 / 解析器，

  就不要自研；新增语法优先沿用现有注释风格。

* **文档面向 "完全不懂的受众"**：先讲是什么 / 为什么 / 与现状（.md）的区别，再讲怎么用；

  简单操作点到为止，不长篇大论。

* **md → mc 只插标记，不重写原文**。

* **错误带行号、fail loud**；只有 "单元格尾巴 = 人读注释" 是被接受的静默。

* **canonical 字节稳定**：改解析逻辑后必须更新黄金语料并跑通全部测试。

* **破坏性变更要显式**（如 v0.3 把 "单标记单元格" 从 `{名:值}` 改为裸值）：

  同步改测试期望、SPEC 变更记录、Release notes。

* 发布物只用 GitHub Release，固定版本 pin；不把 `.mc/` 审计目录、dist、tgz、vsix 提交进仓库。

* Skill 目录内不写 README / CHANGELOG；正文命令式、控制篇幅，细节放 `references/`。



***

## 9. 经验教训（真实踩坑，重点阅读）



1. **Skill frontmatter 必须是&#x20;**`---`**，不是&#x20;**`***`**（#7）。**

   `***` 只是 Markdown 水平线，不是 YAML 分隔；用错会让 skill **静默永不触发**。

   交付 Skill 前，务必按宿主加载器的真实正则核对 frontmatter。

2. **包名一旦发布就不要改（#8）。**

   0.2.0 叫 `markdownconfig`、0.3.0 改成 `@markdownconfig/core`，导致所有老用户全局升级失败、

   且报错指不到真因。对外发布的包名 /bin 名应从一开始固定。

3. **CLI 必须处理 EPIPE（#9）。**

   输出接 `head/less` 是最自然用法，不监听 stdout `error` 就会崩、退出码非 0，脚本误判失败。

4. **哈希算法要 "可离线复算 + 写进文档"，且别反直觉（#10）。**

   fingerprint 用了 `sha256(JSON.stringify(文本))` 而非文件字节，下游为离线门禁只能复刻实现；

   含时间戳的字段会破坏字节稳定。对外暴露的哈希，优先选最易复算的那种（文件字节），并文档化。

5. **块扫描器会被 "标记行" 带偏（本项目自踩）。**

   `scanBlocks` 先遇到独占行的 `<!--@table-->` 开放标记，会把其后整张表当段落吞掉，

   导致表格不被识别、`mc tables` 行区间错误。修法：扫描时跳过独占行的 table 开闭标记。

   教训：结构识别要考虑 "标记行不属于内容块"。

6. **npx 按 URL 缓存，固定版本才可靠。**

   用 `latest` URL 升级后本地不刷新（curl 直下才是新版）；统一 pin 版本，验证用全新 URL。

7. **破坏性的语义变更（单标记裸值）会连带黄金语料、测试、文档、下游全部要改。**

   做这类变更时一次性把所有期望同步，别遗漏。

8. **网络环境要显式处理。**

   终端必须走代理；GraphQL 不稳就换 REST；TLS/EOF 多为瞬时，重试并以远程实际状态为准

   （用 `gh api` / `git ls-remote` 核验，不要因一次报错就判定失败）。

9. **报错措辞要指向真因。**

   \#2（非法表名）、#12（表格不支持 set）、#14（示例要围栏）都曾因报错只说表面现象

   （"关闭缺少开始"" 未找到变量 "）让使用者排查很久。报错应区分场景、给出可操作提示。



***

## 10. 设计思考与未来方向



* **跨语言通用性的三层策略**：


  * **Tier 0**：构建期 `mc export` 成 canonical JSON，任何语言标准库读，零成本（第一公民）。

  * **Tier 1（当前主形态）**：语言侧薄封装，**读取时**才调 CLI（不要求编辑后跑 CLI）。

    Python 库即此形态：找不到本地 mc 就经 npx 拉固定版本 Release；也可用 `MC_CLI` 指定。

  * **Tier 2（未来按需）**：原生解析器移植（C/C++/Java/Go/Rust…），以黄金语料做一致性基准。

  * 结论：**适配所有主流语言的额外成本很低**—— 绝大多数语言只需读 JSON 或写一层调 CLI 的薄封装；

    只有追求 "无 Node 依赖 / 极致性能" 时才需要原生移植。

* **为什么放弃 npm / PyPI 发布**：npm 经多轮 web 授权始终报 Invalid/Expired Token；

  PyPI 的 2FA 需要手机外网扫码。发起者拍板 **GitHub-only 分发**（Release 托管四资产，

  Agent 用固定版本 URL `npx -y <tgz>` 零安装）。PyPI 是暂缓非永久；npm 若后续 token 问题

  解决可再补，但 GitHub Release 已足够。

* **明确不做 / 暂缓**：列级表格选项（`cols=` / `strip=`，发起者判定不需要）；

  Obsidian 插件、dsh（deepseek harness）插件（取消排期，后续按需）。

* **新建 .mc 文档的结构规范（已写入 Skill）**：config 不是必选项，纯 Markdown 也应能被高效

  局部浏览。理想结构是各层 block 内容量、子块数量尽量一致。三原则：

1. 写简短标题 + **必写摘要**（说明 "什么情况下该读 / 该编辑此文档"）；

2. 目录遵循 MECE，块边界清晰、互相解耦；

3. Block 标题精准命名（坏例 "这是什么"" 获取工具 "；好例"MarkdownConfig 相比 Markdown 多解决了什么 "）。

* **值得继续的方向**：表格配置闭环（#12 就地写入、#13 map 形态）是 "文档即配置源" 真正高频、

  高价值的部分；评论工作流（人类提意见→Agent 修改→resolve）已具备，后续可在编辑器里继续打磨

  选中即评论的体验。



***

## 11. 上手 Checklist（接手后建议顺序）



1. 读 `SPEC.md`（语法权威）与本文件；跑通 §6.2 三组测试，确认本地环境与代理可用。

2. 修复 **#7（Skill frontmatter&#x20;**`***→---`**）**，重打 skill 包并发一个修复 Release，验证 skill 能被触发。

3. 修 **#9（EPIPE）、#8（升级路径 / 包名）**，成本都很低。

4. 补 #10、#14 的文档（fingerprint 算法、围栏提示）。

5. 规划 **#12、#13**（表格就地写入 /map 表）—— 这是下一步功能主线。

6. 每次改动：更新黄金语料 → 全绿测试 → 同步 SPEC/Skill/README → 固定版本 Release → 提交推送 → 远程验证。

> 关键心法：
>
> **正文是真相、JSON 是通用接口、journal 只审计；能复用就不自研；错误要 fail loud**
> **且指向真因；版本固定、可复算。**