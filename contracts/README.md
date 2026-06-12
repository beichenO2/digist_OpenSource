# digist 产物契约

本目录定义 digist 对外暴露的数据结构契约。所有消费方（Clock、KnowLever 等）通过这些 schema 校验与 digist 交互的数据格式。

## Schema 列表

| Schema | 用途 |
|---|---|
| `source-config.schema.json` | 信息源配置（关注博主 / 关键词热点 / 最新）|
| `feedback.schema.json` | 用户反馈（不感兴趣 / 归档 / 入库）|
| `recommend-item.schema.json` | 推荐 API 返回项（含 Clock 工作台所需全部状态字段）|

## 示例

`examples/` 目录包含每个 schema 的示例 payload。

## Contract Test

`../tests/contracts/` 包含对应的 contract test，验证 API 返回值符合 schema。

## 变更历史

- 2026-05-01: 初始创建，覆盖 source-config / feedback / recommend-item 三个 schema
