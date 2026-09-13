# Club 配置参考

Club 从进程环境变量读取配置。本地开发时 `src/server/config/load-local-env.ts` 会加载
仓库根目录的 `.env`；Docker Compose 同样读取 `.env` 并显式传入容器。

复制模板：

```powershell
Copy-Item .env.example .env
```

不要提交 `.env`。生产环境至少要替换数据库密码、认证密钥、地址加密密钥和 B站凭据加密密钥。

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
应用会拒绝写请求并返回 `CSRF_VALIDATION_FAILED`。

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
docker compose run --rm app `
  node dist/server/server/infrastructure/db/migrate.js
```

应用 Readiness 会检查 Drizzle 迁移记录集合是否与当前应用精确匹配。数据库可连接但迁移
缺失或多出记录时都不会就绪。

## 会话认证

| 变量          | 要求                   |
| ------------- | ---------------------- |
| `AUTH_SECRET` | 至少 32 个字符的随机值 |

生成示例：

```powershell
@'
const { randomBytes } = require('node:crypto');
process.stdout.write(randomBytes(48).toString('base64url'));
'@ | node
```

普通用户先完成 B站 UID 验证，再创建用户名和密码。用户名登录，会话固定有效 14 天。
改密、找回密码和管理员 CLI 重置会撤销该账号全部会话。认证不依赖邮箱或邮件服务，
详见[账号认证](authentication.md)。

生产模式的认证 Cookie 要求 HTTPS；通过代理终止 TLS 时需正确设置 `TRUST_PROXY`。
更换 `AUTH_SECRET` 会使现有 Cookie 和未完成的验证失效。

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

## B站读取账号

| 变量                                     | 示例                     |
| ---------------------------------------- | ------------------------ |
| `BILIBILI_CREDENTIAL_ACTIVE_KEY_VERSION` | `1`                      |
| `BILIBILI_CREDENTIAL_KEY_RING`           | `1:<base64-32-byte-key>` |

生产环境必须配置。格式和轮换规则与地址密钥环一致，但使用独立随机密钥；不得复用地址密钥。
凭据以 AES-256-GCM 加密存入 PostgreSQL，应用启动时检查登录状态。缺少仍被引用的旧密钥时，
账号会要求重新扫码；密钥环应单独加密备份。

管理员在 `/admin/verification` 的“B站集成”页面扫码并明确启用账号，然后维护验证直播间。
Cookie 和 token 不通过环境变量导入，也不返回浏览器。应用固定装配有登录态的公开 Web
适配器，不提供生产来源选择开关；测试在构造边界显式注入 Fake。

只向启用且已完成鉴权的房间分配挑战。读取账号有效性、网络可达性和房间连接状态分别展示。
完整协议和恢复边界见[B站集成](integrations/bilibili.md)。

## 私有存储

| 变量                 | 当前值        | 说明                            |
| -------------------- | ------------- | ------------------------------- |
| `STORAGE_LOCAL_PATH` | `./data/club` | 本地路径；容器内为 `/data/club` |

存储内容包括：

- gzip 压缩的名单原始分页证据；
- 礼物封面 WebP。

对象键保存于 PostgreSQL，但文件内容不应通过静态目录直接公开。Compose 使用
`club-storage` 卷保存 `/data/club`。

## Compose 专用变量

```dotenv
CLUB_IMAGE=ghcr.io/vtbs-infra/club:MAJOR.MINOR.PATCH
CLUB_PORT=3000
POSTGRES_HOST_PORT=55432
POSTGRES_PASSWORD=...
COMPOSE_DATABASE_URL=postgres://club:...@postgres:5432/club
```

正式镜像的 `CLUB_IMAGE` 应使用精确版本 Tag 或 Digest。当前未发布源码的模板使用
`CLUB_IMAGE=club-app`，通过 `docker compose build --pull app` 构建，不使用旧 v0.2.0 镜像。

应用容器固定使用 `NODE_ENV=production`、`HOST=0.0.0.0`、
私有本地存储路径 `/data/club`。

## 管理员引导

非交互式创建首个平台管理员时临时传入：

| 变量                  | 用途           |
| --------------------- | -------------- |
| `CLUB_ADMIN_PASSWORD` | 管理员初始密码 |

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-with-a-random-password app `
  node dist/server/server/cli.js admin:create `
  --username admin `
  --name Admin
```

该命令只创建新管理员。用户名已存在时返回 `ADMIN_ACCOUNT_ALREADY_EXISTS`，不修改已有账号、身份或密码。创建成功后移除临时密码变量。

不传 `CLUB_ADMIN_PASSWORD` 时会在交互终端隐藏输入并确认密码；密码必须为 12–128 个字符。
管理员忘记密码时，在服务器执行：

```powershell
docker compose run --rm app node dist/server/server/cli.js admin:reset-password --username admin
```

该命令只处理管理员账号，并撤销全部旧会话；普通用户通过 B站 UID 找回。

## 测试连接

PostgreSQL 集成测试与完整浏览器业务测试必须设置 `TEST_DATABASE_URL`：

```powershell
$env:TEST_DATABASE_URL = 'postgres://club:password@localhost:55432/postgres'
npm run test:integration
npm run test:e2e
```

该账号需要创建和删除临时数据库的权限。测试套件不会把业务数据库作为 Fixture 库。
未设置该变量时，`npm run test:integration` 会立即失败，不会把数据库测试标记为跳过。
