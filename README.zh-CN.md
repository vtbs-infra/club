# Club

[![CI](https://github.com/vtbs-infra/club/actions/workflows/ci.yml/badge.svg)](https://github.com/vtbs-infra/club/actions/workflows/ci.yml)

[English](README.md) | 简体中文

Club 是一个面向 B站 Vtuber、主播及其观众的自托管礼物领取与发货平台。它把观众的
B站 UID 与 Club 账号关联，覆盖月度大航海名单、礼物资格、用户领取、主播发货和物流
查询的完整流程。

## 主要能力

- 在平台管理的 B站直播间发送一次性验证码，完成 UID 绑定
- 从已验证账号读取主播身份和规范直播间
- 保存不可变的月度舰长、提督和总督名单快照
- 按月发布礼物，按大航海等级配置礼包并幂等匹配资格
- 使用加密、不可变的领取快照保护收件地址
- 按礼物发布导出履约数据、录入发货并维护物流历史
- 提供具有显式公开控制的礼物和公告门户
- 为普通用户、主播和平台管理员提供独立工作台
- 使用 PostgreSQL 和私有本地存储运行单实例 TypeScript 应用

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

主播只需在准备发放礼物的月份发布礼物。Club 会持续生成月度名单快照，并自动匹配同一
主播、同一月份的已定稿名单和已发布礼物。

## 使用 Docker 或 Podman 部署

### 环境要求

选择一种容器运行时：

- **Docker：** Docker Engine 与 Docker Compose v2
- **Podman：** Podman 4.7 或更高版本，以及可供 `podman compose` 调用的 Compose
  provider

两种方案都需要能够访问 B站 HTTPS 与 WebSocket 服务。检查准备使用的运行时：

```powershell
# Docker
docker --version
docker compose version

# Podman
podman --version
podman compose version
```

Windows 和 macOS 使用 Podman 时还需要启动虚拟机。若尚未创建虚拟机，只需执行一次
`podman machine init`，以后启动时运行：

```powershell
podman machine start
```

Podman Desktop 可在 [Compose 设置](https://podman-desktop.io/docs/compose/setting-up-compose)
中安装 provider；Linux 可安装 `podman-compose` 或其他受
[`podman compose`](https://docs.podman.io/en/latest/markdown/podman-compose.1.html) 支持的
provider。

### 1. 准备配置

克隆仓库并创建本地环境变量文件：

```powershell
git clone https://github.com/vtbs-infra/club.git
Set-Location club
Copy-Item .env.example .env
```

启动前必须替换 `.env` 中的所有占位密码和密钥，至少包括：

- `POSTGRES_PASSWORD`，以及两个数据库 URL 中经过 URL 编码的相同密码
- 不少于 32 个随机字符的 `BETTER_AUTH_SECRET`
- 含有 32 字节 Base64 密钥的 `ADDRESS_ENCRYPTION_KEY_RING`
- 与用户实际访问地址一致的 `APP_URL`

不要提交或泄露 `.env`。地址加密密钥一旦丢失，已有地址和领取字段将永久无法解密。

### 2. 启动 PostgreSQL 并迁移数据库

模板通过 `CLUB_IMAGE` 固定当前发布镜像。选择下面一组命令，并在同一部署中始终使用
相同运行时。

**Docker**

```powershell
docker compose pull app
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
```

**Podman**

```powershell
podman compose pull app
podman compose up -d postgres
podman compose run --rm app node dist/server/server/infrastructure/db/migrate.js
```

Club v0.2 使用 fresh-install 数据库基线，只能在空 PostgreSQL 数据库上初始化。

如需构建当前检出的源码，请删除 `.env` 中的 `CLUB_IMAGE`，然后运行对应命令：

```powershell
# Docker
docker compose build app

# Podman
podman compose build app
```

构建完成后，继续使用上方相同运行时对应的 `compose up` 和 `compose run` 命令启动
PostgreSQL 并执行迁移。

两种运行时共用同一份 `compose.yaml`、兼容 OCI 的 `Dockerfile`、环境变量、网络和命名卷。

### 3. 创建首个平台管理员

**Docker**

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app node dist/server/server/cli.js admin:create --email admin@example.com --name Admin
```

**Podman**

```powershell
podman compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app node dist/server/server/cli.js admin:create --email admin@example.com --name Admin
```

请使用高强度的一次性密码，并尽量从 Shell 历史中删除该命令。命令可以幂等重复执行；
同邮箱账号已存在时，会被校准为平台管理员。

### 4. 启动并验证 Club

**Docker**

```powershell
docker compose up -d --no-build app
docker compose ps
```

**Podman**

```powershell
podman compose up -d --no-build app
podman compose ps
```

无论选择哪种运行时，都使用相同健康接口验证应用：

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

两个健康接口都应返回 `status: ok`。打开 <http://localhost:3000>，使用管理员账号登录，
然后配置 B站验证直播间和首位主播。

常用运维命令：

| 操作 | Docker | Podman |
| --- | --- | --- |
| 查看应用日志 | `docker compose logs --tail 200 app` | `podman compose logs --tail 200 app` |
| 重启 Club | `docker compose restart app` | `podman compose restart app` |
| 停止部署 | `docker compose stop` | `podman compose stop` |
| 再次启动 | `docker compose start` | `podman compose start` |
| 删除容器和网络 | `docker compose down` | `podman compose down` |

`down` 命令会保留命名卷。除非明确要删除 Club 数据库和私有对象存储，否则不要附加
`--volumes`。

## 配置与持久化数据

| 项目 | 默认值 | 用途 |
| --- | --- | --- |
| Club | <http://localhost:3000> | Web 界面与 API |
| PostgreSQL | `127.0.0.1:55432` | 仅宿主机可访问的数据库端口 |
| `club-postgres` | 命名卷 | PostgreSQL 数据 |
| `club-storage` | 命名卷 | 名单证据和礼物图片 |

生产环境应把 Club 放在 HTTPS 反向代理之后，将 `APP_URL` 设置为公开 Origin，并且只在
代理可信时启用 `TRUST_PROXY`。备份必须同时包含两个命名卷、认证密钥和完整的地址加密
密钥环。

升级时，把 `CLUB_IMAGE` 更新为精确版本或 Digest，并联合备份数据库与存储，然后执行
所选运行时对应的命令。

**Docker**

```powershell
docker compose pull app
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d --no-build --force-recreate app
```

**Podman**

```powershell
podman compose pull app
podman compose run --rm app node dist/server/server/infrastructure/db/migrate.js
podman compose up -d --no-build --force-recreate app
```

执行迁移前必须阅读目标版本的更新记录。

## 文档

- [开始使用](docs/getting-started.md)
- [产品使用指南](docs/product-guide.md)
- [配置参考](docs/configuration.md)
- [运维手册](docs/operations.md)
- [技术架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [参与开发](CONTRIBUTING.md)
- [更新记录](CHANGELOG.md)

运行中的实例通过 `/openapi.json` 提供 OpenAPI 3.1 文档。

## 技术栈

- TypeScript 6 与 Node.js 24
- React 19、React Router、TanStack Query、Vite
- Fastify、TypeBox、Better Auth、Drizzle ORM、Pino
- PostgreSQL 17
- Docker、Podman 与 Compose Specification
- Vitest、Playwright

支持的拓扑只运行一个 Club 应用实例。该进程同时提供 Web、API、名单调度、B站直播间
连接、物流刷新和礼物封面回收任务。

## 许可证

Club 采用 [Parity Public License 7.0.0](LICENSE)。

授权主体：`zclkkk and Fox-yun`

源代码：<https://github.com/vtbs-infra/club>
