# markdownconfig

**Markdown 版本的配置源**：把 `.mc` 文档（Markdown 超集）里的配置读进代码，或生成成确定性代码。
人类照常书写阅读，Agent 可结构化读取 / 编辑，程序把它当配置源。

这个包是**一个包两个入口**：

```bash
npm i markdownconfig
```

```ts
// SDK：读取走稳定读取层（表永远是"行对象数组"，导出格式变更不影响下游代码）
import { open, emitTsModule } from "markdownconfig";

const doc = open("example.mc");               // 或 fromSource(text) 用于内存内容
for (const r of doc.rows("T_LIMITS")) use(r.key, r.value);
doc.cell("T_LIMITS", "maxSlots", "value");
doc.value("server.port");                     // 支持点号路径

// 把配置生成进源码（游戏 / 小程序等运行时不读文件）：确定性输出，可用 --check 做门禁
const text = emitTsModule({
  source: "example.mc",
  fingerprint: doc.fingerprint({ timestamp: false }),
  consts: [{ name: "MAX_SLOTS", value: 4, doc: "最大槽位数" }],
});
```

```bash
# CLI（同一个包，同源实现）
npx markdownconfig export app.mc            # 导出 canonical JSON
npx markdownconfig get app.mc server.port   # 读单项
npx markdownconfig validate app.mc          # 校验，出错带行号
```

* 语法规范：[SPEC.md](https://github.com/Meowllo/MarkdownConfig/blob/main/SPEC.md)（唯一权威）
* 完整 SDK 用法：[skill/references/sdk.md](https://github.com/Meowllo/MarkdownConfig/blob/main/skill/references/sdk.md)
* 命令参考：[skill/references/cli.md](https://github.com/Meowllo/MarkdownConfig/blob/main/skill/references/cli.md)
* 仓库与问题：https://github.com/Meowllo/MarkdownConfig

MIT License
