# 配置参考

Club 从进程环境变量读取配置。本地命令会自动加载仓库根目录的 `.env`；Docker Compose
也使用同一文件进行变量替换。

## 应用与网络

| 变量          | 默认值                  | 说明                                                           |
| ------------- | ----------------------- | -------------------------------------------------------------- |
| `NODE_ENV`    | `development`           | `development`、`test` 或 `production`                          |
| `APP_URL`     | `http://localhost:3000` | 用户访问 Club 的完整公开来源地址                               |
| `HOST`        | `0.0.0.0`               | Fastify 监听地址                                               |
| `PORT`        | `3000`                  | 容器或本地 Fastify 端口                                        |
| `CLUB_PORT`   | `3000`                  | Compose 暴露到宿主机的端口                                     |
| `LOG_LEVEL`   | `info`                  | `fatal`、`error`、`warn`、`info`、`debug`、`trace` 或 `silent` |
| `TRUST_PROXY` | `false`                 | 是否信任反向代理传入的地址和协议头                             |

`APP_URL` 是认证回调与请求 Origin 校验基准。生产环境应使用最终 HTTPS 地址，例如：

```text
APP_URL=https://club.example.com
```

仅在受控反向代理后设置 `TRUST_PROXY=true`，并限制客户端绕过代理直接访问应用端口。

## PostgreSQL

| 变量                   | 默认值  | 说明                               |
| ---------------------- | ------- | ---------------------------------- |
| `POSTGRES_PASSWORD`    | 必填    | Compose 中 `club` 数据库用户的密码 |
| `POSTGRES_HOST_PORT`   | `55432` | PostgreSQL 暴露到宿主机的端口      |
| `DATABASE_URL`         | 必填    | 当前本地进程或命令使用的数据库 URL |
| `COMPOSE_DATABASE_URL` | 必填    | Club 容器使用的数据库 URL          |

本地进程通过宿主机端口连接：

```text
DATABASE_URL=postgres://club:<password>@localhost:55432/club
```

Compose 应用容器通过服务名和容器端口连接：

```text
COMPOSE_DATABASE_URL=postgres://club:<password>@postgres:5432/club
```

密码出现在 URL 中时，需要对 `@`、`:`、`/`、`?`、`#` 等保留字符进行 URL 编码。

## 认证

| 变量                 | 默认值 | 说明                                 |
| -------------------- | ------ | ------------------------------------ |
| `BETTER_AUTH_SECRET` | 必填   | Better Auth 签名密钥，至少 32 个字符 |

该密钥参与会话与认证数据处理。更换密钥会影响已有认证状态。备份与恢复时需要保存部署
使用的值。

## 地址与领取信息加密

| 变量                                    | 默认值       | 说明                                 |
| --------------------------------------- | ------------ | ------------------------------------ |
| `ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION` | `1`          | 新记录使用的密钥版本                 |
| `ADDRESS_ENCRYPTION_KEY_RING`           | 生产环境必填 | 逗号分隔的版本化 32 字节 base64 密钥 |

格式：

```text
ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION=2
ADDRESS_ENCRYPTION_KEY_RING=1:<key-one>,2:<key-two>
```

要求：

- 版本号是从 1 开始的正整数；
- 每个版本只出现一次；
- 每个 base64 值解码后正好为 32 字节；
- 活跃版本必须存在于密钥环；
- 数据库中仍有记录引用的版本必须继续保留。

生成密钥：

```powershell
[Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

轮换流程见[运维手册](operations.md#加密密钥轮换)。

## B站数据源

| 变量                     | 默认值       | 说明             |
| ------------------------ | ------------ | ---------------- |
| `BILIBILI_LIVE_SOURCE`   | `public-web` | 直播消息数据源   |
| `BILIBILI_ROSTER_SOURCE` | `public-web` | 大航海名单数据源 |

可选值：

- `public-web`：连接 B站公开 Web 接口；
- `fake`：测试环境使用的确定性实现。

生产实例使用 `public-web`。接口行为和故障模型见
[B站集成](integrations/bilibili.md)。

## 对象存储

| 变量                 | 默认值        | 说明                   |
| -------------------- | ------------- | ---------------------- |
| `STORAGE_DRIVER`     | `local`       | 存储驱动               |
| `STORAGE_LOCAL_PATH` | `./data/club` | 名单证据和礼物图片目录 |

Compose 将存储路径设置为 `/data/club`，并挂载 `club-storage` 数据卷。该目录与
PostgreSQL 共同构成完整业务数据。

## 物流

| 变量                | 默认值 | 说明              |
| ------------------- | ------ | ----------------- |
| `TRACKING_PROVIDER` | `none` | 物流查询 Provider |

可选值：

- `none`：保存主播录入的承运方、运单号和查询链接；
- `fake`：测试环境生成确定性物流事件。

物流运行时只会刷新配置了 Provider 且到达刷新时间的运单。

## 邮件

不设置 `SMTP_*` 时，邮件发送服务关闭。启用时需要完整配置：

| 变量            | 示例                          | 说明                     |
| --------------- | ----------------------------- | ------------------------ |
| `SMTP_HOST`     | `smtp.example.com`            | SMTP 主机                |
| `SMTP_PORT`     | `587`                         | SMTP 端口                |
| `SMTP_SECURE`   | `false`                       | 是否在连接建立时使用 TLS |
| `SMTP_USERNAME` | `club@example.com`            | 可选用户名               |
| `SMTP_PASSWORD` | `<password>`                  | 与用户名同时配置         |
| `SMTP_FROM`     | `Club <no-reply@example.com>` | 发件人                   |

只配置用户名或只配置密码会使应用拒绝启动。

## 一次性命令与测试

| 变量                  | 用途                                  |
| --------------------- | ------------------------------------- |
| `CLUB_ADMIN_PASSWORD` | 非交互式执行 `pnpm club admin:create` |
| `TEST_DATABASE_URL`   | PostgreSQL 集成测试使用的隔离数据库   |

示例：

```powershell
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/club_test'
pnpm test:integration
Remove-Item Env:TEST_DATABASE_URL
```

测试数据库应与日常开发数据库分开。

## Compose 配置示例

```text
APP_URL=http://localhost:3000
CLUB_PORT=3000
POSTGRES_HOST_PORT=55432
POSTGRES_PASSWORD=<random-password>
DATABASE_URL=postgres://club:<encoded-password>@localhost:55432/club
COMPOSE_DATABASE_URL=postgres://club:<encoded-password>@postgres:5432/club
BETTER_AUTH_SECRET=<random-secret>
ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION=1
ADDRESS_ENCRYPTION_KEY_RING=1:<base64-key>
BILIBILI_LIVE_SOURCE=public-web
BILIBILI_ROSTER_SOURCE=public-web
TRACKING_PROVIDER=none
LOG_LEVEL=info
TRUST_PROXY=false
```

以仓库中的 [.env.example](../.env.example) 为最终变量模板。
