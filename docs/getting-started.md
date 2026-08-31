# 开始使用

本指南使用 Docker Compose 启动一个可用的 Club 实例，并完成首个平台管理员、B站验证
直播间和主播配置。

## 环境要求

- Docker Engine
- Docker Compose v2
- 可访问 B站 HTTPS 与 WebSocket 服务的网络
- 一个用于 UID 验证的 B站直播间

默认端口：

| 服务       | 地址                    |
| ---------- | ----------------------- |
| Club       | <http://localhost:3000> |
| PostgreSQL | `127.0.0.1:55432`       |

## 1. 准备配置

在仓库根目录复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

至少修改以下内容：

```text
APP_URL=http://localhost:3000
POSTGRES_PASSWORD=<随机数据库密码>
DATABASE_URL=postgres://club:<URL 编码后的密码>@localhost:55432/club
COMPOSE_DATABASE_URL=postgres://club:<URL 编码后的密码>@postgres:5432/club
BETTER_AUTH_SECRET=<不少于 32 个字符的随机密钥>
ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION=1
ADDRESS_ENCRYPTION_KEY_RING=1:<32 字节 base64 密钥>
```

可以在 PowerShell 7 中生成随机 base64 值：

```powershell
[Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

分别为 `BETTER_AUTH_SECRET` 和 `ADDRESS_ENCRYPTION_KEY_RING` 生成值。`.env`
包含数据库、认证和加密密钥，不应进入版本控制。

完整变量说明见[配置参考](configuration.md)。

`.env.example` 中的 `CLUB_IMAGE` 固定到当前发布版本。不要使用浮动 Tag 替代生产部署记录
中的精确版本或镜像 Digest。

## 2. 获取应用镜像并启动数据库

```powershell
docker compose pull app
docker compose up -d postgres
docker compose ps
```

等待 `postgres` 显示为 `healthy`。

从源码构建时，删除 `.env` 中的 `CLUB_IMAGE`，并用以下命令替代 `pull`：

```powershell
docker compose build app
```

## 3. 创建数据库结构

迁移需要显式执行：

```powershell
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
```

同一批迁移可以重复调用；已经记录的迁移不会再次执行。当前版本使用单一 fresh-install
基线，只能应用到空数据库；应用 Readiness 要求数据库迁移集合与运行版本精确一致。

## 4. 创建平台管理员

```powershell
docker compose run --rm -e CLUB_ADMIN_PASSWORD=replace-me app `
  node dist/server/server/cli.js admin:create --email admin@example.com --name Admin
```

密码至少 8 个字符。命令可以安全重复执行；已有同邮箱账号会被校准为平台管理员。

## 5. 启动 Club

```powershell
docker compose up -d --no-build app
docker compose ps
```

检查服务：

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

两个接口都应返回 `status: ok`。Readiness 还会列出数据库、迁移、私有存储和 Runtime
检查结果。

## 6. 配置验证直播间

使用平台控制的直播间完成普通用户 UID 验证：

1. 打开 `/admin/verification`。
2. 新建验证直播间。
3. 填写显示名称、直播间 ID 和优先级。
4. 启用直播间。
5. 点击连接测试并确认状态为健康。

多个直播间按优先级参与挑战分配。普通用户只会看到平台返回的直播间链接，不能自行
指定房间。

## 7. 配置主播

Club 从已经完成 B站验证的普通用户账号创建主播档案：

1. 退出管理员账号，打开 `/register`，注册用于主播工作台的普通用户账号。
2. 使用该账号登录，从账号菜单打开“B站绑定”。
3. 在平台指定的验证直播间发送一次性验证码，确认账号已绑定主播自己的 B站 UID。
4. 重新登录平台管理员账号，打开 `/admin/creators`。
5. 搜索并选择刚完成验证的普通用户。
6. 设置 IANA 结算时区，并决定是否开启未来的月末名单同步。
7. 提交后，Club 从 B站读取显示名称和规范直播间，并把该账号注册为主播。

主播 B站账号必须拥有可用直播间。B站 UID、显示名称和直播间不是平台自定义资料；注册
后可以从主播设置或管理后台显式刷新。

时区使用 IANA 名称，例如：

```text
Asia/Shanghai
Asia/Tokyo
America/Los_Angeles
```

开启名单同步后，任务会按主播时区计算每月最后一天 `23:59:00`。

## 8. 验证完整流程

用一个新的普通用户账号执行：

1. 登录后打开“B站绑定”。
2. 创建验证挑战。
3. 通过页面链接进入验证直播间。
4. 使用需要绑定的 B站账号发送页面显示的一次性验证码。
5. 返回 Club，确认 UID 已绑定。
6. 新建一个收货地址。

主播可以在 `/creator/releases` 创建一个测试礼物。礼物单需要同月已定稿名单才能
生成；名单任务与状态可在 `/admin/rosters` 查看。

## 9. 检查运行状态

```powershell
docker compose logs --tail 200 app
docker compose logs --tail 100 postgres
```

管理后台 `/admin/system` 展示数据库、存储、验证直播间、名单调度、物流刷新和礼物封面
回收状态。

## 下一步

- [文档总览](README.md)
- [产品使用指南](product-guide.md)
- [配置参考](configuration.md)
- [运维手册](operations.md)
