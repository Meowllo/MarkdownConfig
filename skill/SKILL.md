---

name: markdownconfig

description: 介绍并使用 MarkdownConfig（.mc）文件类型 ——Markdown 的严格超集，文档同时可供人类阅读、Agent 结构化查阅与局部编辑、程序作为配置源读取。当 Agent 需要：创建 .mc 文件、查阅或导出 .mc 中的配置（JSON）、局部编辑配置块、读取或处理人类在文档中留下的评论并据此修改、把 .mc 作为程序 / 代码的配置源、或将现有 .md 文档转换为 .mc 时使用。触发词包括「.mc」「MarkdownConfig」「升级为 .mc」「读取文档里的配置」「文档评论」等。



---

# MarkdownConfig：给人读、也给程序读的 Markdown

## MarkdownConfig 文件是什么

`.mc`（MarkdownConfig）是 **Markdown 的严格超集**：正文就是普通 Markdown，人照常写、照常读；额外用少量 HTML 注释标记，把文档里的值或表格 "声明" 成配置项，Agent 和程序可以直接按结构读取。

一句话：**.md 是 "给人读的文档"；.mc 是 "给人读、给 Agent 协作、也给程序当配置源的文档"。**

## MarkdownConfig 相比 Markdown 多解决了什么



1. **文档即配置源**：值和它的说明在同一处，`mc export` 直接出标准 JSON，不再有 "文档和配置文件各写各的、互相漂移"。

2. **结构化读取**：按变量名取值（`mc get`）、按块索引（`mc blocks`），不用 NLP 猜。

3. **局部编辑**：每个配置块有行区间和锚点，Agent 知道改哪里、改的是谁，不必整体重写。

4. **一切都在正文里**：值、说明、评论都是文本，**不留任何审计文件**；改动历史交给 git（谁改了什么，`git log`/`git blame` 就是答案）。

5. **评论协作**：人类在文档末尾的评论区提意见，Agent 读取评论后修改、再删掉该条评论。

6. **块级跳转**：`^id` 锚点支持文档内 / 文档间定位。

## 获取 mc 命令行工具（本地未安装时）

`mc` 是操作 .mc 的命令行。**不要自己手写解析器，也不要把 `mc export` 的 JSON 结构写进下游业务代码**（详见 [references/sdk.md](references/sdk.md)）。需要 Node.js 18+；网络受限时为终端配置代理。

* **首选，零安装**：直接用 npx 跑 npm registry 上的官方包（固定版本号，保证可复现）：

```
npx -y markdownconfig@0.6.0 export app.mc
```

* **或全局安装**：`npm install -g markdownconfig@0.6.0`，之后直接用 `mc`。

* **程序里直接用（JS / TS）**：装进项目 `npm i markdownconfig`，然后 `import { open, emitTsModule } from "markdownconfig"`。**这是下游读配置的推荐通路**，见 [references/sdk.md](references/sdk.md)。

* **升级（重要）**：包名在历史版本间变动过（0.1/0.2 为 `markdownconfig`、0.3.0 为 `@markdownconfig/core`，**0.3.1 起固定为 `markdownconfig` 不再变更**）。从旧版升级先卸载再装，避免 bin 冲突：
  `npm rm -g markdownconfig @markdownconfig/core 2>/dev/null; npm i -g markdownconfig@0.6.0`。

* **离线 / 受限环境**（构建插件里 PATH 窄、没有 npm registry 通路）：改用 Release 的固定版本 tgz ——
  `npm i -g https://github.com/Meowllo/MarkdownConfig/releases/download/v0.6.0/markdownconfig.tgz`，或零安装 `npx -y <该 URL> export app.mc`。

* **Python 程序直接读配置**：`pip install https://github.com/Meowllo/MarkdownConfig/releases/download/v0.6.0/markdownconfig-py.tar.gz`（库在读取时经 npx 自动调用同一版本 CLI，无需单独安装，见下文）。

* **VS Code 编辑器**：从 Release 下载 `markdownconfig-vscode.vsix`，扩展面板 → Install from VSIX。

* 确实要始终跟最新：用 `npx -y markdownconfig@latest`，或把 tgz 里的 `download/v0.6.0` 换成 `latest/download`（后者需加 `--prefer-online`，或升级后 `npm cache clean --force`）。

* 以上都不可用时（无 Node / 无网络）：.mc 仍是纯文本，可按 [references/syntax.md](references/syntax.md) 的标记规则人工 / 自行解析，但应优先获取官方工具以保证 canonical 输出一致。

## 创建 .mc 文件

### 新建文档规范（先设计，再动笔）

**config 不是必选项**：即使整篇文档没有任何 config 标记，也必须能被 Agent 快速局部浏览与编辑。分块索引的效率 = 检索文档任意内容平均花费的 token 数，取决于内容结构；理想结构是任意层级的每个 block 内容量一致、每个 block 的子 block 数量一致——实践中难以完美，按以下原则设计可尽量逼近：

1. **文档标题 + 摘要（定义内容边界）**：标题简短、精准概括全文；**摘要必写**，用最少 token 向 Agent 说明两点——什么情况下应**阅读**此文档、什么情况下应**编辑**此文档。

2. **目录 = 分块索引骨架（MECE）**：每个内容只存在于某个标题（block）之下；块与块内容边界清晰、尽量解耦。

3. **Block（标题）精准命名**：标题精准定义该块内容边界，让人和 Agent 仅凭标题即可判断——想查询的内容是否在此块下、是否需要改动此块内容。
   - 坏例：「这是什么」（"这"指文档、技能还是文件类型？）、「相比 .md 多解决了什么」（谁和谁比？）、「获取工具」（获取什么工具？）
   - 好例：「MarkdownConfig 文件相比 Markdown 文件多解决了什么」

### 从零创建

* `mc init app.mc` 生成一份**可直接通过校验**的骨架（已存在时加 `--force` 覆盖）；也可直接新建 `.mc` 文件写 Markdown，在需要的位置加标记。

* 标记渲染时自动隐藏，**值即所见文本**，不影响人读。

## 查阅 .mc



```
mc validate app.mc          # 校验语法与类型（fail loud，出错带行号）

mc export app.mc            # 导出 canonical JSON（键排序、2 空格缩进）

mc get app.mc server.port   # 取单个变量

mc get app.mc METRICS.cpu.等级   # 取表格单元格（按 id 定位）

mc blocks app.mc            # 列出块：行区间、id、类型

mc tables app.mc            # 列出已标记表（id 行数 / 行区间）+ 未标记表计数

mc comments app.mc          # 列出评论（带序号 target/text/line）
```

## 编辑 .mc



```
mc set app.mc server.port 9000      # 修改变量

mc set app.mc METRICS.cpu.阈值 85    # 按 id 改表格单元格（行列按名字定位，不用文本手术）

mc add app.mc feature.newFlag true  # 新增变量
```



* 需要锚定 / 跳转 / 评论的段落，行尾加块 id（Obsidian 风格），如 `# 服务配置 ^top` 或段落后单独一行 `^b12`。

* 表格单元格用 `<表名>.<id>.<列>` 定位；该行只有一列数据时可省列名。

* 改完直接落盘（正文即真相），**不产生任何额外文件**；改动历史由 git 记录。

## 评论工作流（人类提意见 → Agent 修改）

评论**就在正文里**（文档末尾的「评论」区块），没有额外文件：

```
## 评论

<!--@comment target=server.port-->线上是 9090，需确认<!--@/comment-->
```

1. Agent 查看评论：`mc comments app.mc`（返回带序号的 `target` / `text` / `line`）。

2. 按评论指向的目标（变量名 / `表.id.列` / 块 id）定位内容，用 `mc set/add` 修改。

3. 完成后**删除**该条评论：`mc resolve app.mc <序号>`（序号来自上一步；resolve 即删除，不做状态标记）。

4. 需要 Agent 侧主动加评论时：`mc comment app.mc <target> <text>`（append-only 追加到文末评论区）。

注意：多条评论可以指向同一个目标，互不冲突；评论不进 `mc export` 的配置输出。

## 作为程序配置源

**读取逻辑由工具提供，不要自己写"JSON → 代码"这一步** —— 否则工具以后调整导出形状，下游就得改项目代码。按下面的优先顺序选通路：

1. **JS / TS：用 SDK**（首选）

```ts
import { open } from "markdownconfig";

const doc = open("app.mc");
for (const r of doc.rows("T_FRAMEWORK")) use(r.key, r.value);   // 行对象数组，形状跨版本稳定
doc.cell("T_FRAMEWORK", "skillSlots", "value");
doc.value("server.port");
```

   要点：`rows()` 永远是"行对象数组（含 id 列）"，`value()` 支持 `server.port` 这种路径；缺表/缺 id/缺列会**直接报错并列出可选值**，不静默兜底。完整用法（含把配置生成成 TS 代码的 `emitTsModule`）见 [references/sdk.md](references/sdk.md)。

2. **要把配置生成进源码**（游戏 / 小程序等运行时不读文件的场景）：用 SDK 的 `emitTsModule` 产出确定性代码，仍**不要手拼字符串**。见 [references/sdk.md](references/sdk.md)。

3. **Python**：`pip install <Release 的 markdownconfig-py.tar.gz>`，然后 `from markdownconfig import load_config; cfg = load_config("app.mc")`（也可用 `get/comments/validate`；库在读取时经 npx 自动调用同一版本 CLI，也可用环境变量 `MC_CLI` 指定本地 CLI）。

4. **其它语言 / 最通用兜底**：`mc export app.mc` 得到标准 JSON。

**设计目标是像 JSON 一样跨语言通用**：canonical JSON 是跨语言的契约；但**同语言（JS/TS）请走 SDK**，让形状兼容由工具负责。

## 将现有 .md 转换为 .mc

很轻，三步：



1. 改后缀：`design.md` → `design.mc`（内容一行不用动）。

2. 插标记：把 "程序要读的值" 包 `<!--@var NAME-->值<!--@/var-->`，把要读的表格包 `<!--@table NAME--> ... <!--@/table-->`；叙事文字保持原样。

3. 校验：`mc validate design.mc`，再 `mc export` 核对 JSON。

## 语法速查



```
超时：<!--@var server.timeoutMs type=int-->3000<!--@/var--> 毫秒

<!--@table METRICS-->
| id | 阈值 | 等级 |
| --- | --- | --- |
| cpu | 80 | warn |
<!--@/table-->
   ↑ 第一列固定为 id 列（非空、标量、逐行唯一），读出 { "cpu": { "阈值": 80, "等级": "warn" } }

数组：标签 <!--@array TAGS-->a/b/c<!--@/array-->（`/` 分隔，逐元素推断；可加 type= 强制；空值=[]）

嵌套数组：<!--@array A-->1/2/<!--@array B-->3/4<!--@/array--><!--@/array-->
   ↑ 无名嵌套 → 裸子数组；具名嵌套 → 对象元素：A = [1, 2, { "B": [3, 4] }]

区间：<!--@range AttackRange-->1~5<!--@/range-->（读出 {min,max}；支持全角 ～；必须单行）

评论（放在文档末尾的「评论」区块，标记隐藏、文本可见）：
<!--@comment target=变量名或表.id.列或块id-->评论文本<!--@/comment-->
```



* 类型（可选）：`string | number | int | boolean | json | text`，缺省自动推断；**值含换行必须声明 `type=json` 或 `type=text`**。

* **表格第一列是 id 列**：导出为 `{ id: { 其余列 } }`（id 列本身不进行数据）；表格至少两列，id 不得为空或重复。

* 单元格四种形态：格内有**无名** `@array` → 整格按数组体切分（`A/B/<!--@array-->C/D<!--@/array-->` → `["A","B",["C","D"]]`）；整格**一个具名**标记 → 裸值；整格**多个**标记 → 对象 `{ 名: 值 }`；整格无标记 → 纯文本推断。**具名标记之外**的文本是**人读注释**，不进配置、保留在源文件（见 [references/syntax.md](references/syntax.md)）。

* 不带 `@` 的 `<!-- ... -->` 普通注释忽略；围栏代码块（``` / ~~~）内的标记忽略。**想展示标记本身（写示例）必须放进围栏**，否则会被当成真配置并以「关闭标记缺少开始标记」报错。

* 来源指纹：`mc export app.mc --fingerprint` 在顶层加 `$fingerprint`（source / sha256 / sha256File / mcVersion / generatedAt）；`sha256` 是**源文本**的哈希，`sha256File` 是**文件字节**的哈希（可直接 `shasum -a 256` 复算），`generatedAt` 会破坏字节稳定（要可复现就加 `--no-timestamp`）。下游忽略 `$` 前缀键。

完整语法、类型规则与错误表见 [references/syntax.md](references/syntax.md)；完整命令与参数见 [references/cli.md](references/cli.md)；**JS/TS 程序读取与代码生成见 [references/sdk.md](references/sdk.md)**。

## 常见坑



* 不手写解析器；不重写原文（转换只插标记，保留段落、顺序、措辞）。

* **不要把 `mc export` 的 JSON 结构写进下游业务代码** —— 那是序列化契约，形状会随语法演进。JS/TS 请用 SDK 的 `rows()` / `cell()` / `value()`，跨版本不用改代码。

* 表格开闭标记必须各占一行；表格内的变量/数组用**单元格内联标记**（见语法速查），不要把顶层 @var/@array 跨在表格区域上。

* **建表先想 id 列**：第一列会被当作 id 且必须逐行唯一。若原始表格第一列会重复（如"分组"列），要么调整列序让唯一的那列排到第一，要么补一列 id。

* 单元格里要表达"若干单位，其中某几个是一组"时用**无名嵌套 `@array`**（见语法速查），**不要把组拍平**——拍平会改变每个候选被选中的概率。

* 同名变量重复声明报错（覆盖需 `mc export --allow-override`）；`site.title` 与 `site` 并存报错。

* 值含换行未声明类型、标记未闭合 / 嵌套非法 → 报错。改完必跑 `mc validate`。
