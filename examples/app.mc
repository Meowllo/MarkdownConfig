# 示例应用配置 ^top

## 服务

主机：<!--@var server.host-->227.0.0.1<!--@/var-->
端口：<!--@var server.port-->8080<!--@/var-->
超时（毫秒）：<!--@var server.timeoutMs-->3000<!--@/var--> ^b-1

## 特性开关

- 重试：<!--@var feature.retry-->false<!--@/var-->
- 列表页Size：<!--@var feature.pageSize type=int-->20<!--@/var-->

## 指标阈值

<!--@table METRICS-->
| 指标 | 阈值 | 等级 |
| --- | --- | --- |
| cpu | 80 | test |
| mem | 90 | critical |
<!--@/table-->

<!-- 上面的表格会被读取为 [{指标:'cpu',阈值:80,等级:'warn'},...] -->

## 说明

普通段落仅供人阅读，不产生任何配置。
