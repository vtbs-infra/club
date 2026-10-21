# 开发

代码和测试是行为的权威说明，本文只写读代码不容易发现的事情。项目取向见
[AGENTS.md](../AGENTS.md)。

## 本地启动

需要 Node.js 24、npm 11 和 Docker。

```bash
npm ci
cp .env.example .env
```

在 `.env` 中按注释生成两套密钥环，并设置数据库密码。

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Web 在 <http://localhost:5173>，API 在 <http://localhost:3000>，OpenAPI 文档在
`/openapi.json`。

## 测试

| 命令                                       | 证明什么                                       |
| ------------------------------------------ | ---------------------------------------------- |
| `npm test`                                 | 纯逻辑、适配器和 HTTP 外壳，不需要数据库       |
| `npm run test:integration`                 | 真实 PostgreSQL 上的业务规则、并发和数据库约束 |
| `npm run test:browser`                     | 生产构建的界面交互，API 由各场景提供           |
| `npm run test:e2e`                         | 浏览器、服务端和数据库组成的完整业务流程       |
| `npm run test:container -- --image <镜像>` | 生产镜像能迁移、启动并提供页面                 |

集成测试和 E2E 需要 `TEST_DATABASE_URL` 指向一个能创建和删除数据库的 PostgreSQL 连接，未设置时
直接失败。测试会为自己创建并删除临时数据库，不会改动连接里指定的库：

```bash
export TEST_DATABASE_URL='postgres://club:<数据库密码>@localhost:55432/postgres'
```

所有测试都用替身代替 B站，因此 CI 无法证明真实 B站接口仍然可用。

本机缺少浏览器依赖时，可以用与 `@playwright/test` 同版本的 Playwright 官方容器运行浏览器测试。
临时脚本和诊断文件放在被忽略的 `data/development/`。

## 修改数据库

数据库结构在 `src/server/infrastructure/db/schema/`。修改后：

1. 运行 `npm run db:generate` 生成迁移并审查 SQL。需要触发器或数据迁移时，直接写进这份 SQL；
2. 在 `src/server/infrastructure/db/schema-version.ts` 登记新迁移的时间戳和 SHA-256，
   `npm run db:check` 会核对它们；
3. 补充 PostgreSQL 集成测试。

已经部署的迁移文件只能追加，不能修改。基线里有维护业务不变量的手写触发器，调整表结构时要
保留它们。

## 依赖与检查

`npm run check` 包含格式、带类型分析的 Oxlint、各执行环境的类型检查和迁移一致性检查。
`npm run audit` 在出现高危公告时失败；Drizzle Kit 依赖链上已知的中危公告只涉及它的开发服务器，
本项目不使用。

依赖积极跟进上游的最新正式发布，不等新版本"沉淀"。Renovate 按 `renovate.json` 发起更新：
小版本和补丁在 CI 通过后自动合并，大版本和 0.x 的次版本需要审阅，锁文件每周整体刷新一次。
Node.js、npm 和 PostgreSQL 的大版本是计划内的平台升级，在 Renovate 的依赖看板上确认后才会发起；
`@types/node` 跟随运行时保持 24.x。
几组工具需要一起升级并核对兼容性：Vite 与 React 插件，Vitest 与 coverage，Oxlint、
tsgolint 与 TypeScript。依赖的安装脚本默认禁止，放行名单在 `package.json` 的 `allowScripts`。

## 发布

版本号以 `package.json` 为准。

1. 更新 `package.json` 的版本。查看上次发布以来的提交（`git log v<上一版本>..HEAD`），在
   `CHANGELOG.md` 写下这个版本带日期的章节：不兼容变更、升级时必须执行的操作和值得了解的新能力。
   这一节同时作为 GitHub Release 的正文；
2. 在 `master` 上检查并打 Tag：

```bash
version=$(node -p "require('./package.json').version")
npm run release:check -- --tag "v$version"
git tag -a "v$version" -m "Club v$version"
git push origin "v$version"
```

Tag 会触发发布流水线：在同一提交上重新运行完整 CI，构建并验证 `linux/amd64` 镜像，推送到
`ghcr.io/vtbs-infra/club`，再创建 GitHub Release。

- 已发布的版本、Tag、镜像和迁移都不覆盖。流水线失败时在 Actions 中重跑失败的 job；如果同一
  版本对应了不同的提交或来源，停下来人工处理；
- 编辑 Release 说明时，保留末尾的镜像 Digest 和 Revision；
- GHCR 包首次创建后，需要在 GitHub 上手动设为公开；
- CI 用替身代替 B站。发布前在独立环境用真实 B站账号走一遍从注册、名单抓取到发货的流程。
