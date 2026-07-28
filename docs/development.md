# 开发指南

本指南说明本地开发、代码组织、数据库迁移、测试和发布流程。

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
| `pnpm check`            | 格式、ESLint 和 TypeScript      |
| `pnpm test`             | 单元测试                        |
| `pnpm test:integration` | PostgreSQL 集成测试             |
| `pnpm test:e2e`         | 生产构建和 Playwright           |
| `pnpm build`            | 生成生产服务端和 Web 输出       |
| `pnpm db:generate`      | 根据 Drizzle Schema 生成迁移    |
| `pnpm db:migrate`       | 应用迁移                        |
| `pnpm club`             | 运行 Club CLI                   |

## 代码组织

```text
src/server/app.ts                     应用组装与 Fastify 生命周期
src/server/config/                    环境变量解析
src/server/infrastructure/            数据库、加密、日志、安全、存储
src/server/modules/                   业务模块与 HTTP 路由
src/shared/                           服务端与 Web 共用类型
src/web/api/                          浏览器 API Client
src/web/components/                   通用界面组件
src/web/pages/                        路由页面
src/web/app/App.tsx                   浏览器路由
migrations/                           PostgreSQL 迁移
tests/unit/                            纯逻辑与基础设施测试
tests/integration/                     真实 PostgreSQL 测试
tests/e2e/                             Playwright 浏览器测试
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

Provider 原始类型停留在适配器内部。B站、物流和存储实现通过小接口接入业务服务。

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
- `src/web/api/client.ts` 定义请求和响应类型；
- `src/web/api/http.ts` 统一处理凭据、JSON 和 API Error；
- 表单在提交前显示明确校验错误；
- 状态修改成功后使相关 Query 失效；
- 桌面和 390px 宽度都应保持核心流程可用。

## 数据库迁移

Schema 位于：

```text
src/server/infrastructure/db/schema.ts
```

修改数据结构后：

```powershell
pnpm db:generate
```

审查生成的 SQL 和 `migrations/meta`，然后在本地数据库应用：

```powershell
pnpm db:migrate
```

需要 PostgreSQL 触发器、约束或数据迁移时，在生成的迁移 SQL 中加入明确的自定义语句，
并为它们添加集成测试。

已经进入发布版本的迁移文件保持不变。新的结构调整使用新的迁移。

## 单元测试

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

单元测试不连接真实 B站服务。

## PostgreSQL 集成测试

创建隔离测试数据库：

```powershell
docker compose exec -T postgres createdb -U club club_test
```

设置连接并运行：

```powershell
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
Remove-Item Env:TEST_DATABASE_URL
```

集成测试从该连接创建临时数据库，执行迁移后验证认证、UID 绑定、名单、礼物单、状态
机、数据库触发器和就绪检查。测试完成后会删除自己的临时数据库。

测试地址必须指向可用于创建和删除临时数据库的隔离 PostgreSQL 实例。

## 浏览器测试

首次安装 Chromium：

```powershell
pnpm browser:install
```

运行：

```powershell
pnpm test:e2e
```

该命令先执行生产构建，再启动测试服务并运行 Playwright。E2E 覆盖生产 React Shell、
健康接口和手机宽度普通用户仪表盘。

对领取、主播发货或管理员流程进行界面修改时，应增加相应的浏览器场景。

## 完整质量检查

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
pnpm build
pnpm test:e2e
docker compose build app
```

提交前还应确认：

- `git diff --check` 没有空白错误；
- Markdown 本地链接有效；
- OpenAPI 包含新增或修改的路由；
- 迁移可以应用到空数据库；
- 日志、Fixture 和截图不包含真实用户数据或密钥。

## 发布

1. 更新 `package.json` 版本与服务端 OpenAPI 版本。
2. 在 `CHANGELOG.md` 中写入本次可见变更。
3. 运行完整质量检查。
4. 在 PostgreSQL 17 上完成迁移与恢复演练。
5. 构建生产镜像并确认镜像内包含 `LICENSE`、迁移和 `dist`。
6. 验证 `/health/live`、`/health/ready` 和 `/openapi.json`。
7. 使用 `vMAJOR.MINOR.PATCH` 标记发布提交。
8. 记录镜像 Digest、迁移标识和对应备份集。

部署后的检查见[运维手册](operations.md#升级)。
