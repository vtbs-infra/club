# 开发指南

本指南说明本地开发、代码组织、数据库迁移和测试流程。版本发布见
[发布手册](releasing.md)。

## 开发环境

- Node.js `>=24 <25`
- pnpm `11.9.0`
- Docker Engine
- Docker Compose v2

安装依赖：

```powershell
corepack enable
pnpm install
Copy-Item .env.example .env
```

配置 `.env` 后启动 PostgreSQL：

```powershell
docker compose up -d postgres
pnpm db:migrate
```

启动 Fastify 与 Vite：

```powershell
pnpm dev
```

开发地址：

- Web：<http://localhost:5173>
- API：<http://localhost:3000>
- OpenAPI：<http://localhost:3000/openapi.json>

Vite 会把 API 与健康检查请求代理到 Fastify。

## 常用命令

| 命令                    | 用途                            |
| ----------------------- | ------------------------------- |
| `pnpm dev`              | 同时启动服务端和 Web 开发服务器 |
| `pnpm dev:server`       | 启动 Fastify Watch              |
| `pnpm dev:web`          | 启动 Vite                       |
| `pnpm check`            | 文档链接、格式、Lint 和类型检查 |
| `pnpm test`             | 单元测试                        |
| `pnpm test:integration` | PostgreSQL 集成测试             |
| `pnpm test:browser`     | 生产构建和浏览器工作流测试      |
| `pnpm build`            | 生成生产服务端和 Web 输出       |
| `pnpm db:generate`      | 根据 Drizzle Schema 生成迁移    |
| `pnpm db:migrate`       | 应用迁移                        |
| `pnpm club`             | 运行开发版 Club CLI             |
| `pnpm club:prod`        | 运行编译后的 Club CLI           |
| `pnpm db:migrate:prod`  | 运行编译后的迁移入口            |

## 代码组织

```text
src/server/app.ts                     应用组装与 Fastify 生命周期
src/server/config/                    环境变量解析
src/server/infrastructure/            数据库、加密、日志、安全、存储
src/server/modules/                   业务模块与 HTTP 路由
src/shared/contracts/                 TypeBox API Schema 与共用类型
src/web/api/                          浏览器 API Client
src/web/components/                   通用界面组件
src/web/pages/                        路由页面
src/web/app/App.tsx                   浏览器路由
migrations/                           PostgreSQL 迁移
tests/unit/                            纯逻辑与基础设施测试
tests/integration/                     真实 PostgreSQL 测试
tests/browser/                         Playwright 界面与请求意图测试
tests/e2e/                             浏览器、真实服务端与 PostgreSQL 业务闭环
tests/helpers/                         显式、跨场景复用的测试基础设施
```

## 服务端开发

### 模块边界

业务模块通过构造函数接收数据库、存储、加密、时钟或 Provider。HTTP 路由负责：

- 会话和身份守卫；
- TypeBox 请求与响应 Schema；
- 参数转换；
- HTTP 状态码。

领域服务负责：

- 事务；
- 业务规则；
- 稳定错误码；
- 审计记录；
- 幂等与并发处理。

Provider 原始类型停留在适配器内部。B站和私有本地存储实现通过小接口接入业务服务。

### 错误

可预期错误使用 `AppError`：

```ts
throw new AppError('GIFT_ORDER_NOT_CLAIMABLE', 'This gift cannot be claimed.', 409);
```

错误码面向 API 调用方保持稳定。日志记录完整 Error，上行响应只返回安全消息和请求 ID。

### 数据库事务

需要同时更新多个业务记录的操作使用 Drizzle Transaction。读取后决定状态转换的记录
使用 `for('update')` 锁定。状态历史、审计与主记录在同一个事务中提交。

数据库约束和触发器用于维护服务层之外也必须成立的不变量。

## Web 开发

浏览器路由位于 `src/web/app/App.tsx`。三个受保护区域分别使用普通用户、主播和平台
管理员布局。

约定：

- TanStack Query 管理 API 服务端状态；
- `src/web/api/` 按领域组织请求，并从共享契约取得响应类型；
- `src/web/api/http.ts` 统一处理凭据、JSON 和 API Error；
- 应用主题由路由外的 `AppearanceProvider` 统一管理，页面不得自行读取或持久化主题；
- 业务样式使用 `tokens.css` 的语义令牌，预设差异只在 `themes.css` 覆盖令牌；
- 表单在提交前显示明确校验错误；
- 状态修改成功后使相关 Query 失效；
- 桌面和 390px 宽度都应保持核心流程可用。

## 数据库迁移

Schema 位于：

```text
src/server/infrastructure/db/schema/
```

用户名与 UID 基线不支持导入旧认证模型的数据库；已经采用此基线的数据库支持追加迁移。
基线包含定稿、不可变集合和业务状态等手写触发器，后续变更必须保留这些业务约束。每次
追加迁移都须同步 `schema-version.ts` 的迁移清单、时间戳和 SHA-256，并执行
`pnpm release:check` 检查 SQL 与元数据一致。

进入正式发布后的结构调整：

```powershell
pnpm db:generate
```

审查生成的 SQL 和 `migrations/meta`，然后在本地数据库应用：

```powershell
pnpm db:migrate
```

需要 PostgreSQL 触发器、约束或数据迁移时，在生成的迁移 SQL 中加入明确的自定义语句，
并为它们添加集成测试。

`0000_username_uid_baseline.sql` 从空数据库建立初始结构；后续结构调整只追加新迁移，
不改写已经部署的文件。迁移器只接受应用清单的完整前缀，拒绝不匹配或更高版本的记录。
迁移校验、剩余 SQL 和日志写入在同一个持锁事务中执行，SQL 必须能在 PostgreSQL 事务内
运行。测试同时覆盖空库安装、已有基线升级、并发执行、失败回滚和重试；应用的就绪检查
仍要求全部迁移已执行。

## 测试

测试按它实际证明的边界组织，而不是按生产代码目录逐层镜像。

### 单元测试

```powershell
pnpm test
```

单元测试覆盖：

- 配置解析；
- 加密密钥环；
- B站消息和名单规范化；
- 月末时间计算；
- 限流与日志脱敏；
- 本地对象存储；
- Fastify 路由、OpenAPI 与生命周期。

单元测试验证纯逻辑、适配器边界以及通过显式 Stub 组装的应用行为，不连接真实
PostgreSQL 或 B站服务。应用健康检查、HTTP Shell 和后台运行时生命周期分别测试，
使失败能够直接指向对应边界。

### PostgreSQL 集成测试

设置 PostgreSQL 管理连接并运行：

```powershell
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/postgres'
pnpm test:integration
Remove-Item Env:TEST_DATABASE_URL
```

集成测试从该连接创建临时数据库，执行迁移后验证认证、UID 验证、名单、礼物单、状态
机、数据库触发器和就绪检查。测试完成后会删除自己的临时数据库。

`TEST_DATABASE_URL` 是强制门禁；缺少时命令会失败，不会跳过整个集成测试项目。

测试按业务能力组织。每个普通测试文件通过 `tests/helpers/integration-database.ts` 获得
独立数据库；用户、主播、礼物和名单等业务数据仍在对应测试中明确创建，不能藏入全局
Seed。迁移测试需要独立控制空数据库和迁移记录不匹配场景，因此保留自己的生命周期。

认证集成测试按用例创建独立数据库、应用、存储和时钟；每个场景通过正常注册入口建立
自己需要的账号，外部 B站消息使用显式替身。账号创建、密码修改和审计前置操作不得依赖
其他测试执行。认证套件须能单独选择任意用例运行，也能按随机顺序运行。

测试地址对应的账号必须具备创建和删除临时数据库的权限。套件只把该 URL 用作管理
入口，不会清空 URL 中指定的数据库。

### 浏览器工作流测试

首次安装 Chromium：

```powershell
pnpm browser:install
```

运行：

```powershell
pnpm test:browser
```

该命令先执行生产构建，再启动测试服务并运行 Playwright。浏览器测试使用真实生产 React
Shell 和按共享契约构造的 Mock API，覆盖注册反馈、手机仪表盘、默认地址领取、主播当前
内容发布、800px 管理编辑器以及全局主题预览和应用。它验证导航、响应式布局、表单值、
焦点、弹窗、主题继承和请求意图，不验证后端事务或数据库状态，也不替代真实 PostgreSQL
集成测试。

浏览器数据构造器复用 `src/shared/contracts/` 类型，并以固定时钟生成稳定日期。每个场景
只配置自己使用的 API；不要增加通用假后端或 Page Object 层。

对领取、主播发货、管理员流程或全局主题运行时进行界面修改时，应增加相应的浏览器场景。

### 完整业务闭环

```powershell
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/postgres'
pnpm test:e2e
```

该命令构建生产 Web，使用真实 Fastify Cookie/Session、独立 PostgreSQL 新库及本地私有存储，
从浏览器 UID 验证与注册、用户名登录开始验证主播注册、自动名单定稿、礼物发布、手机端领取、
XLSX 下载、确认发货、更正与复制单号。测试只替换 B站的三个外部来源；后台使用实际调度循环。
缺少测试数据库连接时必须失败。CI 同时执行界面测试和完整业务闭环。

容量集成测试覆盖 30,000 人名单、90,000 条累计套餐分配、关闭、查询，以及 30,000 条
待发货订单导出。它证明这些场景的正确性，不代表所有部署硬件的延迟或吞吐保证。

### 公共测试助手

- 公共助手只提取重复的技术搭建或稳定的测试数据词汇。
- 业务前置条件和关键状态变化留在测试文件中，使场景可以独立阅读。
- 不为减少行数创建可配置的巨型 Fixture、隐式全局 Hook 或跨测试共享的可变状态。
- 同一规则只在最低且足够的层级证明；浏览器测试可以检查请求意图，但不重复数据库断言。

## 完整质量检查

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/postgres'
pnpm test:integration
pnpm build
pnpm test:browser
pnpm test:e2e
docker compose build app
```

提交前还应确认：

- `git diff --check` 没有空白错误；
- OpenAPI 包含新增或修改的路由；
- 迁移可以应用到空数据库；
- 日志、Fixture 和截图不包含真实用户数据或密钥。

完整版本、Release Candidate、Tag、镜像和发布后检查见[发布手册](releasing.md)。

认证变更的集成验收在 `tests/integration/identity-auth.test.ts`，覆盖证明归属、重复 UID、
并发消费、找回、会话撤销和后台重启。业务 Fixture 可直接创建已验证账号，不能用它代替
真实注册入口的验收。当前基线不提供旧账号或旧数据库兼容层。

在 `/tmp` 为 tmpfs 的开发机上，将 `TMPDIR`、包管理器缓存与 `PLAYWRIGHT_BROWSERS_PATH`
指向磁盘上的项目忽略目录，例如 `data/development/`，避免将下载、构建和数据库测试
临时文件留在内存文件系统。浏览器测试可以通过 `--workers=1` 串行执行。

如果宿主机没有 Chromium 动态库，可以用与项目依赖版本一致的
[Playwright 官方容器](https://playwright.dev/docs/docker)执行浏览器测试。当前版本为
`mcr.microsoft.com/playwright:v1.61.1-noble`；先在源码目录安装依赖并构建，容器读取源码、
`node_modules` 和 `dist`，直接运行 `node node_modules/@playwright/test/cli.js test`。
将临时目录和测试结果目录挂载到磁盘；完整 E2E 还须提供独立测试库的 `TEST_DATABASE_URL`。
更新 Playwright 依赖后，也应同步测试容器版本。
