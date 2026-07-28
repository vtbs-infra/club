# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

[English](README.md) | [简体中文](README.zh-CN.md)

Club 是一个面向主播、虚拟主播、粉丝社群和运营团队的自托管哔哩哔哩舰长礼物平台。系统覆盖从哔哩哔哩 UID 验证、月末舰长名单快照，到礼物资格、用户领取、履约、物流追踪和公告展示的完整业务链路。

公开网站默认使用简体中文。访客可以在全局导航中切换中文和英文，浏览器会记住语言选择。

> [!IMPORTANT]
> Club 只支持一个活动应用实例。进程内调度器和哔哩哔哩直播间连接不支持水平扩展。项目自身当前标记为 `UNLICENSED`；重新分发前请阅读[许可证与第三方声明](#许可证与第三方声明)。

## 目录

- [产品流程](#产品流程)
- [主要功能](#主要功能)
- [角色与权限](#角色与权限)
- [系统架构](#系统架构)
- [开发环境快速启动](#开发环境快速启动)
- [使用 Docker Compose 部署生产环境](#使用-docker-compose-部署生产环境)
- [首次平台配置](#首次平台配置)
- [首页、主题与品牌资源](#首页主题与品牌资源)
- [哔哩哔哩验证与月末快照](#哔哩哔哩验证与月末快照)
- [配置参数](#配置参数)
- [安全与数据处理](#安全与数据处理)
- [常用命令与测试](#常用命令与测试)
- [项目结构](#项目结构)
- [运维、备份与升级](#运维备份与升级)
- [当前限制](#当前限制)
- [项目文档](#项目文档)
- [许可证与第三方声明](#许可证与第三方声明)

## 产品流程

```text
注册平台账号
  → 在平台指定的哔哩哔哩直播间发送一次性验证码
  → 完成哔哩哔哩 UID 绑定
  → 抓取月末舰长名单
  → 生成不可变资格快照
  → 按活动规则生成礼物资格
  → 选择地址并提交领取
  → 运营履约和发货
  → 物流追踪与完成
```

同一个 Club 实例可以承载多个组织和主播。同一个平台账号既可以领取礼物，也可以在一个或多个组织中担任工作人员。

## 主要功能

| 领域             | 功能                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| 粉丝门户         | 个性化礼物状态、截止时间、UID 绑定、地址状态、物流进度和公告                                              |
| 哔哩哔哩身份验证 | 平台分配验证直播间、一次性弹幕验证码、自动提取 UID、断线重连和最近消息轮询兜底                            |
| 月末证据         | 按主播时区调度、完整分页抓取、一致性校验、不可变定稿成员、压缩原始证据和 SHA-256 元数据                   |
| 礼物活动         | 舰长/提督/总督等级规则、确定性资格生成、历史资格匹配、领取时间窗和礼物选项                                |
| 领取与地址       | AES-256-GCM 加密地址簿、领取地址快照、幂等状态流转、取消和重新提交                                        |
| 履约与物流       | 领取队列、一键导出当月舰长 Excel（UID、昵称、等级和冻结地址）、礼包、物流单、物流导入、异常状态和签收完成 |
| 组织管理         | 多组织、多主播、成员角色、主播范围和追加式审计记录                                                        |
| 公告系统         | 平台、组织、主播和活动公告，支持显示时间窗和置顶                                                          |
| 自定义首页       | 受控模块编辑器、草稿发布、版本历史、桌面/手机预览、品牌图片处理和受众规则                                 |
| 全局外观         | `moe`、`neon`、`archive`、`pixel` 四套部署级主题，默认 `archive`                                          |
| 运维能力         | 存活/就绪检查、脱敏诊断、存储完整性检查、恢复工具和结构化日志                                             |

## 角色与权限

`PLATFORM_ADMIN` 负责全局组织、验证直播间、平台公告、首页内容、全站外观、系统健康和平台审计事件。

组织成员遵循最小权限原则：

| 角色          | 主要权限                                                 |
| ------------- | -------------------------------------------------------- |
| `OWNER`       | 组织、成员、主播配置、活动、履约和敏感设置的完整管理权限 |
| `ADMIN`       | 主播、活动、公告、快照批准和成员权限                     |
| `OPERATOR`    | 活动、资格和领取处理，不包含敏感集成设置                 |
| `FULFILLMENT` | 履约所需的收货数据、导出、物流和追踪                     |
| `VIEWER`      | 只读运营视图，不显示完整收货地址                         |

成员还可以通过主播范围限制为只能访问指定主播。

## 系统架构

Club 是 TypeScript 模块化单体：

```text
浏览器
  │
  ▼
club-app — 单个活动 Node.js 24 进程
  ├─ React + Vite 前端
  ├─ Fastify REST API + TypeBox/OpenAPI 契约
  ├─ Better Auth 会话
  ├─ 领域调度器与物流刷新
  ├─ 哔哩哔哩直播间连接管理器
  └─ 业务模块
       │
       ├─ PostgreSQL 17
       ├─ 本地持久化存储
       ├─ 哔哩哔哩 HTTPS/WebSocket 接口
       └─ 可选物流和 SMTP 服务
```

主要技术：

- React、React Router、TanStack Query、React Hook Form；
- Fastify、TypeBox、Better Auth、Drizzle ORM、Pino；
- PostgreSQL 和本地原子对象存储；
- Vitest 和 Playwright；
- Docker Compose 生产拓扑。

生产环境由同一个进程提供前端与 API。开发环境默认由 Vite 监听 `5173` 端口、Fastify 监听 `3000` 端口；Vite 会将 API 和健康检查请求代理到 Fastify。

## 开发环境快速启动

### 环境要求

- Node.js `>=24 <25`
- pnpm `11.9.0`
- PostgreSQL 17，或 Docker Engine + Compose v2
- Git

### 1. 克隆并安装依赖

```text
git clone https://github.com/vtbs-infra/club.git
cd club
corepack enable
pnpm install
```

### 2. 创建本地配置

复制 `.env.example` 为 `.env`：

```text
# macOS/Linux
cp .env.example .env

# PowerShell
Copy-Item .env.example .env
```

启动应用前必须替换全部占位符，至少需要：

- 将 `BETTER_AUTH_SECRET` 设置为不少于 32 个随机字符；
- 生成 32 字节 base64 地址密钥并写入 `ADDRESS_ENCRYPTION_KEY_RING`；
- 保持 `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` 与活动密钥版本一致；
- 保持 `POSTGRES_PASSWORD`、`DATABASE_URL`、`COMPOSE_DATABASE_URL` 中的密码一致。

生成密钥示例：

```text
openssl rand -base64 48
openssl rand -base64 32
```

没有 OpenSSL 时可以使用 Node.js：

```text
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

### 3. 启动 PostgreSQL 并执行迁移

```text
docker compose up -d postgres
pnpm db:migrate
```

Compose 默认只把 PostgreSQL 暴露到 `127.0.0.1:55432`，容器内部使用 `5432`。

### 4. 创建首个平台管理员

```text
pnpm club admin:create --email admin@example.com --name "Platform Admin"
```

命令会以无回显方式询问密码。无人值守初始化时可以临时设置 `CLUB_ADMIN_PASSWORD`。该命令只创建新管理员，并会主动拒绝提升已有账号。

### 5. 启动应用

```text
pnpm dev
```

访问：

- 前端：<http://localhost:5173>
- 后端存活检查：<http://localhost:3000/health/live>
- 后端就绪检查：<http://localhost:3000/health/ready>
- OpenAPI 文档：<http://localhost:3000/openapi.json>

## 使用 Docker Compose 部署生产环境

默认支持的生产拓扑包含一个 `app` 容器、一个 `postgres` 容器，以及 PostgreSQL 和 Club 两个持久化卷。

1. 复制 `.env.example` 为 `.env`。
2. 替换全部密钥，并将 `APP_URL` 设置为准确的公网 HTTPS 来源。
3. 限制 `.env` 文件权限且不要提交到版本库。
4. 构建、迁移并启动：

```text
docker compose build
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d app
docker compose ps
```

创建首个平台管理员：

```text
docker compose run --rm -e CLUB_ADMIN_PASSWORD app \
  node dist/server/server/cli.js admin:create \
  --email admin@example.com --name "Platform Admin"
```

初始化后立即移除 `CLUB_ADMIN_PASSWORD`。TLS 应由可信反向代理终止；只有在代理会替换转发请求头时才启用 `TRUST_PROXY`。不要将 `app` 扩展到多个副本。

对外开放前确认：

```text
GET /health/live
GET /health/ready
GET /openapi.json
```

生产使用前应完整阅读[运维与恢复指南](docs/operations.md)，其中包含受支持的备份、干净恢复、密钥轮换、升级、回滚和故障恢复流程。

## 首次平台配置

以平台管理员身份登录后：

1. 打开 `/platform/verification-rooms`，添加哔哩哔哩直播间，测试成功后启用。
2. 根据 `/openapi.json`，通过 `POST /api/v1/platform/organizations` 创建第一个组织。
3. 将一个已存在的平台账号设为组织所有者。
4. 添加主播并配置哔哩哔哩 UID、直播间 ID 和 IANA 时区。
5. 为工作人员分配最小必要角色和可选主播范围。
6. 在 `/platform/appearance` 配置全站主题。
7. 在 `/platform/site` 配置并发布粉丝门户首页。
8. 创建礼物活动，并确认本月和下月快照运行记录已经出现。

SMTP 是可选功能。未完整配置 `SMTP_*` 时，用户可以直接注册，但不启用邮箱验证和自动密码重置；配置 SMTP 后，新注册账号必须验证邮箱。

## 首页、主题与品牌资源

公开首页面向礼物领取用户，展示已发布活动、公告，以及登录用户的待领取礼物、UID 绑定、地址状态和物流进度。数据库和存储健康信息保留在平台运维页面。

平台管理员可以在 `/platform/site` 使用受控模块编辑器。支持：

- Hero；
- 用户任务和当前活动；
- 图文与富文本；
- 公告列表和领取流程；
- 图片 Banner、卡片组、画廊、行动按钮和分隔留白。

管理员可以调整顺序、隐藏、复制模块，并设置未登录/已登录可见范围。内容发布流程为：

```text
草稿 → 桌面/手机预览 → 显式发布
```

历史版本可以恢复为新草稿。保存、发布、恢复、上传和删除操作都会进入审计记录。

支持上传 JPEG、PNG、WebP，单张不超过 5 MB。服务端会验证真实图片内容、删除元数据、限制最大边长为 2400 像素、转换为 WebP、生成缩略图并记录 SHA-256。系统不接受 SVG、任意 HTML、JavaScript、CSS、外部字体或不安全链接。

`CLUB_UI_THEME` 设置部署默认主题：

| 值        | 风格                           |
| --------- | ------------------------------ |
| `moe`     | 柔和糖果色和粉丝向卡片         |
| `neon`    | 深色玻璃与直播间控制台氛围     |
| `archive` | 温润纸张与目录式排版，默认方案 |
| `pixel`   | 紧凑的像素补给舰界面           |

平台管理员可以在 `/platform/appearance` 发布全局覆盖方案；访客不能选择个人主题。恢复部署默认方案会移除管理员覆盖。

首页内容和版本保存在 PostgreSQL，处理后的品牌资源位于 `STORAGE_LOCAL_PATH/public/brand`。数据库与完整存储目录必须作为同一组进行备份和恢复。

## 哔哩哔哩验证与月末快照

### UID 验证

用户在 `/account` 请求十分钟有效的验证码。Club 自动分配已启用的验证直播间，用户将页面显示的验证码作为普通弹幕发送。Club 使用弹幕事件携带的 UID 建立绑定，浏览器不能提交 UID 或直播间 ID。

生产环境的 `public-web` 适配器使用匿名、仅保存在内存中的哔哩哔哩 Web 凭据。系统会维护 WebSocket 连接，并在直播间被使用期间轮询最近消息，从而兜底处理未开播时没有通过匿名长连接送达的弹幕。哔哩哔哩连接失败不会阻止 HTTP 服务启动。

### 月末快照

Club 会按每位活动主播的 IANA 时区安排本月和下月运行，并在当地月末最后一天 `23:59:00` 开始抓取。

系统获取所有声明分页，并检查数量、分页、舰长等级、重复 UID 和首页一致性。准时且一致的抓取会自动定稿；首次开始时间不早于次日零点的抓取需要组织显式批准。已定稿成员不可修改。

原始响应经过 gzip 压缩后保存到私有存储；PostgreSQL 保存规范化成员、对象键、哈希和证据元数据。协议假设和重新验证条件见[哔哩哔哩集成说明](docs/integrations/bilibili.md)。

## 配置参数

| 变量                                                 | 是否必需 | 说明                                                 |
| ---------------------------------------------------- | -------- | ---------------------------------------------------- |
| `APP_URL`                                            | 生产环境 | 用于 Cookie 和 Origin/CSRF 检查的准确公开来源        |
| `CLUB_PORT`                                          | 否       | 应用映射到宿主机的端口，默认 `3000`                  |
| `POSTGRES_HOST_PORT`                                 | 否       | 仅回环地址开放的 PostgreSQL 端口，默认 `55432`       |
| `POSTGRES_PASSWORD`                                  | Compose  | PostgreSQL 密码                                      |
| `COMPOSE_DATABASE_URL`                               | Compose  | 使用主机名 `postgres` 的容器数据库 URL               |
| `DATABASE_URL`                                       | 是       | 宿主机或运行时 PostgreSQL URL                        |
| `BETTER_AUTH_SECRET`                                 | 是       | 不少于 32 个字符的认证密钥                           |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION`              | 是       | 新地址使用的正整数密钥版本                           |
| `ADDRESS_ENCRYPTION_KEY_RING`                        | 是       | 逗号分隔的 `版本:base64密钥`，每个密钥必须为 32 字节 |
| `BILIBILI_LIVE_SOURCE`                               | 否       | 生产使用 `public-web`；`fake` 仅用于测试/开发        |
| `BILIBILI_ROSTER_SOURCE`                             | 否       | 生产使用 `public-web`；`fake` 仅用于测试/开发        |
| `STORAGE_DRIVER`                                     | 否       | 当前仅支持 `local`                                   |
| `STORAGE_LOCAL_PATH`                                 | 否       | 快照证据、临时文件和公开品牌资源目录                 |
| `TRACKING_PROVIDER`                                  | 否       | 默认 `none`；`fake` 仅用于测试/开发                  |
| `CLUB_UI_THEME`                                      | 否       | `moe`、`neon`、`archive` 或 `pixel`，默认 `archive`  |
| `LOG_LEVEL`                                          | 否       | Pino 的 `fatal` 到 `trace`，或 `silent`              |
| `TRUST_PROXY`                                        | 否       | 仅在可信代理会替换转发请求头时启用                   |
| `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_FROM` | 可选组   | 启用邮箱验证和密码重置                               |
| `SMTP_USERNAME`、`SMTP_PASSWORD`                     | 可选对   | 必须同时配置或同时省略                               |
| `CLUB_ADMIN_PASSWORD`                                | 仅初始化 | 一次性非交互管理员密码                               |
| `TEST_DATABASE_URL`                                  | 仅测试   | 集成与端到端测试使用的隔离 PostgreSQL                |

只要数据库中仍有数据使用旧地址密钥，就不能删除该密钥。轮换时应追加新密钥、修改活动版本并重启；在存在经过验证的重加密迁移前，应保留全部旧密钥。

## 安全与数据处理

- 收货地址在入库前使用 AES-256-GCM 和版本化密钥加密。
- 提交领取时冻结地址快照，之后修改地址簿不会重写历史履约数据。
- 当月舰长 Excel 只使用上述冻结地址，仅允许 `OWNER`/`FULFILLMENT`
  角色在其主播权限范围内导出，并逐条记录地址导出审计。
- 哔哩哔哩验证码只保存 HMAC 摘要，不保存明文。
- 原始快照分页经压缩和哈希后保存在 PostgreSQL 之外。
- 公开品牌图片会被解码并重新编码，元数据和不支持的内容会被丢弃。
- 组织查询和审计访问同时受权限与主播范围限制。
- 日志、诊断和审计查询会脱敏敏感字段。
- 状态变更根据业务需要使用事务、数据库约束、乐观版本或幂等键。
- 首页编辑器不能注入任意可执行标记或样式。

应将 `.env`、PostgreSQL 和完整存储目录视为同一个安全与恢复边界。禁止提交生产密钥或备份。

## 常用命令与测试

| 命令                         | 用途                                |
| ---------------------------- | ----------------------------------- |
| `pnpm dev`                   | 以监听模式运行 Fastify 与 Vite      |
| `pnpm build`                 | 构建生产前端和服务端                |
| `pnpm start`                 | 启动已经构建的生产服务              |
| `pnpm check`                 | 执行格式、ESLint 和 TypeScript 检查 |
| `pnpm test`                  | 执行单元测试                        |
| `pnpm test:integration`      | 执行 PostgreSQL 集成测试            |
| `pnpm browser:install`       | 安装 Playwright Chromium            |
| `pnpm test:e2e`              | 构建并执行浏览器测试                |
| `pnpm db:generate`           | 修改 Schema 后生成 Drizzle 迁移     |
| `pnpm db:migrate`            | 应用待执行数据库迁移                |
| `pnpm club admin:create ...` | 创建首个平台管理员                  |

集成与端到端测试的 `TEST_DATABASE_URL` 必须指向隔离数据库。CI 会启动 PostgreSQL 17，并执行代码检查、单元测试、迁移、集成测试、生产构建和浏览器测试。

## 项目结构

```text
src/
  server/
    infrastructure/       PostgreSQL、存储、加密和限流
    modules/              认证、绑定、快照、活动、领取等模块
  shared/                 API 与前端共享的 TypeBox 契约
  web/
    api/                  类型化前端 API 客户端
    components/           通用、首页和编辑器组件
    pages/                用户、组织和平台页面
migrations/               只向前执行的 Drizzle SQL 迁移与元数据
tests/
  unit/                   确定性的领域与服务测试
  integration/            PostgreSQL API 和迁移测试
  e2e/                    Playwright 生产页面流程
docs/                     规范、运维、发布和验收材料
compose.yaml              受支持的双服务部署
Dockerfile                生产多阶段镜像
```

每个领域模块拥有自己的数据表、服务、路由和不变量。前端可以共享网络契约，但不能导入数据库模型。

## 运维、备份与升级

有效备份必须是同一组数据，包含：

- PostgreSQL 数据库转储；
- 完整 `STORAGE_LOCAL_PATH` 或 `club-storage` 卷；
- `.env`，包括认证密钥和全部地址加密密钥；
- 部署的 Git 修订或镜像标识；
- 所有备份文件的校验和。

只备份数据库或只备份存储目录都不能完整恢复 Club。数据库迁移只向前执行；回滚意味着恢复升级前的完整备份和旧应用镜像。

准确命令、受保护的恢复探针、干净恢复验证、停止行为和故障处理见[运维与恢复指南](docs/operations.md)。

## 当前限制

- 只支持一个活动应用实例。
- 哔哩哔哩公开 Web 接口不是稳定官方契约，可能发生变化或触发地区/风控限制。
- 不支持手工名单导入、编辑快照成员或手工授予资格。
- 不包含支付、采购、仓储库存和自动购买物流面单。
- 不包含 Redis、通用任务队列、事件总线、微服务、GraphQL 或 SSR。
- 不提供原生手机应用，但 Web 界面支持响应式布局。
- 不提供浏览器实时推送、短信通知或通用邮件通知系统。
- 物流服务可扩展，但默认配置使用手工物流链接。

## 项目文档

- [产品与架构规范](docs/product-architecture.md)：产品行为、领域不变量、角色、数据模型和架构。
- [实施计划](docs/implementation-plan.md)：交付顺序和验证要求。
- [运维与恢复指南](docs/operations.md)：生产部署、备份、恢复、升级和故障处理。
- [哔哩哔哩集成说明](docs/integrations/bilibili.md)：经过验证的公开 Web 行为和接口假设。
- [发布检查清单](docs/release.md)：发布门槛与回滚准备。
- [验收证据](docs/acceptance.md)：已实现范围与验证证据。
- [UI 美术风格方案](docs/reports/Phase_UI_美术风格方案.md)：四套全局视觉系统。

产品规范是产品行为和架构的事实来源。实现与规范发生冲突时，应先解决规范冲突。

## 许可证与第三方声明

Club 项目自身当前标记为 `UNLICENSED`。不能仅因为源码可以公开访问，就推定获得复制、修改或重新分发 Club 的许可。

项目保留了 [`zclkkk/bilive-rec`](https://github.com/zclkkk/bilive-rec) 的贡献者、源码地址和 Parity Public License 7.0.0 声明：

- [第三方声明](THIRD_PARTY_NOTICES.md)
- [bilive-rec 许可证原文](LICENSES/bilive-rec-Parity-7.0.0.txt)

两份文件都会复制进运行时 Docker 镜像。
