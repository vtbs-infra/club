# Club

[English](README.md) | [简体中文](README.zh-CN.md)

Club 是一个面向虚拟主播、直播创作者及其组织的开源平台，用于管理哔哩哔哩舰长礼物资格、礼物领取、履约和物流追踪。

项目已经实现完整业务链路：基于 PostgreSQL 的身份与租户管理、追加式审计记录、平台管理的哔哩哔哩 UID 绑定、月末名单快照与不可变证据、礼物活动与历史资格、加密地址与领取记录、履约与物流追踪、公告以及脱敏运维诊断。

Web 界面默认使用简体中文。可以通过全局导航中的 `EN/中文` 按钮切换语言，浏览器会记住选择。

相关文档：

- [产品与架构规范](docs/product-architecture.md)
- [实施计划](docs/implementation-plan.md)
- [运维与恢复指南](docs/operations.md)
- [发布检查清单](docs/release.md)
- [验收证据](docs/acceptance.md)

修改项目之前应先阅读产品规范和实施计划。产品规范是业务行为与架构的事实来源，实施计划规定交付顺序和验证要求。

## 核心设计

- TypeScript 模块化单体：React/Vite + Fastify + TypeBox + Better Auth + Drizzle + PostgreSQL。
- 默认只运行一个应用实例、一个 PostgreSQL 数据库和一个私有存储目录。
- 同一个应用进程提供前端和 API，并运行调度器及哔哩哔哩直播间连接管理器。
- 用户在平台管理的验证直播间发送一次性验证码绑定 UID，不能自行指定直播间或 UID。
- 每位创作者会按其 IANA 时区在每月最后一天 23:59:00 开始舰长名单抓取。
- 准时且一致的抓取会自动定稿；迟到抓取必须由组织显式批准。
- 已定稿的快照成员不可修改。
- 哔哩哔哩原始分页响应经压缩后进入私有存储；PostgreSQL 保存规范化成员、元数据、哈希和对象键。
- 不支持手工导入名单或手工授予礼物资格。
- 当前范围不包含 Redis、通用任务队列、微服务和多实例协调。

## 开发环境

要求：

- Node.js 24 LTS
- pnpm 11.9
- PostgreSQL 17 或兼容版本

复制 `.env.example` 为 `.env`，启动 PostgreSQL，然后执行：

```text
pnpm install
pnpm db:migrate
pnpm dev
```

Compose 提供的 PostgreSQL 仅在 `127.0.0.1:55432` 暴露给本机工具，容器内部仍使用标准端口。

`BETTER_AUTH_SECRET` 必须设置且不少于 32 个字符。每次部署都应使用随机生成的密钥；缺少必要生产密钥时，Compose 会拒绝启动。

开发前端地址为 `http://localhost:5173`，它会把 API 和健康检查请求代理到 3000 端口的 Fastify。生产构建由单个 Fastify 进程同时提供前端和 API：

```text
pnpm build
pnpm start
```

健康检查和 API 文档：

- `GET /health/live`：应用进程存活检查。
- `GET /health/ready`：PostgreSQL 与私有存储就绪检查。
- `GET /openapi.json`：生成的 OpenAPI 文档。

## 首个平台管理员与组织

完成数据库迁移后创建首个平台管理员：

```text
pnpm club admin:create --email admin@example.com --name "Platform Admin"
```

命令会以无回显方式询问密码。无人值守时可以临时提供 `CLUB_ADMIN_PASSWORD`。该命令拒绝直接提升已有账户。

平台管理员可以调用 `POST /api/v1/platform/organizations` 创建组织并指定首位所有者。组织所有者之后可通过 `/api/v1/organizations/:orgId` 管理成员、创作者范围和创作者。完整接口契约位于 `/openapi.json`。

只有完整配置 `.env.example` 中的可选 `SMTP_*` 参数后，才会启用邮件验证和自动密码重置；启用 SMTP 后，新注册账户必须验证邮箱。

## 哔哩哔哩验证直播间

以平台管理员身份登录并打开 `/platform/verification-rooms`。添加至少一个哔哩哔哩直播间 ID，测试连接成功后再启用。

普通用户可在 `/account` 请求一个十分钟有效的验证码，进入系统分配的直播间并将验证码作为普通弹幕发送。系统会自动绑定发送者 UID，验证接口不接受用户自行填写直播间或 UID。

`BILIBILI_LIVE_SOURCE=public-web` 启用本地及 Compose 部署使用的生产适配器。它使用匿名、仅内存保存的哔哩哔哩 Web 直播间凭据，需要访问外部 HTTPS 和 WebSocket。自动化测试使用确定性的假数据源，不会访问哔哩哔哩。协议假设见 [`docs/integrations/bilibili.md`](docs/integrations/bilibili.md)。

## 月末快照

调度器会根据每位活跃创作者的 IANA 时区预先创建本月和下月运行记录，并在当地每月最后一天 23:59 开始抓取。

准时且一致的尝试会自动定稿；首次开始时间不早于 00:00 的尝试会保持待批准状态，直至组织所有者或管理员处理。运营人员可以从创作者的“快照”入口查看运行记录、尝试、失败代码、哈希证据，重试失败抓取并处理待批准记录。

`BILIBILI_ROSTER_SOURCE=public-web` 启用已验证的生产名单适配器。测试使用假适配器，系统不存在手工名单导入 API 或界面。

## 验证命令

```text
pnpm check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm db:generate
pnpm db:migrate
```

设置 `TEST_DATABASE_URL` 后，`pnpm test:integration` 会运行 PostgreSQL 集成测试。CI 始终提供隔离数据库。首次运行浏览器测试前执行 `pnpm browser:install` 安装 Chromium。

## Docker Compose

复制 `.env.example` 为 `.env`，替换全部必要密钥并确保该文件不进入版本控制。随后构建镜像、启动 PostgreSQL、执行迁移并启动唯一应用实例：

```text
docker compose build
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d app
docker compose ps
```

打开 `APP_URL` 并确认 `/health/ready` 返回 `ok`。创建首个平台管理员：

```text
docker compose run --rm -e CLUB_ADMIN_PASSWORD app \
  node dist/server/server/cli.js admin:create \
  --email admin@example.com --name "Platform Admin"
```

首次部署、组织引导、哔哩哔哩设置、备份恢复、密钥轮换和升级流程详见 [`docs/operations.md`](docs/operations.md)。不要运行多个 `app` 副本：调度器和直播间连接有意与单个应用进程共同运行。
