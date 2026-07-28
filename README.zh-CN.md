# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

[English](README.md) | 简体中文

Club 是一个面向 Vtuber、主播及其观众的自托管 B站舰长礼物平台。平台通过固定验证
直播间完成观众 UID 绑定，按月保存大航海名单，自动生成礼物单，并支持收货信息
填写、主播发货和物流查询。

## 工作流程

1. 观众注册账号，在平台配置的验证直播间发送一次性验证码，完成 B站 UID 绑定。
2. 每月最后一天 `23:59:00`，Club 按各主播配置的时区抓取当时有效的大航海名单。
3. 主播在需要发放礼物的月份创建并发布一份礼物。
4. 已定稿名单和同月已发布礼物同时存在后，系统为每个符合条件的 B站 UID 生成礼物
   单。
5. 观众选择收货地址、填写礼物选项并提交领取。
6. 主播处理礼物单、录入物流信息，并将订单推进至完成。

名单抓取与礼物发布分别进行。主播可以先发布礼物，也可以在名单定稿后发布；系统会
幂等生成相同的礼物单。没有发布礼物的月份不会产生礼物单。

## 账号与界面

每个账号具有一种身份：

| 身份             | 职责                                               | 入口         |
| ---------------- | -------------------------------------------------- | ------------ |
| `USER`           | 绑定 B站 UID、管理地址、领取礼物、查询物流         | `/dashboard` |
| `CREATOR`        | 管理一个主播档案、发布礼物、发布公告、处理发货     | `/creator`   |
| `PLATFORM_ADMIN` | 配置主播、验证直播间、名单任务、平台公告和系统状态 | `/admin`     |

公开注册创建 `USER` 账号。平台管理员可以把已有普通用户账号分配给一个主播档案。

普通用户仪表盘展示 Banner、近期相关公告、当前操作提示和礼物卡片。主播工作台与
平台管理后台分别使用面向任务的导航。Web 界面同时适配桌面和手机宽度。

## 名单与礼物规则

- 每个启用的主播每个自然月对应一个名单任务；
- 抓取开始时间决定是否位于计划的一分钟窗口内；
- 准时且一致的抓取结果自动定稿；
- 延迟但一致的抓取结果等待平台管理员确认；
- 已定稿成员及其原始证据保持不可变；
- 每位主播每个资格月最多发布一份礼物；
- 礼物发布后，礼包内容、等级规则和领取字段保持不可变；
- 未提交的礼物单与 B站 UID 关联；
- 提交领取时冻结用户账号、地址、礼包内容和选项值。

礼物单状态：

```text
待领取 -> 已提交 -> 处理中 -> 已发货 -> 已完成
待领取 -> 已过期
已提交 | 处理中 -> 已取消
```

## 技术架构

Club 是 TypeScript 模块化单体：

- React、React Router、TanStack Query、Vite；
- Fastify、TypeBox/OpenAPI、Better Auth、Drizzle ORM、Pino；
- PostgreSQL 17；
- 本地对象存储，用于保存压缩名单证据和礼物图片；
- Vitest、Playwright；
- 单应用实例的 Docker Compose 部署。

生产环境由同一个 Fastify 进程提供 Web 页面、`/api/v1` HTTP API、名单调度、
B站直播间连接和物流刷新。

## 本地开发

环境要求：

- Node.js `>=24 <25`
- pnpm `11.9.0`
- Docker Engine
- Docker Compose v2

安装依赖并创建本地配置：

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

在 `.env` 中设置数据库密码和两个数据库 URL，生成不少于 32 个字符的随机认证密钥，
并配置一个 32 字节 base64 地址加密密钥。

启动 PostgreSQL、执行迁移并启动开发服务：

```powershell
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Vite 开发服务器位于 <http://localhost:5173>，Fastify 位于
<http://localhost:3000>。

创建首个平台管理员：

```powershell
$env:CLUB_ADMIN_PASSWORD = 'replace-with-a-strong-password'
pnpm club admin:create --email admin@example.com --name Admin
Remove-Item Env:CLUB_ADMIN_PASSWORD
```

## Docker Compose

构建镜像、启动 PostgreSQL、执行迁移并启动 Club：

```powershell
docker compose build app
docker compose up -d postgres
docker compose run --rm app pnpm db:migrate
docker compose up -d app
```

检查运行状态：

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

使用容器镜像创建首个平台管理员：

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  pnpm club admin:create --email admin@example.com --name Admin
```

进入 Web 界面后的配置顺序：

1. 注册一个普通用户账号；
2. 在 `/admin/creators` 将该账号分配给主播档案；
3. 在 `/admin/verification` 配置并启用验证直播间；
4. 在管理员仪表盘确认名单调度与直播间连接状态。

## 配置

| 变量                                    | 默认值                  | 用途                            |
| --------------------------------------- | ----------------------- | ------------------------------- |
| `APP_URL`                               | `http://localhost:3000` | 公开访问地址和请求来源校验基准  |
| `DATABASE_URL`                          | 必填                    | 当前进程使用的 PostgreSQL 连接  |
| `BETTER_AUTH_SECRET`                    | 必填                    | 认证密钥，不少于 32 个字符      |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` | `1`                     | 新加密记录使用的密钥版本        |
| `ADDRESS_ENCRYPTION_KEY_RING`           | 生产环境必填            | 逗号分隔的 `版本:base64` 密钥   |
| `BILIBILI_LIVE_SOURCE`                  | `public-web`            | 直播消息适配器                  |
| `BILIBILI_ROSTER_SOURCE`                | `public-web`            | 大航海名单适配器                |
| `STORAGE_LOCAL_PATH`                    | `./data/club`           | 名单证据和礼物图片目录          |
| `TRACKING_PROVIDER`                     | `none`                  | 物流集成；测试环境可使用 `fake` |
| `LOG_LEVEL`                             | `info`                  | Pino 日志级别                   |
| `TRUST_PROXY`                           | `false`                 | 受控反向代理环境中的代理信任    |
| `SMTP_*`                                | 未设置                  | 邮件验证与密码重置服务          |

Compose 还会使用 `POSTGRES_PASSWORD`、`POSTGRES_HOST_PORT`、
`COMPOSE_DATABASE_URL` 和 `CLUB_PORT`。完整模板见
[.env.example](.env.example)。

## 质量检查

```powershell
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
pnpm build
pnpm test:e2e
```

## 文档

- [产品与架构](docs/product-architecture.md)
- [运维](docs/operations.md)
- [B站集成](docs/integrations/bilibili.md)
- [验收](docs/acceptance.md)
- [发布清单](docs/release.md)

运行实例通过 `/openapi.json` 提供生成的 OpenAPI 文档。

## 许可证

Club 采用 [Parity Public License 7.0.0](LICENSE)，授权主体为
`zclkkk and Fox-yun`，源代码地址为本仓库。
