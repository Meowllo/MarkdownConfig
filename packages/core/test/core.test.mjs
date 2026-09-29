/** MarkdownConfig 核心测试（node --test，纯 JS） */

import assert from "node:assert/strict";
import child_process from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildConfig,
  canonicalJson,
  emitTsModule,
  fromSource,
  McConfigError,
  open,
  parse,
  VERSION,
} from "../dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");

function read(name) {
  return fs.readFileSync(path.join(fixtures, name), "utf8");
}

test("黄金语料：fixtures 输出与期望 JSON 完全一致", () => {
  const files = fs
    .readdirSync(fixtures)
    .filter((f) => f.endsWith(".mc") && !f.startsWith("invalid"));
  assert.ok(files.length >= 3, "至少需要 3 个黄金语料文件");
  for (const f of files) {
    const expected = read(f.replace(/\.mc$/, ".json"));
    const res = parse(read(f));
    assert.deepEqual(res.errors, [], `${f} 不应有解析错误`);
    const { config, errors } = buildConfig(res);
    assert.deepEqual(errors, [], `${f} 不应有组装错误`);
    assert.equal(canonicalJson(config), expected, `${f} canonical JSON 不一致`);
  }
});

test("非法输入产生错误（fail loud）", () => {
  const res = parse(read("invalid-unclosed.mc"));
  assert.ok(res.errors.length > 0, "invalid-unclosed.mc 应有错误");
  const msgs = res.errors.map((e) => e.message).join(" | ");
  assert.match(msgs, /未闭合/);
  assert.match(msgs, /嵌套/);
});

test("重复变量：默认报错，allowOverride 后者覆盖", () => {
  const src = "<!--@var X-->1<!--@/var-->\n<!--@var X-->2<!--@/var-->\n";
  const res = parse(src);
  assert.equal(res.errors.length, 0);
  const { errors } = buildConfig(res);
  assert.ok(errors.length > 0, "重复声明应报错");
  const { config, errors: e2 } = buildConfig(res, { allowOverride: true });
  assert.equal(e2.length, 0);
  assert.equal(config.X, 2);
});

test("命名空间冲突：site.title 与 site 标量冲突", () => {
  const src = "<!--@var site-->x<!--@/var-->\n<!--@var site.title-->y<!--@/var-->\n";
  const res = parse(src);
  const { errors } = buildConfig(res);
  assert.ok(errors.length > 0, "命名冲突应报错");
});

test("类型：int 整型 / 未知类型报错 / 类型不匹配报错", () => {
  const ok = parse("<!--@var N type=int-->42<!--@/var-->\n");
  assert.equal(ok.errors.length, 0);
  assert.equal(buildConfig(ok).config.N, 42);

  const badInt = parse("<!--@var N type=int-->4.5<!--@/var-->\n");
  assert.match(badInt.errors[0]?.message ?? "", /invalid int/);

  const badType = parse("<!--@var N type=float-->1<!--@/var-->\n");
  assert.match(badType.errors[0]?.message ?? "", /unknown type/);

  const badNum = parse("<!--@var N type=number-->abc<!--@/var-->\n");
  assert.match(badNum.errors[0]?.message ?? "", /invalid number/);
});

test("set 就地改写：值文本被精确替换且重新推断", () => {
  const src = "超时：<!--@var TIMEOUT_MS-->3000<!--@/var-->毫秒\n";
  const res = parse(src);
  assert.equal(res.errors.length, 0);
  const entry = res.entries[0];
  assert.equal(entry.kind, "var");
  const newSource = src.slice(0, entry.valueStart) + "5000" + src.slice(entry.valueEnd);
  assert.equal(newSource, "超时：<!--@var TIMEOUT_MS-->5000<!--@/var-->毫秒\n");
  const res2 = parse(newSource);
  assert.equal(res2.entries[0].value, 5000);
});

test("围栏代码块内的标记被忽略", () => {
  const src = "```text\n<!--@var X-->1<!--@/var-->\n```\n\n<!--@var Y-->2<!--@/var-->\n";
  const res = parse(src);
  assert.equal(res.errors.length, 0);
  assert.deepEqual(
    res.entries.map((e) => e.name),
    ["Y"],
  );
});

test("块扫描：标题/段落/表格与 ^id", () => {
  const src = "# 标题 ^h1\n\n段落一 ^p1\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n^tbl\n";
  const res = parse(src);
  const ids = res.blocks.map((b) => b.id).filter(Boolean);
  assert.ok(ids.includes("h1"));
  assert.ok(ids.includes("p1"));
  assert.ok(ids.includes("tbl"));
});

test("评论区：append-only 追加、按序号删除、不进配置", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-comment-"));
  const file = path.join(tmp, "c.mc");
  const cli = path.join(__dirname, "..", "dist", "cli.js");
  fs.writeFileSync(file, "# t\n\n超时：<!--@var X-->1<!--@/var-->\n", "utf8");
  const run = (args) =>
    child_process.execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  assert.equal(run(["comment", file, "X", "第一条"]).trim(), "已添加评论 → X");
  run(["comment", file, "X", "第二条"]);
  run(["comment", file, "X", "第三条"]); // 同一目标允许多条，互不冲突

  const src = fs.readFileSync(file, "utf8");
  assert.match(src, /## 评论/);
  assert.equal(src.match(/<!--@comment/g).length, 3);

  const list = JSON.parse(run(["comments", file]));
  assert.deepEqual(
    list.map((c) => [c.index, c.target]),
    [
      [1, "X"],
      [2, "X"],
      [3, "X"],
    ],
  );

  // 评论不进配置，且文档仍然合法
  assert.deepEqual(JSON.parse(run(["export", file])), { X: 1 });
  assert.equal(run(["validate", file]).trim(), "OK");

  // 删除中间一条：其余评论顺序与文本不受影响
  assert.match(run(["resolve", file, "2"]), /已解决（删除）第 2 条/);
  const src2 = fs.readFileSync(file, "utf8");
  assert.equal(src2.match(/<!--@comment/g).length, 2);
  assert.ok(!src2.includes("第二条"));
  assert.ok(src2.includes("第一条") && src2.includes("第三条"));
  assert.equal(run(["validate", file]).trim(), "OK");
  assert.equal(src2.match(/\n\n\n/g), null, "删除后不应残留连续空行");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("评论区：目标不存在 / 序号越界 / 单元格内评论 → fail loud", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-comment-bad-"));
  const file = path.join(tmp, "c.mc");
  const cli = path.join(__dirname, "..", "dist", "cli.js");
  fs.writeFileSync(file, "# t\n\n超时：<!--@var X-->1<!--@/var-->\n", "utf8");
  const run = (args) =>
    child_process.execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  assert.throws(
    () => run(["comment", file, "NOPE", "x"]),
    (e) => (e.stderr ?? "").includes("目标不存在"),
  );
  run(["comment", file, "X", "唯一一条"]);
  assert.throws(
    () => run(["resolve", file, "9"]),
    (e) => (e.stderr ?? "").includes("没有第 9 条评论"),
  );

  // 评论只能放在正文（评论区），不能塞进表格单元格
  const inCell = parse(
    "<!--@table T-->\n| id | v |\n| --- | --- |\n| a | <!--@comment target=x-->c<!--@/comment--> |\n<!--@/table-->\n",
  );
  assert.ok(inCell.errors.some((e) => /单元格内不能写评论/.test(e.message)));

  // 缺 target / 空内容 / 未闭合
  assert.ok(
    parse("<!--@comment-->c<!--@/comment-->\n").errors.some((e) => /缺少 target/.test(e.message)),
  );
  assert.ok(
    parse("<!--@comment target=x--><!--@/comment-->\n").errors.some((e) =>
      /评论内容为空/.test(e.message),
    ),
  );
  assert.ok(
    parse("<!--@comment target=x-->c\n").errors.some((e) => /未闭合/.test(e.message)),
  );

  // 围栏里的评论只是示例：忽略，不报错、不产生评论
  const fenced = parse("# t\n\n```text\n<!--@comment target=x-->c<!--@/comment-->\n```\n");
  assert.equal(fenced.errors.length, 0);
  assert.equal(fenced.comments.length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("@array：自动推断 / type=string 强制 / 元素混合类型", () => {
  const auto = parse("<!--@array M-->1/a/true<!--@/array-->\n");
  assert.equal(auto.errors.length, 0);
  assert.deepEqual(buildConfig(auto).config.M, [1, "a", true]);

  const forced = parse("<!--@array M type=string-->1/2/3<!--@/array-->\n");
  assert.deepEqual(buildConfig(forced).config.M, ["1", "2", "3"]);

  const empty = parse("<!--@array M--><!--@/array-->\n");
  assert.deepEqual(buildConfig(empty).config.M, []);
});

test("表格内联标记：未闭合/错配 → fail loud", () => {
  const unclosed =
    "<!--@table T-->\n| id | v |\n| --- | --- |\n| a | <!--@var X-->1 |\n<!--@/table-->\n";
  const r1 = parse(unclosed);
  assert.ok(r1.errors.some((e) => /未闭合|错配/.test(e.message)));

  const wrongClose =
    "<!--@table T-->\n| id | v |\n| --- | --- |\n| a | <!--@var X-->1<!--@/array--> |\n<!--@/table-->\n";
  const r2 = parse(wrongClose);
  assert.ok(r2.errors.length > 0, "开闭 kind 错配应报错");
});

test("@range：1~5 / 全角～ / bold / 非法与换行 fail loud", () => {
  const ok = parse("攻击：<!--@range R-->1~5<!--@/range-->\n");
  assert.equal(ok.errors.length, 0);
  assert.deepEqual(buildConfig(ok).config.R, { min: 1, max: 5 });

  const wide = parse("<!--@range W-->**1～10**<!--@/range-->\n");
  assert.deepEqual(buildConfig(wide).config.W, { min: 1, max: 10 });

  const bad = parse("<!--@range B-->1?5<!--@/range-->\n");
  assert.ok(bad.errors.some((e) => /invalid range/.test(e.message)));

  const multiline = parse("<!--@range B-->1~\n5<!--@/range-->\n");
  assert.ok(multiline.errors.length > 0, "range 必须单行");
});

test("#2 非 ASCII 表名直接报错，且关闭标记不再误报缺少开始", () => {
  const src = "<!--@table T_表名-->\n| a |\n| --- |\n| 1 |\n<!--@/table-->\n";
  const res = parse(src);
  assert.ok(res.errors.some((e) => /表名.*非法/.test(e.message)));
  assert.equal(res.errors.filter((e) => /缺少对应的开始/.test(e.message)).length, 0);
});

test("单元格三态：单标记裸值 / 尾巴注释不进值 / 多标记对象", () => {
  const src = [
    "<!--@table T-->",
    "| id | v |",
    "| --- | --- |",
    "| a | <!--@var A-->2<!--@/var--> 人读注释 |",
    "| c | <!--@var X-->1<!--@/var--> <!--@var Y-->2<!--@/var--> |",
    "<!--@/table-->",
  ].join("\n");
  const res = parse(src);
  assert.equal(res.errors.length, 0);
  const t = res.entries.find((e) => e.name === "T");
  assert.equal(t.kind === "table" && t.data.a.v, 2);
  assert.deepEqual(t.kind === "table" && t.data.c.v, { X: 1, Y: 2 });
});

test("表格：第一列是 id 列，输出 id→其余列对象，id 列不进入行数据", () => {
  const src = [
    "<!--@table TABLE-->",
    "| A | B | C |",
    "| --- | --- | --- |",
    "| 1 | 2 | 3 |",
    "| 2 | 3 | 4 |",
    "<!--@/table-->",
  ].join("\n");
  const res = parse(src);
  assert.equal(res.errors.length, 0);
  assert.deepEqual(buildConfig(res).config.TABLE, {
    1: { B: 2, C: 3 },
    2: { B: 3, C: 4 },
  });
  const t = res.entries.find((e) => e.name === "TABLE");
  assert.equal(t.kind === "table" && t.idColumn, "A");
});

test("表格：id 重复 / 为空 / 只有一列 → fail loud", () => {
  const dup = parse("<!--@table T-->\n| id | v |\n| --- | --- |\n| a | 1 |\n| a | 2 |\n<!--@/table-->\n");
  assert.ok(dup.errors.some((e) => /id 列取值重复/.test(e.message)));

  const blank = parse("<!--@table T-->\n| id | v |\n| --- | --- |\n|  | 1 |\n<!--@/table-->\n");
  assert.ok(blank.errors.some((e) => /不能为空/.test(e.message)));

  const oneCol = parse("<!--@table T-->\n| id |\n| --- |\n| a |\n<!--@/table-->\n");
  assert.ok(oneCol.errors.some((e) => /至少需要两列/.test(e.message)));
});

test("@array 嵌套：无名 → 裸子数组；有名 → 对象元素", () => {
  const unnamed = parse(
    "<!--@array A--> 1/2/<!--@array -->3/4/5<!--@/array--><!--@/array-->\n",
  );
  assert.equal(unnamed.errors.length, 0);
  assert.deepEqual(buildConfig(unnamed).config.A, [1, 2, [3, 4, 5]]);

  const named = parse(
    "<!--@array A--> 1/2/<!--@array B-->3/4/5<!--@/array--><!--@/array-->\n",
  );
  assert.equal(named.errors.length, 0);
  assert.deepEqual(buildConfig(named).config.A, [1, 2, { B: [3, 4, 5] }]);

  // 单元格内联同样支持嵌套（#11 的真实场景：一格里的"三选一"）
  const cell = parse(
    [
      "<!--@table T-->",
      "| id | 可选 |",
      "| --- | --- |",
      "| basic | 名称/版本/<!--@array-->格式甲/格式乙/格式丙<!--@/array--> |",
      "<!--@/table-->",
    ].join("\n"),
  );
  assert.equal(cell.errors.length, 0);
  const t = cell.entries.find((e) => e.name === "T");
  assert.deepEqual(t.kind === "table" && t.data.basic.可选, ["名称", "版本", ["格式甲", "格式乙", "格式丙"]]);
});

test("@array 嵌套：非数组嵌套 / 重名 / 顶层无名 → fail loud", () => {
  const bad = parse("<!--@array A-->1/<!--@var X-->2<!--@/var--><!--@/array-->\n");
  assert.ok(bad.errors.some((e) => /只支持嵌套 @array/.test(e.message)));

  const dupName = parse(
    "<!--@array A-->1/<!--@array B-->2<!--@/array-->/<!--@array B-->3<!--@/array--><!--@/array-->\n",
  );
  assert.ok(dupName.errors.some((e) => /嵌套数组名重复/.test(e.message)));

  const topUnnamed = parse("<!--@array -->1/2<!--@/array-->\n");
  assert.ok(topUnnamed.errors.some((e) => /顶层 @array 必须命名/.test(e.message)));
});

test("#14 正文里的标记：报错附带「示例要放围栏」的提示", () => {
  const res = parse("# t\n\n> 例 `…<!--@/range--> 超时区间`。\n");
  const withHint = res.errors.find((e) => e.hint);
  assert.ok(withHint, "应给出 hint");
  assert.match(withHint.hint, /围栏/);

  // 放进围栏 → 不报错
  const fenced = parse("# t\n\n```text\n<!--@/range-->\n```\n");
  assert.equal(fenced.errors.length, 0);
});

test("mc set 表格单元格：按 id 命中唯一格，改写后复校验，不产生额外文件", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-set-"));
  const file = path.join(tmp, "t.mc");
  const cli = path.join(__dirname, "..", "dist", "cli.js");
  fs.writeFileSync(
    file,
    [
      "# t",
      "",
      "<!--@table T-->",
      "| key | value | 说明 |",
      "| --- | --- | --- |",
      "| slots | 4 | 最大槽位数 |",
      "<!--@/table-->",
      "",
    ].join("\n"),
    "utf8",
  );

  const run = (args) => child_process.execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  assert.equal(run(["get", file, "T.slots.value"]).trim(), "4");
  assert.equal(run(["set", file, "T.slots.value", "6"]).trim(), "T.slots.value = 6");
  assert.equal(run(["get", file, "T.slots.value"]).trim(), "6");
  assert.match(fs.readFileSync(file, "utf8"), /\| slots \| 6 \| 最大槽位数 \|/);
  assert.deepEqual(fs.readdirSync(tmp), ["t.mc"], "改写只动这一个文件，不产生 .mc/ 等额外产物");

  // 目标 id 不存在 → 定位失败，且报错说明可用 id
  assert.throws(
    () => run(["set", file, "T.nope.value", "1"]),
    (e) => (e.stderr ?? "").includes("不存在 id"),
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("mc init <file.mc> 生成可直接校验通过的骨架", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-init-"));
  const file = path.join(tmp, "new.mc");
  const cli = path.join(__dirname, "..", "dist", "cli.js");
  const run = (args) => child_process.execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  run(["init", file]);
  assert.equal(run(["validate", file]).trim(), "OK");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("mc export --fingerprint：sha256=源文本、sha256File=文件字节，--no-timestamp 可复现", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-fp-"));
  const file = path.join(tmp, "fp.mc");
  const cli = path.join(__dirname, "..", "dist", "cli.js");
  const source = "# t\n\n<!--@var A-->1<!--@/var-->\n";
  fs.writeFileSync(file, source, "utf8");
  const run = (args) => child_process.execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  const fp = JSON.parse(run(["export", file, "--fingerprint", "--no-timestamp"])).$fingerprint;
  assert.equal(fp.sha256, crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex"));
  assert.equal(fp.sha256File, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  assert.equal(fp.generatedAt, undefined);

  // SDK 的指纹必须与 CLI 逐字节一致（共用 fingerprint.ts 单点实现）
  const sdkFp = open(file).fingerprint({ timestamp: false });
  assert.deepEqual(sdkFp, fp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 稳定读取层（reader.ts）—— 形状稳定承诺：导出格式再变，下游代码不动
// ---------------------------------------------------------------------------

const READER_SRC = [
  "# 限额数值",
  "",
  "<!--@table T_LIMITS-->",
  "| key | value | 单位 |",
  "| --- | --- | --- |",
  "| maxWorkers | 4 | 个 |",
  "| maxQueues | 4 | 个 |",
  "<!--@/table-->",
  "",
  "超时：<!--@var server.timeoutMs type=int-->3000<!--@/var-->",
  "",
  "<!--@table EMPTY-->",
  "| id | a | b |",
  "| --- | --- | --- |",
  "<!--@/table-->",
  "",
].join("\n");

test("reader：rows() 是形状稳定的行对象数组（含 id 列、键序=文档列序）", () => {
  const doc = fromSource(READER_SRC);
  const t = doc.table("T_LIMITS");
  assert.equal(t.idColumn, "key");
  assert.deepEqual(t.columns, ["key", "value", "单位"]);
  assert.deepEqual(t.ids, ["maxWorkers", "maxQueues"]);
  assert.deepEqual(t.rows, [
    { key: "maxWorkers", value: 4, 单位: "个" },
    { key: "maxQueues", value: 4, 单位: "个" },
  ]);
  // 键序必须与 columns 一致（含 id 列在首位）
  assert.deepEqual(Object.keys(t.rows[0]), t.columns);

  // 0.4 时代的下游写法（逐行取 r.<列名>）必须仍然可用 —— 这是稳定承诺的核心
  const fw = {};
  for (const r of doc.rows("T_LIMITS")) fw[r.key] = r.value;
  assert.deepEqual(fw, { maxWorkers: 4, maxQueues: 4 });

  // 而原始序列化形状（逃生口）仍是 id→对象：证明隔离层确实在起作用
  assert.deepEqual(doc.raw.T_LIMITS, {
    maxWorkers: { value: 4, 单位: "个" },
    maxQueues: { value: 4, 单位: "个" },
  });
});

test("reader：value() 支持点号路径，且字面名优先（表名可含点）", () => {
  const doc = fromSource(READER_SRC);
  assert.equal(doc.value("server.timeoutMs"), 3000);
  assert.equal(doc.value("server"), doc.raw.server);
  assert.ok(doc.value("T_LIMITS"));

  // 字面名含点：表名 `db.pools` 优先于「db → pools」下钻
  const dotted = fromSource(
    ["<!--@table db.pools-->", "| id | v |", "| --- | --- |", "| a | 1 |", "<!--@/table-->", ""].join("\n"),
  );
  assert.equal(dotted.table("db.pools").idColumn, "id");
});

test("reader：缺表 / 缺 id / 缺列 一律 fail loud 并给出可选值", () => {
  const doc = fromSource(READER_SRC);
  const cases = [
    () => doc.rows("NOPE"),
    () => doc.row("T_LIMITS", "zzz"),
    () => doc.cell("T_LIMITS", "maxWorkers", "nope"),
    () => doc.value("nope.nope"),
  ];
  for (const f of cases) {
    assert.throws(f, McConfigError);
  }
  assert.throws(() => doc.rows("NOPE"), /已标记的表：T_LIMITS, EMPTY/);
  assert.throws(() => doc.row("T_LIMITS", "zzz"), /现有 id：maxWorkers, maxQueues/);
  assert.throws(() => doc.cell("T_LIMITS", "maxWorkers", "nope"), /可选列：key, value, 单位/);
});

test("reader：空表只给表头也能报出列名；row/cell/ids 一致", () => {
  const doc = fromSource(READER_SRC);
  const e = doc.table("EMPTY");
  assert.deepEqual(e.columns, ["id", "a", "b"]);
  assert.deepEqual(e.ids, []);
  assert.deepEqual(e.rows, []);
  assert.equal(doc.cell("T_LIMITS", "maxQueues", "value"), 4);
  assert.equal(doc.ok, true);
  assert.deepEqual(doc.allErrors, []);
});

// ---------------------------------------------------------------------------
// 声明式发射器（codegen.ts）
// ---------------------------------------------------------------------------

const EMIT_OPTS = {
  title: "x.gen.ts —— 自动生成，不要手改。",
  source: "doc.mc",
  generator: "scripts/gen.mjs",
  consts: [
    { name: "MAX_SLOTS", value: 4, doc: "最大槽位数" },
    { name: "ARMOR", value: { drPerLevel: 120 } },
    { name: "COLS", value: ["a", "b"] },
    { name: "RAW", literal: "{\n    a: 1,\n} as const", doc: ["多行", "第二行"] },
  ],
};

test("codegen：确定性输出 + 指纹常量 + 保守类型推断", () => {
  const fp = fromSource(READER_SRC).fingerprint({ timestamp: false });
  const text = emitTsModule({ ...EMIT_OPTS, fingerprint: fp });
  assert.equal(text, emitTsModule({ ...EMIT_OPTS, fingerprint: fp }), "同样输入必须逐字节相同");
  assert.match(text, /export const SOURCE_SHA256 = "[0-9a-f]{64}";/);
  // 版号不写死：指纹里带的必须就是 SDK 当前的 VERSION（升版号时这条不会再误伤）
  assert.equal(fp.mcVersion, VERSION);
  assert.ok(text.includes(`export const SOURCE_MC_VERSION = ${JSON.stringify(VERSION)};`));
  assert.match(text, /export const MAX_SLOTS = 4;/);
  assert.match(text, /export const COLS: string\[\] = \["a","b"\];/);
  assert.match(text, /export const ARMOR = \{"drPerLevel":120\};/);
  assert.ok(text.endsWith("} as const;\n"), "末尾恰好一个换行");
  assert.ok(!text.includes("generatedAt"), "确定性输出不得含时间戳");
});

test("codegen：非法标识符 / value 与 literal 冲突 / 两者皆缺 → 报错", () => {
  assert.throws(() => emitTsModule({ consts: [{ name: "bad name", value: 1 }] }), /不是合法的 JS 标识符/);
  assert.throws(
    () => emitTsModule({ consts: [{ name: "X", value: 1, literal: "1" }] }),
    /value 与 literal 只能给一个/,
  );
  assert.throws(() => emitTsModule({ consts: [{ name: "X" }] }), /必须给出 value 或 literal/);
});

test("版号单点：SDK 的 VERSION 与 package.json 一致", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(VERSION, pkg.version, "version.ts 与 package.json 版号漂移了");
});
