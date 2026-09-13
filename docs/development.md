# 开发指南

本指南说明本地开发、代码组织、数据库迁移和测试流程。版本发布见
[发布手册](releasing.md)。

## 开发环境

- Node.js `>=24 <25`
- npm `>=11.19 <12`（使用当前 Node.js 24 发行版附带的 npm）
- Docker Engine
- Docker Compose v2

安装依赖：

```powershell
npm ci
Copy-Item .env.example .env
```

`npm ci` 按提交的 `package-lock.json` 重建依赖目录，适用于首次安装、切换分支和 CI。
添加或更新依赖时使用 `npm install` / `npm update`，并提交对应的锁文件变化。
依赖安装脚本许可由 `package.json` 的 `allowScripts` 声明，`.npmrc` 启用严格检查。

`dependencies` 只包含编译后的 Node.js 服务端和 CLI 运行时需要的包；React、UI 组件等
纯前端包与构建、测试工具放在 `devDependencies`。前端代码已打包到 `dist/web`，生产镜像
在构建完成后通过 `npm prune --omit=dev` 移除这些包。

`npm run audit` 检查全部依赖，并在出现 high / critical 公告时失败，确保前端和开发工具
也纳入 CI 审计。当前剩余 moderate 条目来自 Drizzle Kit 的旧 esbuild 链；该公告涉及
esbuild 开发服务器，我们仅使用 Kit 生成迁移，待稳定上游更新后处理，不强制替换内部工具。

配置 `.env` 后启动 PostgreSQL：

```powershell
docker compose up -d postgres
npm run db:migrate
```

启动 Fastify 与 Vite：

```powershell
npm run dev
```

开发地址：

- Web：<http://localhost:5173>
- API：<http://localhost:3000>
- OpenAPI：<http://localhost:3000/openapi.json>

Vite 会把 API 与健康检查请求代理到 Fastify。

前端使用 Vite 8 的 Rolldown / Oxc 构建链，React 插件采用默认转换配置。生产构建使用
Vite 的 `baseline-widely-available` 目标，当前最低版本为 Chrome / Edge 111、Firefox 114
和 Safari 16.4。

## TypeScript 与静态检查

TypeScript 7 负责类型检查和服务端 JavaScript 输出；开发 Watch、CLI 与维护脚本由 `tsx`
运行。生产入口运行 `dist/server` 中的 JavaScript。服务端继续使用带 `.js` 后缀的相对导入，
构造函数参数属性由编译器或 `tsx` 转换。

根 `tsconfig.json` 是供编辑器与 Oxlint 发现项目的入口，各配置对应实际执行环境：

| 配置                   | 用途                                                     |
| ---------------------- | -------------------------------------------------------- |
| `tsconfig.server.json` | NodeNext 服务端与共享代码，输出 JavaScript 和 source map |
| `tsconfig.web.json`    | Vite 浏览器代码与共享代码，Bundler 解析与 DOM 类型       |
| `tsconfig.test.json`   | Vitest / Playwright 测试，Bundler 解析与 Node / DOM 类型 |
| `tsconfig.node.json`   | NodeNext 工具配置与维护脚本，同时检查 `.mjs`             |

共享代码分别在服务端和浏览器环境中检查。`npm run typecheck` 显式检查各项目；
服务端构建不生成无人消费的声明文件。

`npm run lint` 使用 Oxlint，`.oxlintrc.json` 同时为命令行和编辑器启用 tsgolint 类型分析。
TypeScript 与 `oxlint-tsgolint` 固定到对应版本，升级时一起核对；例如 tsgolint `7.0.2001`
对应 TypeScript `7.0.2`。Prettier 统一负责代码、Markdown 和 YAML 格式化。

规则以正确性检查为基础，补充 Promise 误用、不安全的 `any` 传播和核心 React / Hooks
检查。Drizzle 等 thenable 也必须处理；React 事件属性允许异步处理器，其余回调仍检查
Promise 误用。是否处理拒绝、是否需要等待任务完成，仍须结合调用方的生命周期审查，
`void` 本身不会处理异常。

不启用整套风格、性能建议或 React Compiler 实验性规则。必要的局部豁免使用带原因的
`oxlint-disable-next-line`；失效的豁免会使检查失败。新增规则应能说明它防止哪类实际错误，
不以复刻旧工具的规则清单为目标。

## 常用命令

| 命令                       | 用途                               |
| -------------------------- | ---------------------------------- |
| `npm run dev`              | 同时启动服务端和 Web 开发服务器    |
| `npm run dev:server`       | 启动 Fastify Watch                 |
| `npm run dev:web`          | 启动 Vite                          |
| `npm run check`            | 格式、Lint、类型和迁移一致性检查   |
| `npm run audit`            | 检查全部依赖的安全公告             |
| `npm test`                 | 单元测试                           |
| `npm run test:integration` | PostgreSQL 集成测试                |
| `npm run test:browser`     | 生产构建和浏览器工作流测试         |
| `npm run build`            | 生成生产服务端和 Web 输出          |
| `npm run db:generate`      | 根据 Drizzle Schema 生成迁移       |
| `npm run db:check`         | 检查 SQL、元数据与应用迁移清单一致 |
| `npm run db:migrate`       | 应用迁移                           |
| `npm run club`             | 运行开发版 Club CLI                |
| `npm run club:prod`        | 运行编译后的 Club CLI              |
| `npm run db:migrate:prod`  | 运行编译后的迁移入口               |

## 代码组织

```text
src/server/app.ts                     业务应用组装与后台运行器生命周期
src/server/http-app.ts                HTTP 外壳、错误处理和静态资源
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
scripts/                               构建、迁移检查与版本发布的可重复维护工具
```

`scripts/` 保留从干净 checkout 维护和交付项目所需的入口。临时探针、诊断、依赖评估和
一次性操作放在被忽略的 `data/development/`，正式构建、测试和运维不引用其中的文件。

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
`npm run db:check` 检查 SQL 与元数据一致；该检查也包含在 `npm run check` 中。

进入正式发布后的结构调整：

```powershell
npm run db:generate
```

审查生成的 SQL 和 `migrations/meta`，然后在本地数据库应用：

```powershell
npm run db:migrate
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
npm test
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
npm run test:integration
Remove-Item Env:TEST_DATABASE_URL
```

集成测试从该连接创建临时数据库，执行迁移后验证认证、UID 验证、名单、礼物单、状态
机和数据库约束。测试完成后会删除自己的临时数据库。

`TEST_DATABASE_URL` 是强制门禁；缺少时命令会失败，不会跳过整个集成测试项目。

测试按业务能力组织。每个普通测试文件通过 `tests/helpers/integration-database.ts` 获得
独立数据库。需要多个场景的套件按用例重建或清理业务状态，迁移测试使用同一助手提供的
空库入口。账号、主播和已接受名单等前置状态由小型 Fixture 直接创建；验证注册、发布或
采集本身的场景仍调用相应真实入口。

集成测试使用 Vitest 默认的文件级并行调度，仓库不固定 worker 数量。同一文件内的场景
仍顺序执行；业务竞争由场景内的并发操作验证。

认证集成测试按用例创建独立数据库、应用、存储和时钟。登录、找回和会话撤销从已有账号
开始，注册与审计测试保留实际证明消费过程。`buildTestApp` 明确替换 B站外部边界；需要
真实读取账号服务的场景直接组装 `buildApp`。可以随机排列集成场景以检查相互依赖：

```powershell
npm run test:integration -- --sequence.shuffle --sequence.seed=913
```

测试地址对应的账号必须具备创建和删除临时数据库的权限。套件只把该 URL 用作管理
入口，不会清空 URL 中指定的数据库。

### 浏览器工作流测试

首次安装 Chromium：

```powershell
npm run browser:install
```

运行：

```powershell
npm run test:browser
```

该命令先执行生产构建，再启动测试服务并运行 Playwright。测试服务复用生产 HTTP 外壳，
不组装数据库和业务服务。浏览器运行真实 React 界面，按场景提供 API 响应，用于验证跨账号
缓存隔离、编辑版本保持、时间边界刷新、确认弹窗、验证码复制和主题预览等交互。

API Mock 按请求方法和路径声明，场景可以覆盖共享默认响应。未被任何处理器接住的
`/api` 请求会被阻止，并在测试结束时报告方法与路径、判定失败；前端捕获网络错误不会
绕过这项检查。显式声明的错误响应可以正常用于失败场景，静态资源仍由生产 HTTP 外壳
提供。查询参数只在与场景行为有关时检查，不固定无关的请求顺序或次数。

这些测试不在 Mock API 中重新实现发布、领取和发货服务。主要成功流程由下面的真实业务
闭环承担；API 数据构造器仍使用共享契约类型。

### 完整业务闭环

```powershell
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/postgres'
npm run test:e2e
```

该命令构建生产 Web，使用真实 Fastify Cookie/Session、独立 PostgreSQL 新库及本地私有存储，
从浏览器 UID 验证与注册、用户名登录开始验证主播注册、自动名单定稿、礼物发布、手机端领取、
XLSX 下载、确认发货、更正与复制单号。测试替换 B站外部服务；采集通过应用持有的实际运行器 `app.runtimes.snapshot.tick()`
推进，避免等待固定调度间隔。调度与重试规则由运行器单元测试验证。
缺少测试数据库连接时必须失败。CI 同时执行界面测试和完整业务闭环。

`fulfillment-capacity.test.ts` 集中验证 30,000 人名单生成、90,000 条累计套餐分配、关闭和
30,000 条待发货订单导出。领取规则、分页和 XLSX 字段格式分别使用小样本测试；这一个
容量场景验证大集合处理，不代表所有部署硬件的延迟或吞吐保证。

### 公共测试助手

- 公共助手只提取重复的技术搭建或稳定的测试数据词汇。
- 业务前置条件和关键状态变化留在测试文件中，使场景可以独立阅读。
- 不为减少行数创建可配置的巨型 Fixture、隐式全局 Hook 或跨测试共享的可变状态。
- 同一规则只在最低且足够的层级证明；浏览器测试可以检查请求意图，但不重复数据库断言。

## 完整质量检查

```powershell
npm ci
npm run check
npm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/postgres'
npm run test:integration
npm run build
npm exec -- playwright test --project chromium
npm exec -- playwright test --project e2e
docker compose build --pull app
```

完整检查中的两个 Playwright 项目复用前面的构建；单独运行时仍可使用会自动构建的
`npm run test:browser` 和 `npm run test:e2e`。

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
`mcr.microsoft.com/playwright:v1.63.0-noble`；先在源码目录安装依赖并构建，容器读取源码、
`node_modules` 和 `dist`，直接运行 `node node_modules/@playwright/test/cli.js test`。
将临时目录和测试结果目录挂载到磁盘；完整 E2E 还须提供独立测试库的 `TEST_DATABASE_URL`。
更新 Playwright 依赖后，也应同步测试容器版本。
