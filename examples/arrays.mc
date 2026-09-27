# 数组与表格内联示例

## 数组

端口列表：<!--@array server.allowedPorts type=int-->8080/9090/3000<!--@/array-->

标签：<!--@array tags-->web/api/demo<!--@/array-->

## 表格内联

<!--@table RULES-->
| 名称 | 取值 |
| --- | --- |
| 重试次数 | <!--@var retry.count type=int-->3<!--@/var--> |
| 超时梯度(ms) | <!--@array retry.backoff type=int-->100/500/1000<!--@/array--> |
| 备注 | 仅在启用重试时生效 |
<!--@/table-->
