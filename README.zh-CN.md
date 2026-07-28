# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

[English](README.md) | 简体中文

Club 是一个面向 Vtuber、主播及其观众的自托管舰长礼物领取与发货平台。它把 B站
UID 验证、月末大航海名单快照、礼物单自动生成、用户领取、主播发货和物流查询串成
一个完整闭环。

## 产品模型

Club 只有三种互斥身份：

- `USER`：普通用户，绑定 B站 UID、管理地址、领取礼物和查询物流；
- `CREATOR`：主播，拥有且只拥有一个主播档案，自行发布礼物并处理发货；
- `PLATFORM_ADMIN`：平台管理员，注册主播、管理验证直播间、名单同步和平台公告。

系统没有组织、组织成员、运营人员、独立履约人员或组合身份。公开注册始终创建普通
用户；平台管理员从已有普通用户中注册主播。

每个启用的主播都会按自身时区在每月最后一天 `23:59:00` 创建名单抓取任务，无论
该月是否发礼物。抓取从开始时刻归属当月，分页过程中得到的公开接口结果会经过完整
性校验，压缩原始响应写入对象存储，数据库只保留索引、摘要与 SHA-256。准时且一致
的名单自动定稿；延迟但一致的名单需要平台管理员确认；定稿成员不可修改。

名单快照和礼物发布彼此独立：

- 主播可以整月不发礼物，此时不会产生草稿、警告、占位卡片或礼物单；
- 每位主播每个资格月最多发布一份礼物；
- “已发布礼物”和“已定稿名单”同时存在时，系统才幂等生成礼物单；
- 先发布礼物或先定稿名单都会得到相同结果；
- 礼物单在领取前属于 B站 UID，用户提交领取时才冻结平台账号、地址和选项。

## 使用界面

普通用户登录后默认进入 `/dashboard`，看到固定 Banner、最近五条相关公告、当前最
需要处理的动作和礼物卡片。礼物状态只有：

`待领取 → 已提交 → 处理中 → 已发货 → 已完成`

以及终态 `已过期`、`已取消`。领取流程在同一页面完成礼物确认、地址选择或新增、
礼物选项与最终确认。

主播工作台位于 `/creator`：

- 概览
- 礼物发布
- 礼物单
- 主播公告
- 设置

平台管理位于 `/admin`：

- 概览
- 主播
- 名单同步
- 验证直播间
- 平台公告
- 系统

当前版本使用唯一固定响应式视觉系统，不提供主题、外观、页面编辑器、品牌资源库或
主播视觉自定义。

## 技术架构

Club 是 TypeScript 模块化单体：

- React、React Router、TanStack Query、Vite；
- Fastify、TypeBox/OpenAPI、Better Auth、Drizzle ORM、Pino；
- PostgreSQL 17；
- 本地原子对象存储，保存压缩名单证据和礼物图片；
- Vitest、Playwright；
- 单应用实例的 Docker Compose 部署。

生产进程同时提供前端与 `/api/v1` API。主播接口从登录会话解析唯一主播档案，不接
受浏览器传入的主播 ID；平台管理员接口才使用显式主播 ID。

## 本地开发

要求 Node.js `>=24 <25`、pnpm `11.9.0`、Docker Engine 与 Compose v2。

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

编辑 `.env`，至少替换：

- `POSTGRES_PASSWORD`，并同步修改两个数据库 URL；
- `BETTER_AUTH_SECRET`，不少于 32 个随机字符；
- `ADDRESS_ENCRYPTION_KEY_RING`，格式为 `1:<32 字节 base64 密钥>`。

然后启动数据库、迁移和开发服务器：

```powershell
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

前端默认位于 <http://localhost:5173>，API 位于 <http://localhost:3000>。

创建首个平台管理员：

```powershell
$env:CLUB_ADMIN_PASSWORD = 'replace-with-a-strong-password'
pnpm club admin:create --email admin@example.com --name Admin
Remove-Item Env:CLUB_ADMIN_PASSWORD
```

## Docker Compose

应用不会隐式执行数据库迁移。首次部署或更新代码时：

```powershell
docker compose up -d postgres
docker compose run --rm app pnpm db:migrate
docker compose up -d --build app
```

检查：

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

首个平台管理员也可以在容器内创建：

```powershell
docker compose exec -e CLUB_ADMIN_PASSWORD=replace-me app `
  pnpm club admin:create --email admin@example.com --name Admin
```

首次登录后：

1. 普通用户先通过注册页创建账号；
2. 平台管理员在“主播”页将该账号注册为主播，并填写主播 B站 UID、直播间和时区；
3. 在“验证直播间”中至少启用一个平台固定直播间；
4. 主播在自己的工作台创建并发布礼物；不发礼物的月份无需任何操作。

## 配置

| 变量                                    | 默认值                  | 说明                               |
| --------------------------------------- | ----------------------- | ---------------------------------- |
| `APP_URL`                               | `http://localhost:3000` | 公开来源地址，也是 Origin 校验基准 |
| `DATABASE_URL`                          | 必填                    | 当前进程连接 PostgreSQL 的 URL     |
| `BETTER_AUTH_SECRET`                    | 必填                    | Better Auth 密钥，至少 32 字符     |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` | `1`                     | 当前地址加密密钥版本               |
| `ADDRESS_ENCRYPTION_KEY_RING`           | 生产必填                | `版本:base64`，多个版本用逗号分隔  |
| `BILIBILI_LIVE_SOURCE`                  | `public-web`            | `public-web` 或测试用 `fake`       |
| `BILIBILI_ROSTER_SOURCE`                | `public-web`            | `public-web` 或测试用 `fake`       |
| `STORAGE_LOCAL_PATH`                    | `./data/club`           | 私有对象和礼物图片目录             |
| `TRACKING_PROVIDER`                     | `none`                  | `none` 或开发测试用 `fake`         |
| `TRUST_PROXY`                           | `false`                 | 仅在可信反向代理后启用             |
| `SMTP_*`                                | 未启用                  | 完整配置后启用邮件验证与密码重置   |

不存在 `CLUB_UI_THEME` 或其他运行时 UI 自定义配置。

## 数据与安全边界

- 地址簿、领取地址快照和礼物选项使用 AES-256-GCM 加密；
- 提交领取后，地址簿修改不会改变礼物单中的冻结地址；
- 名单原始分页响应压缩后写入存储，PostgreSQL 保存对象键、哈希、数量和时间；
- 审计日志、名单证据、冻结领取数据、状态历史和物流事件由数据库触发器保护；
- 礼物单与物流状态机同时在服务层和数据库边界校验；
- 所有状态修改 API 校验 Origin 并限流；
- 备份必须同时包含 PostgreSQL、对象存储、认证密钥和完整地址密钥环。

## 常用验证

```powershell
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
pnpm build
pnpm test:e2e
```

## 当前约束

- 仅支持一个活动应用实例；
- B站 `public-web` 来源不是稳定官方契约，可能受接口变化或风控影响；
- 不提供手工名单、手工资格或手工礼物单入口；
- 不包含采购、支付、库存、仓库管理或自动购买快递面单；
- 默认物流为主播手动录入，实时查询通过可替换 Provider 接入；
- 当前未提供原生移动应用，Web 界面支持移动宽度。

## 文档

- [重构决策与验收上下文](docs/creator-first-rebuild.md)
- [产品与架构](docs/product-architecture.md)
- [运维](docs/operations.md)
- [B站公开接口集成记录](docs/integrations/bilibili.md)
- [验收矩阵](docs/acceptance.md)
- [发布清单](docs/release.md)

项目许可证尚待仓库维护者最终选择；第三方来源与许可证保留在
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [LICENSES](LICENSES)。
