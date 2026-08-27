# Club 文档

本文档集描述当前发布版本的产品行为、部署方式和维护边界。

## 首次部署

1. 按[开始使用](getting-started.md)准备配置、数据库和首个平台管理员；
2. 使用[产品使用指南](product-guide.md)完成主播、验证直播间和礼物流程配置；
3. 对照[配置参考](configuration.md)设置域名、反向代理、密钥和 Provider；
4. 按[运维手册](operations.md)建立备份、恢复和升级流程。

## 按使用场景阅读

| 目标                         | 文档                                |
| ---------------------------- | ----------------------------------- |
| 部署一个新的 Club 实例       | [开始使用](getting-started.md)      |
| 使用普通用户、主播或管理后台 | [产品使用指南](product-guide.md)    |
| 查询环境变量和 Provider      | [配置参考](configuration.md)        |
| 备份、恢复、升级与排障       | [运维手册](operations.md)           |
| 理解系统边界和数据不变量     | [技术架构](architecture.md)         |
| 修改代码、迁移和测试         | [开发指南](development.md)          |
| 准备和发布新版本             | [发布手册](releasing.md)            |
| 维护 B站消息与名单适配       | [B站集成](integrations/bilibili.md) |

## 支持边界

当前发布版本支持一个 Club 应用实例、一个 PostgreSQL 17 数据库和一个私有本地存储卷。
应用进程同时提供 Web、API、B站直播间连接、月度名单任务和物流刷新 Runtime。部署多个活动
应用实例、外部对象存储和第三方主题不属于当前支持范围。

运行中的实例在 `/openapi.json` 提供 OpenAPI 3.1 文档。
