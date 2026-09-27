# MarkdownConfig (.mc) 语法规范 v0.1

> 定位：一个 Markdown 超集文档格式。人类照常书写阅读，Agent 可结构化读取 / 编辑，
> 程序可以把文档中声明的 config 当作配置源读取。
> 设计原则：
>
> **文本是真相，journal 只做审计**
>
> ；
>
> **编译产物 = 标准 JSON**
>
> ；
>
> **语法极小**
>
> 。

## 1. 文件与兼容性



* 后缀 `.mc`，内容为 Markdown 超集：CommonMark 兼容正文 + 少量 HTML 注释标记。

* 现有 `.md` 升级：改名为 `.mc` 并添加标记即可，无需重写。

* GitHub 等标准 Markdown 渲染器可正常渲染（HTML 注释渲染时自动隐藏，值即所见文本）。

* MIME 识别可能需要注册为 text/markdown，否则部分工具按 text/x-csrc 等处理（不影响内容读取）。

## 2. 标记语法

### 2.1 单变量 `@var`



```
\<!--@var NAME \[type=TYPE]-->VALUE\<!--@/var-->
```



* `NAME`：标识符，支持点号命名空间（如 `site.title`，输出为嵌套对象）。

* `VALUE`：两个标记之间的文本，trim 后取值。标记渲染时隐藏，**所见即值**。

* `TYPE`（可选）：`string | number | int | boolean | json | text`；缺省自动推断。`int` 要求整数值，其余规则同 `number`。

* 自动推断按 JSON 语法：`42`→number，`true`→boolean，`[1,2]`→array，`{"a":1}`→object，

  `"abc"`（带引号）→string，其余 → string。

* 值含换行时**必须**声明 `type=json` 或 `type=text`，否则报错。

示例：



```
连接超时：\<!--@var TIMEOUT\_MS-->3000\<!--@/var-->毫秒
```

渲染后文档只显示「连接超时：3000 毫秒」，`mc export` 输出 `{ "TIMEOUT_MS": 3000 }`。

### 2.2 表格 `@table`



```
\<!--@table NAME-->

\| 列1 | 列2 |

\| --- | --- |

\| 1   | 2   |

\| 2   | 4   |

\<!--@/table-->
```



* 两个标记都必须**独占一行**（允许首尾空白）。

* 表头 = 键，单元格类型自动推断（规则同 `@var`；空单元格 → `null`）。

* 读出为对象数组：`[{ "列1": 1, "列2": 2 }, { "列1": 2, "列2": 4 }]`。

* 列名重复 / 表头与分隔行缺失 / 行单元格数不一致 → 报错。

### 2.3 普通注释



* 无 `@` 前缀的 `<!-- ... -->` 完全忽略，不产生任何变量。

* 出现在围栏代码块（` ``` ` 或 `~~~`）内的标记被忽略，不作为配置。

## 3. 块 ID（评论锚定与跳转）



* 行尾 `^id`（Obsidian 风格），或 `^id` 独立一行紧跟块后。

* 配置变量 / 表格本身可用 `NAME` 作为锚点（评论可指向变量名）。

* 示例：`# 产品需求 ^p1`、段落后跟一行 `^b12`。

## 4. 错误规则（fail loud）



| 情况                                      | 行为                                     |
| --------------------------------------- | -------------------------------------- |
| 标记未闭合 / 错配 / 嵌套                         | 报错（含行号）                                |
| 同名变量重复声明                                | 报错（`mc export --allow-override` 时后者覆盖） |
| 点号命名空间与标量冲突（`site.title` 与 `site` 同时存在） | 报错                                     |
| 值含换行但未声明 `type=json/text`               | 报错                                     |
| 表格列重复 / 结构不完整                           | 报错                                     |
| `@var` 出现在表格区域内、表格标记出现在 `@var` 值内       | 报错                                     |

## 5. journal（审计日志，文本为真相）



* 位置：文件所在目录或向上最近的 `.mc/` 目录，`journal.jsonl`，**append-only**。

* op 字段：`op`（create/update/comment/resolve/log）、`actor`（human|agent）、`ts`、

  `file`、`target`、`hash`、`prev_hash`、`text`。

* 哈希链：sha256（值文本），同一 target 的 op 通过 `prev_hash` 串成链 → 可验证、可审计。

* 评论：`op=comment`（`status=open`），`op=resolve` 关闭；**评论不进 .mc 正文**。

* 说明：P1 中 `mc set/add`（Agent 编辑）自动落 op；人类直接编辑文本的捕获（watcher）在 P2 编辑器接入。

## 6. canonical 输出



* `mc export` 输出：键名递归排序、2 空格缩进的 JSON。同输入永远同输出（字节稳定）。

* 该确定性输出是黄金语料的基准，也是跨语言移植（Tier 2）的一致性校验依据。

## 7. 变更记录



* v0.1：初始语法（@var / @table / 块 ID /journal/canonical JSON）。

* v0.2：`TYPE` 新增 `int`（整数值，其余规则同 `number`）。