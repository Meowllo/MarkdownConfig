/** MarkdownConfig 核心测试（node --test，纯 JS） */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildConfig, canonicalJson, parse, appendOp, readOps, allComments, openComments } from "../dist/index.js";

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

test("journal：append/read/comment/resolve 闭环", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-journal-"));
  const file = path.join(tmp, "x.mc");
  fs.writeFileSync(file, "<!--@var A-->1<!--@/var-->\n", "utf8");

  appendOp(file, { op: "create", actor: "agent", target: "A", hash: "h1", prev_hash: null, text: "add" });
  appendOp(file, { op: "comment", actor: "human", target: "A", text: "建议改大", id: "c-1", status: "open" });
  appendOp(file, { op: "resolve", actor: "agent", target: "c-1", text: "resolved" });

  const ops = readOps(file);
  assert.equal(ops.length, 3);
  assert.equal(allComments(file)[0].status, "resolved");
  assert.equal(openComments(file).length, 0);
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
    "<!--@table T-->\n| a |\n| --- |\n| <!--@var X-->1 |\n<!--@/table-->\n";
  const r1 = parse(unclosed);
  assert.ok(r1.errors.some((e) => /未闭合|错配/.test(e.message)));

  const wrongClose =
    "<!--@table T-->\n| a |\n| --- |\n| <!--@var X-->1<!--@/array--> |\n<!--@/table-->\n";
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
  const src = "<!--@table T_护甲-->\n| a |\n| --- |\n| 1 |\n<!--@/table-->\n";
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
  assert.equal(t.kind === "table" && t.rows[0].v, 2);
  assert.deepEqual(t.kind === "table" && t.rows[1].v, { X: 1, Y: 2 });
});
