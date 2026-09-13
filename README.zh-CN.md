# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

[English](README.md) | 简体中文

Club 是一个面向 B站 Vtuber、主播及其观众的自托管礼物领取与发货平台。

平台把 B站 UID 与用户账号关联，按月保存各主播的大航海名单，为符合条件的 UID
生成礼物单，并完成从用户领取、地址填写到主播确认发货的流程。用户可以查看和复制单号，
“已发货”即平台流程终点。

## 主要能力

- 在平台固定 B站直播间发送一次性验证码完成注册前 UID 验证及账号找回
- 从已验证 B站账号读取主播身份和规范直播间
- 保存不可变的月度舰长、提督和总督名单快照
- 按月发布礼物并根据大航海等级配置礼包
- 自动、幂等地生成礼物单
- 地址簿、加密领取快照和自定义领取字段
- 主播按礼物发布导出待发货信息、确认发货并保留发货信息更正审计
- 具有显式公开控制的礼物与公告首页
- 平台公告、主播公告与四套全站主题
- 面向普通用户、主播和平台管理员的独立界面
- 基于 TypeScript、PostgreSQL 和本地对象存储的自托管部署

## 工作流程

```text
B站直播间消息
  -> 验证 UID 后注册用户名账号
  -> 月度大航海名单
  -> 主播发布礼物
  -> 用户礼物单
  -> 提交领取并冻结地址
  -> 确认发货、查看与复制单号
```

主播只需在准备发放礼物的月份发布礼物。名单任务按月正常运行；同一主播、同一月份的
已定稿名单与已发布礼物会自动完成资格匹配。

## 快速开始

环境要求：Docker Engine 与 Docker Compose v2。

```powershell
Copy-Item .env.example .env
docker compose build app
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d --no-build app
```

启动前需要替换 `.env` 中的数据库密码和全部密钥。当前源码尚未发布，模板使用
`CLUB_IMAGE=club-app` 在本地构建。已发布的 v0.2.0 镜像使用旧认证模型，不能用于此基线。

这是一次不兼容的全新数据库基线，必须使用空 PostgreSQL 数据库并重新创建账号，不提供
旧版本升级或账号迁移。普通用户先验证 B站 UID，再设置用户名和密码；账号找回复用
UID 验证，不需要邮件服务。

创建首个平台管理员：

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-with-a-random-password app `
  node dist/server/server/cli.js admin:create --username admin --name Admin
```

配置 HTTPS 反向代理，将 `APP_URL` 改为公开 HTTPS 地址并设置 `TRUST_PROXY=true`，
再通过该地址登录并配置验证直播间和主播。本地 HTTP 端口用于健康检查，生产认证要求 HTTPS。

完整步骤见[开始使用](docs/getting-started.md)。

## 文档

从[文档总览](docs/README.md)开始，或直接阅读：

- [开始使用](docs/getting-started.md)
- [产品使用指南](docs/product-guide.md)
- [运维手册](docs/operations.md)
- [账号认证](docs/authentication.md)
- [技术架构](docs/architecture.md)
- [参与开发](CONTRIBUTING.md)
- [更新记录](CHANGELOG.md)

运行中的实例通过 `/openapi.json` 提供 OpenAPI 3.1 文档。

## 技术栈

- TypeScript 7 与 Node.js 24
- React 19、React Router、TanStack Query、Vite
- Fastify Session、TypeBox、Drizzle ORM、Pino
- PostgreSQL 17
- Vitest、Playwright
- Docker Compose

支持的部署方式使用一个 Club 应用实例。该进程同时提供 Web 与 API，并运行名单调度、
B站直播间连接、礼物封面回收任务。

## 许可证

Club 采用 [Parity Public License 7.0.0](LICENSE)。

授权主体：`zclkkk and Fox-yun`

源代码：<https://github.com/vtbs-infra/club>
