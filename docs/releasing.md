# Club 发布手册

本手册用于准备、验证和发布 Club 版本。部署升级和故障恢复见[运维手册](operations.md)。

## 版本与发布物

Club 使用语义化版本，Git Tag 格式为 `vMAJOR.MINOR.PATCH`。`package.json` 是应用版本的
唯一来源，健康接口、系统页面和 OpenAPI 使用同一版本。

一次正式发布包含：

- Git Tag 和 GitHub Release；
- 对应版本的源代码归档；
- `ghcr.io/vtbs-infra/club:MAJOR.MINOR.PATCH` 容器镜像；
- Changelog 中同版本的用户可见变更；
- 镜像 Digest 和最新数据库迁移标识。

当前流水线只发布经过验证的 `linux/amd64` 镜像。增加其他架构前，必须在对应架构上执行
启动、迁移和核心流程验收。

精确版本 Tag 是部署和回滚记录的依据。`latest` 只在精确版本镜像完成发布后更新，不能
替代备份记录中的版本或 Digest。

GHCR Package 必须设置为 Public，并关联 `vtbs-infra/club` 仓库。首次创建 Package 后需要
在 GitHub Package 设置中确认公开可见性，并在未登录状态执行一次 `docker pull`；发布
Token 不负责更改组织的 Package 可见性。

## 发布准备

1. 确认目标能力已经进入长期产品、架构和运维文档；
2. 删除已完成的开发规格、临时迁移说明和过渡兼容路径；
3. 更新 `package.json` 版本；
4. 把 `CHANGELOG.md` 的用户可见内容归入带日期的版本章节；
5. 检查新环境变量、数据库迁移和备份范围；
6. 确认工作区干净，发布提交已经位于 `master`。

运行发布元数据检查：

```powershell
pnpm release:check
```

## 自动质量门

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/postgres'
pnpm test:integration
pnpm test:browser
docker compose build --no-cache app
```

必须确认：

- 格式、ESLint 和三套 TypeScript 检查通过；
- 单元、PostgreSQL 集成和 Playwright 工作流全部通过；
- 空数据库和已有数据库都能应用全部迁移；
- OpenAPI 包含当前正式路由且版本正确；
- 生产镜像以非 root 用户运行，并包含生产依赖、`dist`、迁移和 `LICENSE`；
- Markdown 本地链接、Fixture、日志和测试产物检查通过。

## Release Candidate 验收

使用独立 Compose Project、数据库卷、存储卷和端口验证候选镜像，不复用开发环境数据。

至少完成：

1. 从空环境启动 PostgreSQL、应用迁移并创建首个平台管理员；
2. 配置一个真实验证直播间并完成 B站 UID 绑定；
3. 验证真实名单 Provider 请求和分页证据存储；
4. 创建并发布礼物，确认名单与发布可以双向幂等生成礼物单；
5. 使用默认或指定地址提交领取，确认历史地址快照不随地址簿变化；
6. 导出待发货信息，确认导出前后礼物单状态不变；
7. 录入运单并检查普通用户看到的物流信息；
8. 检查公开礼物、公开公告和四套全局主题；
9. 在与 `APP_URL` 一致的 HTTPS 反向代理后验证登录和写请求；
10. 创建数据库与存储联合备份，并在隔离环境完成恢复。

外部 B站请求无法由 Stub 或构建成功替代。真实 Provider 验收结果应记录时间、目标房间和
成功边界，但不得把 Cookie、验证码或用户数据写入仓库。

## 创建发布

发布 Tag 前再次确认目标提交和版本：

```powershell
$releaseVersion = (Get-Content package.json | ConvertFrom-Json).version
pnpm release:check -- --tag "v$releaseVersion"
git status --short
git show --stat --oneline HEAD
```

随后创建并推送带注释 Tag：

```powershell
git tag -a "v$releaseVersion" -m "Club v$releaseVersion"
git push origin "v$releaseVersion"
```

Tag 流水线必须在同一 Revision 上重新执行质量门，成功后才推送版本化镜像并创建 GitHub
Release。不要对已经发布的 Tag、迁移或容器版本覆盖写入。

## 发布后检查

1. 使用精确版本 Tag 拉取镜像并记录 Digest；
2. 在候选环境执行迁移、启动和 readiness 检查；
3. 核对 GitHub Release、Changelog、源代码和镜像 Revision 一致；
4. 验证公开首页、登录、管理员系统页和一个核心业务流程；
5. 将 Digest、迁移标识和对应备份集写入部署记录。

发现问题时停止推广 `latest`。涉及数据库不兼容时，使用发布前的数据库与存储联合备份
恢复，不使用代码回退配合较新的 Schema 继续运行。
