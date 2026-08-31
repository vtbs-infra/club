# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

[English](README.md) | 简体中文

Club 是一个面向 B站 Vtuber、主播及其观众的自托管礼物领取与发货平台。

平台把 B站 UID 与用户账号关联，按月保存各主播的大航海名单，为符合条件的 UID
生成礼物单，并完成从用户领取、地址填写到主播发货和物流查询的完整流程。

## 主要能力

- 在平台固定 B站直播间发送一次性验证码完成 UID 绑定
- 从已验证 B站账号读取主播身份和规范直播间
- 保存不可变的月度舰长、提督和总督名单快照
- 按月发布礼物并根据大航海等级配置礼包
- 自动、幂等地生成礼物单
- 地址簿、加密领取快照和自定义领取字段
- 主播按礼物发布导出待发货信息、录入单次发货并维护物流记录
- 具有显式公开控制的礼物与公告首页
- 平台公告、主播公告与四套全站主题
- 面向普通用户、主播和平台管理员的独立界面
- 基于 TypeScript、PostgreSQL 和本地对象存储的自托管部署

## 工作流程

```text
B站直播间消息
  -> UID 绑定
  -> 月度大航海名单
  -> 主播发布礼物
  -> 用户礼物单
  -> 提交领取并冻结地址
  -> 发货与物流
```

主播只需在准备发放礼物的月份发布礼物。名单任务按月正常运行；同一主播、同一月份的
已定稿名单与已发布礼物会自动完成资格匹配。

## 快速开始

环境要求：Docker Engine 与 Docker Compose v2。

```powershell
Copy-Item .env.example .env
docker compose pull app
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d --no-build app
```

启动前需要替换 `.env` 中的数据库密码和全部密钥。模板通过 `CLUB_IMAGE` 固定当前发布
镜像；如需构建当前检出的源码，删除 `CLUB_IMAGE`，并在迁移前运行
`docker compose build app`。

Club v0.2 使用 fresh-install 数据库基线，必须在空 PostgreSQL 数据库上初始化。

创建首个平台管理员：

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  node dist/server/server/cli.js admin:create --email admin@example.com --name Admin
```

打开 <http://localhost:3000>，在平台管理界面中完成主播和验证直播间配置。

完整步骤见[开始使用](docs/getting-started.md)。

## 文档

从[文档总览](docs/README.md)开始，或直接阅读：

- [开始使用](docs/getting-started.md)
- [产品使用指南](docs/product-guide.md)
- [运维手册](docs/operations.md)
- [技术架构](docs/architecture.md)
- [参与开发](CONTRIBUTING.md)
- [更新记录](CHANGELOG.md)

运行中的实例通过 `/openapi.json` 提供 OpenAPI 3.1 文档。

## 技术栈

- TypeScript 6 与 Node.js 24
- React 19、React Router、TanStack Query、Vite
- Fastify、TypeBox、Better Auth、Drizzle ORM、Pino
- PostgreSQL 17
- Vitest、Playwright
- Docker Compose

支持的部署方式使用一个 Club 应用实例。该进程同时提供 Web 与 API，并运行名单调度、
B站直播间连接、物流刷新和礼物封面回收任务。

## 许可证

Club 采用 [Parity Public License 7.0.0](LICENSE)。

授权主体：`zclkkk and Fox-yun`

源代码：<https://github.com/vtbs-infra/club>
