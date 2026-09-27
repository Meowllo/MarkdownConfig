# 嵌套命名空间示例

站点名：<!--@var site.name-->MarkdownConfig<!--@/var-->
作者：<!--@var site.author-->Sun<!--@/var-->

数据库连接池：

<!--@table db.pools-->
| name | size |
| --- | --- |
| main | 10 |
| cache | 5 |
<!--@/table-->

读取结果：

```json
{
  "site": { "name": "MarkdownConfig", "author": "Sun" },
  "db": { "pools": [{ "name": "main", "size": 10 }, { "name": "cache", "size": 5 }] }
}
```
