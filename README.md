# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

Club 是一个自托管的礼物领取与发货平台，服务 B站主播和他们的大航海成员。

Club 自动保存主播每月的大航海名单，为名单上的每个 UID 生成礼物单。成员用自己的 B站身份
注册、领取并填写地址；主播导出待发货信息、录入单号，成员可以查看和复制单号。

## 工作流程

```text
成员在验证直播间发送验证码，证明 UID 后注册
  -> 每月最后一天自动保存主播的大航海名单
  -> 主播发布当月礼物，按舰长、提督、总督配置礼包
  -> 名单上的每个 UID 得到一张礼物单
  -> 成员领取并填写地址
  -> 主播发货，成员查看与复制单号
```

主播只需在想送礼物的月份发布礼物。名单每月照常保存，发布与名单谁先完成都会自动匹配。

## 主要能力

- 在直播间发送验证码证明 B站 UID，不需要邮箱，也不收集用户的 B站密码
- 定稿后不可修改的月度名单，并保留原始抓取证据
- 自动且不重复地生成礼物单；尚未注册的成员也会先得到礼物单
- 加密保存的地址簿，领取时冻结一份独立的地址副本
- 按礼物导出待发货清单，录入与更正单号
- 平台公告与主播公告、可选择公开的礼物首页、四套全站主题

## 文档

- [部署与运维](docs/deploy.md)：用 Docker Compose 部署、配置、备份、升级和处理故障
- [使用指南](docs/guide.md)：普通用户、主播和平台管理员怎么使用 Club
- [开发](docs/development.md)：本地开发、测试、数据库迁移和发布
- [更新记录](CHANGELOG.md)

## 技术栈

TypeScript、Node.js 24、Fastify、React、PostgreSQL 17，以 Docker Compose 部署单个应用实例。

## 许可证

[Parity Public License 7.0.0](LICENSE)。贡献者：zclkkk、Fox-yun。
