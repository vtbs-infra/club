# 部署与运维

本文说明如何用 Docker Compose 部署和维护一个 Club 实例。命令都在仓库根目录执行。

## 部署形态

一个 Club 部署由四部分组成：

- Club 应用容器：提供网页和 API，同时运行名单抓取、B站连接、封面清理等后台任务；
- PostgreSQL 17 数据库；
- 私有存储卷 `club-storage`：保存名单原始证据和礼物封面；
- 你自己的 HTTPS 反向代理。

只支持运行一个应用实例，因为后台任务和限流都在应用进程内。前提是单台机器足以承载月末名单
抓取和领取高峰。

另外需要：

- 能访问 B站 HTTPS 和 WebSocket 服务的网络；
- 一个给 Club 扫码登录的 B站读取账号，用来接收验证码消息、读取主播资料和大航海名单；
- 至少一个作为验证直播间的 B站直播间。

## 首次部署

### 1. 准备配置

```bash
cp .env.example .env
```

编辑 `.env`，至少替换下面这些值。每个密钥单独生成：

```bash
openssl rand -base64 32
```

| 变量                           | 填写                                              |
| ------------------------------ | ------------------------------------------------- |
| `APP_URL`                      | 用户访问的 HTTPS 地址                             |
| `TRUST_PROXY`                  | 位于反向代理之后时设为 `true`                     |
| `POSTGRES_PASSWORD`            | 随机数据库密码                                    |
| `COMPOSE_DATABASE_URL`         | `postgres://club:<数据库密码>@postgres:5432/club` |
| `AUTH_SECRET`                  | 一个随机密钥                                      |
| `ADDRESS_ENCRYPTION_KEY_RING`  | `1:<随机密钥>`                                    |
| `BILIBILI_CREDENTIAL_KEY_RING` | `1:<另一个随机密钥>`                              |

数据库密码含有 URI 保留字符时，在连接串里做百分号编码。`.env` 含有全部密钥，不要提交到
版本库，并按[备份与恢复](#备份与恢复)单独保管。

### 2. 准备镜像

部署正式版本时，把 `CLUB_IMAGE` 设为精确版本（例如 `ghcr.io/vtbs-infra/club:<版本号>`）：

```bash
docker compose pull app
```

从源码部署时，保留 `CLUB_IMAGE=club-app`：

```bash
docker compose build --pull app
```

记下实际使用的版本或镜像 Digest，升级、回滚和恢复都要用到。

### 3. 初始化数据库

```bash
docker compose up -d postgres
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
```

迁移可以重复执行，已经执行过的部分会跳过。

### 4. 创建平台管理员

```bash
docker compose run --rm app node dist/server/server/cli.js admin:create --username admin --name Admin
```

命令会在终端隐藏输入密码（8–128 个字符）。自动化部署时可以临时加上
`-e CLUB_ADMIN_PASSWORD=<密码>`。管理员不需要 B站 UID。

### 5. 启动并接入反向代理

```bash
docker compose up -d --no-build app
curl -fsS http://127.0.0.1:3000/health/ready
```

Compose 默认只在宿主机的 `127.0.0.1:3000` 开放应用端口，适合同一台机器上的反向代理。代理在
其他主机时，用 `CLUB_BIND_ADDRESS` 指定代理能访问到的地址，并限制访问来源。

生产模式的登录 Cookie 要求 HTTPS。让反向代理终止 TLS 并转发到应用端口，`APP_URL` 设为浏览器
实际访问的地址，`TRUST_PROXY=true`。修改 `.env` 后执行 `docker compose up -d app` 让配置生效。

### 6. 在后台完成配置

用管理员账号通过 HTTPS 地址登录，然后：

1. 在“B站集成”扫码登录读取账号，核对昵称和 UID 后点击“启用此账号”；
2. 在同一页面添加并启用验证直播间，等待连接显示健康；
3. 用一个与读取账号不同的 B站账号注册一次，确认识别到的 UID 正确；
4. 主播先注册普通账号，再由管理员在“主播”页面把该账号注册为主播。

具体操作见[使用指南](guide.md#平台管理员)。

## 配置参考

完整模板见 `.env.example`。

| 变量                                                                     | 说明                                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                                                                | 浏览器访问的根地址。必须与浏览器发出的 Origin 完全一致，包括协议和非默认端口，否则写请求会被拒绝（`CSRF_VALIDATION_FAILED`） |
| `TRUST_PROXY`                                                            | 应用只能通过可信反向代理访问时设为 `true`。应用能被直接访问时开启，客户端就能伪造来源地址                                    |
| `AUTH_SECRET`                                                            | 签名登录会话和验证凭据，至少 32 个字符。更换后所有登录和进行中的验证都会失效                                                 |
| `ADDRESS_ENCRYPTION_KEY_RING`、`ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION`   | 加密地址和领取信息的密钥环及其活动版本                                                                                       |
| `BILIBILI_CREDENTIAL_KEY_RING`、`BILIBILI_CREDENTIAL_ACTIVE_KEY_VERSION` | 加密 B站读取账号凭据的密钥环及其活动版本，必须与地址密钥不同                                                                 |
| `COMPOSE_DATABASE_URL`                                                   | 应用容器连接数据库的地址                                                                                                     |
| `DATABASE_URL`                                                           | 在宿主机上直接运行命令（开发、测试）时使用的数据库地址                                                                       |
| `POSTGRES_PASSWORD`                                                      | Compose 中 PostgreSQL 的密码                                                                                                 |
| `CLUB_IMAGE`                                                             | 应用镜像                                                                                                                     |
| `CLUB_BIND_ADDRESS`、`CLUB_PORT`                                         | 应用端口在宿主机上的绑定地址和端口，默认 `127.0.0.1:3000`                                                                    |
| `POSTGRES_HOST_PORT`                                                     | PostgreSQL 在宿主机回环地址上的端口，默认 `55432`                                                                            |
| `LOG_LEVEL`                                                              | 日志级别，默认 `info`                                                                                                        |

两套密钥环的格式都是 `1:<key>,2:<key>`：版本号是唯一的正整数，每个密钥是 base64 编码的 32 字节，
活动版本必须在密钥环里。

**丢失仍被引用的密钥，对应数据将永久无法解密**：地址和领取信息无法恢复，B站读取账号需要重新
扫码。密钥要与数据库备份分开保存。

## 日常检查

| 入口            | 含义                                                               |
| --------------- | ------------------------------------------------------------------ |
| `/health/live`  | 进程能响应请求                                                     |
| `/health/ready` | 数据库可用，迁移与当前版本完全一致，存储可读写，后台任务在正常运行 |
| 后台“系统”页    | 各后台任务的最近成功和错误、直播间连接、名单失败等                 |

还没有启用读取账号或验证直播间时，系统页显示“需要配置”，不影响 `/health/ready` 和管理员登录。

查看日志：

```bash
docker compose logs --tail 200 app
```

日志是结构化 JSON，会自动隐去密码、Cookie、验证码和地址等敏感信息。接口出错时的响应和页面
都带有请求 ID，用它在日志里定位对应的请求。

## 备份与恢复

一份可用的备份必须包含同一时间点的：

1. PostgreSQL 数据库；
2. `club-storage` 存储卷的全部内容；
3. `AUTH_SECRET` 和两套密钥环（单独加密保存）；
4. 当时运行的镜像版本或 Digest。

数据库只记录存储里文件的引用，两者必须来自同一时间点。

创建备份时先停止应用：

```bash
docker compose stop app
docker compose exec -T postgres pg_dump -U club -d club -Fc -f /tmp/club.dump
docker compose cp postgres:/tmp/club.dump ./club.dump
docker compose exec -T postgres pg_restore --list /tmp/club.dump > /dev/null
docker compose exec -T postgres rm /tmp/club.dump
# 用你的归档工具备份 club-storage 存储卷
docker compose start app
```

备份文件和密钥要保存到部署主机之外，并设置访问控制和保留周期。

恢复时使用全新的数据库和存储卷：

1. 准备与备份对应的 `.env` 和密钥，选用备份时的镜像版本；
2. 启动 PostgreSQL 并恢复数据库：

   ```bash
   docker compose up -d postgres
   docker compose cp ./club.dump postgres:/tmp/club.dump
   docker compose exec -T postgres pg_restore -U club -d club --no-owner /tmp/club.dump
   ```

3. 恢复 `club-storage` 存储卷；
4. 启动应用并检查 `/health/ready`；
5. 确认能登录、地址能解密、名单证据和礼物封面能打开、礼物单和发货信息完整。

定期在隔离环境演练一次恢复。

## 升级与回滚

1. 阅读目标版本的[更新记录](../CHANGELOG.md)，确认支持从当前版本升级；
2. 创建备份，记录当前镜像；
3. 把 `.env` 里的 `CLUB_IMAGE` 改为目标版本，然后执行：

```bash
docker compose pull app
docker compose stop app
docker compose run --rm --no-deps app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d --no-build --force-recreate app
curl -fsS http://127.0.0.1:3000/health/ready
```

从源码部署时，用 `docker compose build --pull app` 代替 `docker compose pull app`。

迁移器只接受与目标版本迁移记录一致的数据库，不一致时拒绝执行。不要手工修改迁移记录表。

回滚到旧镜像时，必须同时恢复升级前的数据库和存储备份，因为旧版本不能在新结构的数据库上运行。
B站已经轮换的登录凭据无法随备份回退，回滚后可能需要重新扫码。

## 密钥轮换

两套密钥环的轮换方式相同。以地址密钥为例：

1. 生成新密钥，加入密钥环并切换活动版本：

   ```text
   ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION=2
   ADDRESS_ENCRYPTION_KEY_RING=1:<旧密钥>,2:<新密钥>
   ```

2. 执行 `docker compose up -d app`；
3. 新建一个地址，再打开一条轮换前的地址或礼物单，确认都能读取。

新数据用新版本加密，旧数据继续用旧版本解密，不会批量重新加密。只要还有数据使用某个版本，
就不能把它从密钥环里删掉。

## 故障处理

### B站读取账号失效或不可达

“B站集成”页面分别显示账号状态和上游连接状态。显示“需要重新扫码”时，重新扫码并启用；
显示“暂时不可达”时，账号本身仍然有效，检查宿主机到 B站的网络。读取账号不可用期间，注册和
找回暂停，已有用户仍能正常登录。

### 验证直播间连接异常

检查直播间 ID、启用状态和最近连接时间。可以先停用异常的房间，启用另一个房间。连接测试通过
只代表鉴权成功；用不同的账号实际发一次验证码，才能确认能识别 UID。断线期间发送的验证码
不会被补收，用户需要在页面恢复后重新发送。

### 名单抓取失败

在“名单同步”页面查看任务和每次抓取：

- 自动任务只执行第一次抓取。失败或被拒绝的任务不会自动重试，由管理员检查原因后手动重试，
  每个任务最多三次；
- 计划时刻之后才完成的一致结果会进入“等待平台确认”，由管理员核对候选成员后批准或拒绝；
- “等待定稿”表示抓取已经成功，后台会自动重试定稿，不消耗抓取次数。长时间停留时检查
  数据库相关的错误日志；
- 出现证据完整性警告时，检查存储卷和对应的文件。

### 地址无法解密

通常是缺少某个版本的密钥。暂停领取和发货，从密钥备份恢复该版本并重启应用。不要修改或删除
原有的密文。

### 存储故障

检查 `club-storage` 卷的挂载、剩余空间和权限。存储恢复后，在系统页确认封面清理任务重新成功
运行。不要手工删除仍在使用的封面文件。

### 忘记密码

普通用户和主播在登录页点击“忘记用户名或密码？”自助找回，需要用注册时的 B站账号在验证直播间
发送验证码。平台管理员由服务器操作者重置：

```bash
docker compose run --rm app node dist/server/server/cli.js admin:reset-password --username admin
```

重置后该账号的所有登录都会失效。

## 容量

数据主要随每月的名单证据、礼物封面、礼物单和审计记录增长。监控数据库卷和存储卷的剩余空间。
名单证据、领取时冻结的信息和审计记录相互引用，不要单独清理。
