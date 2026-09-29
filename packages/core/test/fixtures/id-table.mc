# id 列示例（第一列固定为 id 列）

<!--@table T_LIMITS-->
| key | value | 单位 | 说明 |
| --- | --- | --- | --- |
| maxWorkers | 4 | 个 | 最大并发数 |
| maxQueues | 4 | 个 | 最大队列数 |
| batchSize | 3 | 条 | 每批处理条数 |
<!--@/table-->

<!--@table T_QUOTA-->
| 项 | 上限 | 说明 |
| --- | --- | --- |
| api | <!--@var apiQuota-->5<!--@/var--> | 每秒请求数 |
| batch | <!--@range batchQuota-->8~12<!--@/range--> | 每批条数 |
<!--@/table-->
