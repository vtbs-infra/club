# Club 配置参考

Club 从进程环境变量读取配置。本地开发时 `src/server/config/load-local-env.ts` 会加载
仓库根目录的 `.env`；Docker Compose 与 Podman Compose 同样读取 `.env` 并显式传入
容器。

复制模板：

```powershell
Copy-Item .env.example .env
```

不要提交 `.env`。生产环境至少要替换数据库密码、认证密钥和地址加密密钥。

## 应用

| 变量          | 示例                   | 说明                                    |
| ------------- | ---------------------- | --------------------------------------- |
| `NODE_ENV`    | `production`           | `development`、`test` 或 `production`   |
| `APP_URL`     | `https://club.example` | 用户访问的公开根地址，只允许 HTTP/HTTPS |
| `HOST`        | `0.0.0.0`              | HTTP 监听地址                           |
| `PORT`        | `3000`                 | 容器内 HTTP 端口                        |
| `CLUB_PORT`   | `3000`                 | Compose 映射到宿主机的端口              |
| `LOG_LEVEL`   | `info`                 | Pino 日志级别                           |
| `TRUST_PROXY` | `false`                | 位于可信反向代理后时设为 `true`         |

`APP_URL` 必须与浏览器实际 Origin 完全一致，包括协议、主机和非默认端口。配置不一致时
Better Auth 会拒绝请求并返回 `Invalid origin`。

启用 `TRUST_PROXY` 前应确认应用只通过受控代理访问，否则客户端可伪造转发头。

## PostgreSQL

| 变量                   | 示例                                            | 说明                      |
| ---------------------- | ----------------------------------------------- | ------------------------- |
| `DATABASE_URL`         | `postgres://club:password@localhost:55432/club` | 本地进程使用的连接        |
| `COMPOSE_DATABASE_URL` | `postgres://club:password@postgres:5432/club`   | 应用容器使用的连接        |
| `POSTGRES_PASSWORD`    | 长随机字符串                                    | Compose PostgreSQL 密码   |
| `POSTGRES_HOST_PORT`   | `55432`                                         | PostgreSQL 宿主机映射端口 |

如果密码包含 URI 保留字符，必须在两个 URL 中进行百分号编码。

生产迁移：

```powershell
# Docker
docker compose run --rm app `
  node dist/server/server/infrastructure/db/migrate.js

# Podman
podman compose run --rm app `
  node dist/server/server/infrastructure/db/migrate.js
```

应用 Readiness 会检查 Drizzle 迁移记录集合是否与当前应用精确匹配。数据库可连接但迁移
缺失或多出记录时都不会就绪。

## 会话认证

| 变量                 | 要求                   |
| -------------------- | ---------------------- |
| `BETTER_AUTH_SECRET` | 至少 32 个字符的随机值 |

生成示例：

```powershell
@'
const { randomBytes } = require('node:crypto');
process.stdout.write(randomBytes(48).toString('base64url'));
'@ | node
```

当前账号流程使用邮箱与密码完成注册和登录。

## 地址加密

| 变量                                    | 示例                     |
| --------------------------------------- | ------------------------ |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` | `1`                      |
| `ADDRESS_ENCRYPTION_KEY_RING`           | `1:<base64-32-byte-key>` |

生成密钥：

```powershell
openssl rand -base64 32
```

密钥环格式：

```text
1:base64-key-one,2:base64-key-two
```

要求：

- 每个版本是大于零且唯一的整数；
- 每个 Base64 值解码后必须是 32 字节；
- Active 版本必须存在于密钥环；
- 轮换时先加入新版本并部署，再切换 Active 版本；
- 仍有旧密文时不得删除旧版本。

丢失密钥会导致地址和领取选项永久无法解密。密钥环必须纳入独立加密备份，但不得与
数据库备份存放在同一位置。

## B站 Provider

| 变量                     | 可选值               | 说明           |
| ------------------------ | -------------------- | -------------- |
| `BILIBILI_LIVE_SOURCE`   | `public-web`、`fake` | 直播消息来源   |
| `BILIBILI_ROSTER_SOURCE` | `public-web`、`fake` | 大航海名单来源 |

正常部署使用 `public-web`。`fake` 只用于自动测试和本地确定性场景。

主播资料读取与名单来源使用同一模式：`public-web` 会根据已验证 UID 查询 B站显示名称和
规范直播间，`fake` 提供测试资料。主播资料没有独立环境变量。

验证直播间不通过环境变量配置。平台管理员在“验证直播间”页面添加一个或多个固定房间，
并用优先级控制默认分配。

## 私有存储

| 变量                 | 当前值        | 说明                            |
| -------------------- | ------------- | ------------------------------- |
| `STORAGE_DRIVER`     | `local`       | 当前支持本地私有存储            |
| `STORAGE_LOCAL_PATH` | `./data/club` | 本地路径；容器内为 `/data/club` |

存储内容包括：

- gzip 压缩的名单原始分页证据；
- 礼物封面 WebP。

对象键保存于 PostgreSQL，但文件内容不应通过静态目录直接公开。Compose 使用
`club-storage` 卷保存 `/data/club`。

## 物流 Provider

| 变量                | 可选值         | 说明              |
| ------------------- | -------------- | ----------------- |
| `TRACKING_PROVIDER` | `none`、`fake` | 物流刷新 Provider |

`none` 保留主播录入的快递名称、运单号和公开查询链接，不主动刷新状态。`fake` 用于测试。
Provider 生成或用户输入的公开查询链接只接受 HTTP/HTTPS。

## Compose 专用变量

```dotenv
CLUB_IMAGE=ghcr.io/vtbs-infra/club:MAJOR.MINOR.PATCH
CLUB_PORT=3000
POSTGRES_HOST_PORT=55432
POSTGRES_PASSWORD=...
COMPOSE_DATABASE_URL=postgres://club:...@postgres:5432/club
```

`CLUB_IMAGE` 应使用精确版本 Tag 或 Digest。删除该变量后，开发者可以通过
`docker compose build app` 或 `podman compose build app` 构建当前检出的源码。

应用容器固定使用 `NODE_ENV=production`、`HOST=0.0.0.0`、
`STORAGE_DRIVER=local` 和 `/data/club`。

## 管理员引导

非交互式创建首个平台管理员时临时传入：

| 变量                  | 用途           |
| --------------------- | -------------- |
| `CLUB_ADMIN_PASSWORD` | 管理员初始密码 |

```powershell
# Docker
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  node dist/server/server/cli.js admin:create `
  --email admin@example.com `
  --name Admin

# Podman
podman compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  node dist/server/server/cli.js admin:create `
  --email admin@example.com `
  --name Admin
```

命令可安全地重复执行：已存在的同邮箱账号会被校准为平台管理员。

## 测试连接

PostgreSQL 集成测试必须设置 `TEST_DATABASE_URL`：

```powershell
$env:TEST_DATABASE_URL = 'postgres://club:password@localhost:55432/postgres'
pnpm test:integration
```

该账号需要创建和删除临时数据库的权限。测试套件不会把业务数据库作为 Fixture 库。
未设置该变量时，`pnpm test:integration` 会立即失败，不会把数据库测试标记为跳过。
