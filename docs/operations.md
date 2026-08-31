# 运维手册

本手册适用于长期运行的 Club 实例。首次安装见[开始使用](getting-started.md)，所有环境
变量见[配置参考](configuration.md)。

## 部署拓扑

一个 Club 部署包含：

- 一个 Club 应用实例；
- 一个 PostgreSQL 17 实例；
- 一个持久化对象存储目录；
- 面向公网时使用的 HTTPS 反向代理。

应用进程同时运行 B站房间连接、名单调度、物流刷新和礼物封面回收。保持一个活动应用实例。

Compose 数据卷：

| 数据卷          | 内容                   |
| --------------- | ---------------------- |
| `club-postgres` | PostgreSQL 数据目录    |
| `club-storage`  | 名单原始证据和礼物图片 |

## 日常检查

检查容器：

```powershell
docker compose ps
```

检查健康接口：

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

检查日志：

```powershell
docker compose logs --tail 200 app
docker compose logs --tail 100 postgres
```

平台管理员还应定期查看：

- `/admin/system` 中的数据库、存储和调度状态；
- `/admin/verification` 中的直播间健康状态；
- `/admin/rosters` 中的失败或等待确认任务；
- 待发货礼物单和到期领取任务。

## 健康接口

### `/health/live`

只检查 Fastify 进程能否响应，不依赖 PostgreSQL。适合作为容器 Liveness Probe。

### `/health/ready`

检查：

- PostgreSQL 查询和与当前应用精确匹配的迁移集合；
- 对象存储的隔离写入、读取和删除；
- B站绑定、名单调度、物流刷新和礼物封面回收 Runtime 已完成初始化且未长期停止 Tick。

任一技术检查失败时返回非 2xx。没有启用验证直播间属于业务 `NEEDS_SETUP`，管理员仍
可登录并完成首次配置。

### `/api/v1/admin/system`

需要平台管理员登录，返回：

- 应用版本；
- 数据库与存储状态；
- B站绑定、名单、物流和封面回收运行时状态、最近成功、最近错误与下次重试时间；
- 名单任务与运单状态计数；
- 验证直播间状态；
- 近期名单失败；
- 存储对象完整性警告。

## 日志

Club 使用 Pino 输出结构化日志。每个 HTTP 请求都有 `x-request-id`，错误响应体也包含
同一个请求 ID。

日志级别通过 `LOG_LEVEL` 配置。诊断单个请求时，使用请求 ID 搜索应用日志。

日志中不应记录：

- 密码与认证密钥；
- Session Cookie 和认证 Token；
- B站验证码；
- 收件人姓名、电话和详细地址；
- 地址加密密钥。

## 备份范围

一份可恢复备份必须同时包含：

1. PostgreSQL 自定义格式 Dump；
2. 完整的 `club-storage` 数据；
3. `BETTER_AUTH_SECRET`；
4. 完整的 `ADDRESS_ENCRYPTION_KEY_RING`；
5. 部署使用的 Git Revision 或镜像 Digest；
6. 数据库和存储归档的校验和。

数据库保存业务状态和对象引用，对象存储保存名单证据与图片，二者必须属于同一备份
时间点。

## 创建备份

在备份窗口中暂停应用写入：

```powershell
docker compose stop app
```

创建 PostgreSQL Dump：

```powershell
docker compose exec -T postgres pg_dump -U club -d club -Fc > club.dump
```

归档 `club-storage` 数据卷，然后重新启动应用：

```powershell
docker compose start app
```

归档工具和目标位置由部署环境决定。备份文件和密钥记录应保存到部署主机之外，并设置
访问控制和保留周期。

## 恢复演练

恢复演练使用隔离的新数据库和存储卷：

1. 配置备份对应的数据库密码、认证密钥和加密密钥环；
2. 启动 PostgreSQL；
3. 使用 `pg_restore` 恢复数据库；
4. 恢复匹配的对象存储归档；
5. 使用对应镜像的编译迁移入口应用后续迁移；
6. 启动一个 Club 应用实例；
7. 检查 `/health/ready`；
8. 验证登录、地址解密、名单证据、礼物单和发货记录。

恢复成功标准：

- 用户可以使用原账号登录；
- 地址和领取字段可以解密；
- 名单详情与原始证据对象一致；
- 礼物封面可以读取；
- 礼物单状态历史完整；
- 已录入的物流信息可见。

## 加密密钥轮换

生成新的 32 字节 base64 密钥，并使用新的整数版本：

```text
ADDRESS_ENCRYPTION_ACTIVE_KEY_VERSION=2
ADDRESS_ENCRYPTION_KEY_RING=1:<existing-key>,2:<new-key>
```

更新配置后重启应用：

```powershell
docker compose up -d app
```

新写入记录使用版本 2，已有记录继续通过版本 1 解密。数据库仍引用某个版本时，该版本
必须保留在运行配置和备份中。

轮换后执行：

1. 新建并读取一个地址；
2. 打开一条使用轮换前密钥版本的地址或礼物单；
3. 提交一条测试领取；
4. 检查应用日志中没有解密错误。

## 升级

只有目标版本 Changelog 明确列出的来源版本才支持原地升级。v0.2 使用新的单一数据库基线，
不提供从 v0.1 数据库原地升级的路径；部署 v0.2 时应创建空数据库和空存储卷，再按首次安装
流程初始化。不要通过手工修改 `drizzle.__drizzle_migrations` 绕过 Readiness。

升级前：

1. 阅读目标版本 Changelog；
2. 创建数据库与对象存储联合备份；
3. 记录当前镜像 Digest；
4. 检查目标迁移文件。

把 `.env` 中的 `CLUB_IMAGE` 更新为目标精确版本，拉取镜像并执行迁移：

```powershell
docker compose pull app
docker compose run --rm app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d --no-build --force-recreate app
```

升级后验证：

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

随后记录实际镜像 Digest，并检查管理员、主播和普通用户入口，验证直播间连接、近期名单
任务、物流和封面回收运行时。发布维护流程见[发布手册](releasing.md)。

回滚需要恢复与目标镜像 Schema 相匹配的 PostgreSQL 和对象存储备份。

## B站连接故障

检查：

- 宿主机到 B站 HTTPS 与 WebSocket 的连接；
- 直播间 ID 是否正确；
- 验证直播间是否启用；
- `/admin/verification` 中的最后连接时间；
- 应用日志中的请求与连接错误。

可以先停用异常房间，再启用另一个已配置房间。绑定运行时会重新计算未过期挑战需要
监听的房间。

## 名单抓取故障

在 `/admin/rosters` 查看任务和抓取尝试：

- 网络、Provider 状态或超时导致的失败由管理员显式重试；
- 一致的延迟结果可以批准或拒绝；
- 一致性失败需要重新抓取；
- 对象完整性警告需要检查存储和对应 SHA-256。

自动调度只执行计划任务的首次尝试，不会自动重试 `FAILED`。每个任务最多三次尝试；首次
失败后的重试跨过准点窗口时会按迟到名单处理。诊断期间保留任务、尝试、分页元数据和
存储对象。

## 地址解密故障

出现缺失密钥版本或认证标签错误时：

1. 暂停领取和发货操作；
2. 从错误上下文确认需要的密钥版本；
3. 从安全密钥记录恢复该版本；
4. 重启应用并验证解密；
5. 保留原密文。

## 存储故障

检查 `club-storage` 挂载、剩余空间和权限。健康检查会创建隔离临时对象，不会修改名单
证据。

对象哈希不匹配时，保留数据库记录和现有对象用于诊断，然后从同一备份集恢复对应
对象。

礼物封面的替换、移除或失败上传由封面回收 Runtime 重试清理。存储恢复后应在管理员系统
页确认该 Runtime 再次成功 Tick；不要手工删除仍被 `ACTIVE` 记录引用的对象。

## 容量管理

主要增长来源：

- 每月每位主播的 gzip 名单分页；
- 礼物封面；
- 礼物单、状态历史和物流事件；
- 审计日志。

监控 PostgreSQL 数据卷和对象存储数据卷的剩余空间。清理策略只能处理明确可删除的
业务数据；名单证据、冻结领取信息和审计记录需要保持引用完整。
