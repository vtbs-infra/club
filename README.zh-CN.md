# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

[English](README.md) | 简体中文

Club 是一个面向 B站 Vtuber、主播及其观众的自托管礼物领取与发货平台。

平台把 B站 UID 与用户账号关联，按月保存各主播的大航海名单，为符合条件的 UID
生成礼物单，并完成从用户领取、地址填写到主播发货和物流查询的完整流程。

## 主要能力

- 在平台固定 B站直播间发送一次性验证码完成 UID 绑定
- 保存不可变的月度舰长、提督和总督名单快照
- 按月发布礼物并根据大航海等级配置礼包
- 自动、幂等地生成礼物单
- 地址簿、加密领取快照和自定义领取字段
- 主播处理礼物单、录入单次发货并维护物流记录
- 主播一键导出本人当月舰长、提督和总督的冻结收货信息 Excel
- 平台公告与主播公告
- 可发布、预览和回滚的粉丝门户首页内容
- 四套部署/管理员可切换主题，默认方案 3“舰长礼物档案馆”
- 中英文界面切换，首次访问默认中文
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
docker compose build app
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d app
```

启动前需要替换 `.env` 中的数据库密码和全部密钥。创建首个平台管理员：

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  node dist/server/server/cli.js admin:create --email admin@example.com --name Admin
```

打开 <http://localhost:3000>，在平台管理界面中完成主播和验证直播间配置。

完整步骤见[开始使用](docs/getting-started.md)。

## 数据权限

每个主播账号只关联一个主播档案。主播礼物发布、礼物单查询、状态变更和 Excel 导出
全部从当前登录会话解析主播身份，不接受客户端指定其他主播 ID。导出的地址来自用户
领取礼物时保存的加密冻结快照，仅包含该主播当前月份、已提交及后续状态的礼物单。

平台管理员负责账号与全站配置，但不能通过主播工作台接口查看或导出主播收货明细。

## 文档

| 文档                                     | 适用对象                   |
| ---------------------------------------- | -------------------------- |
| [开始使用](docs/getting-started.md)      | 首次部署 Club 的维护者     |
| [产品使用指南](docs/product-guide.md)    | 普通用户、主播和平台管理员 |
| [配置参考](docs/configuration.md)        | 部署维护者                 |
| [技术架构](docs/architecture.md)         | 开发者与代码审查者         |
| [运维手册](docs/operations.md)           | 生产环境维护者             |
| [开发指南](docs/development.md)          | 项目贡献者                 |
| [实施计划](docs/implementation-plan.md)  | 稳定版实现基线与验收标准   |
| [B站集成](docs/integrations/bilibili.md) | 外部接口维护者             |

运行中的实例通过 `/openapi.json` 提供 OpenAPI 3.1 文档。

## 技术栈

- TypeScript 6 与 Node.js 24
- React 19、React Router、TanStack Query、Vite
- Fastify、TypeBox、Better Auth、Drizzle ORM、Pino
- PostgreSQL 17
- Vitest、Playwright
- Docker Compose

支持的部署方式使用一个 Club 应用实例。该进程同时提供 Web 与 API，并运行名单调度、
B站直播间连接和物流刷新任务。

## 许可证

Club 采用 [Parity Public License 7.0.0](LICENSE)。

授权主体：`zclkkk and Fox-yun`

源代码：<https://github.com/vtbs-infra/club>
