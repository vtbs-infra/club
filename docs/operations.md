# 运维手册

本手册适用于长期运行的 Club 实例。首次安装见[开始使用](getting-started.md)，所有环境
变量见[配置参考](configuration.md)。

## 部署拓扑

一个 Club 部署包含：

- 一个 Club 应用实例；
- 一个 PostgreSQL 17 实例；
- 一个持久化对象存储目录；
- 面向公网时使用的 HTTPS 反向代理。

应用进程同时运行 B站读取会话续期、房间连接、名单调度和礼物封面回收。保持一个活动应用实例。

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
- B站读取会话、身份验证、名单调度和礼物封面回收 Runtime 已完成初始化且未长期停止 Tick。

任一技术检查失败时返回非 2xx。未配置读取账号或没有启用验证直播间属于业务 `NEEDS_SETUP`，管理员仍
可登录并完成首次配置。

### `/api/v1/admin/system`

需要平台管理员登录，返回：

- 应用版本；
- 数据库与存储状态；
- B站身份验证、名单和封面回收运行时状态、最近成功、最近错误与下次重试时间；
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
- B站验证码、扫码上下文、Cookie、access token 和 refresh token；
- 收件人姓名、电话和详细地址；
- 地址加密密钥。

## 备份范围

一份可恢复备份必须同时包含：

1. PostgreSQL 自定义格式 Dump；
2. 完整的 `club-storage` 数据；
3. `AUTH_SECRET`；
4. 完整的 `ADDRESS_ENCRYPTION_KEY_RING`；
5. 部署使用的 Git Revision 或镜像 Digest；
6. 数据库和存储归档的校验和；
7. 完整的 `BILIBILI_CREDENTIAL_KEY_RING` 及活动版本（单独保管密钥备份）。

数据库保存业务状态和对象引用，对象存储保存名单证据与图片，二者必须属于同一备份
时间点。

## 创建备份

在备份窗口中暂停应用写入：

```powershell
docker compose stop app
```

创建 PostgreSQL Dump：

```powershell
docker compose exec -T postgres pg_dump -U club -d club -Fc -f /tmp/club.dump
docker compose cp postgres:/tmp/club.dump ./club.dump
docker compose exec -T postgres pg_restore --list /tmp/club.dump
docker compose exec -T postgres rm /tmp/club.dump
```

每条命令成功后再执行下一条；导出或复制失败时保留容器内文件供重试。Dump 在容器内生成，
通过 `compose cp` 按文件复制，不经过宿主 Shell 的二进制重定向。`pg_restore --list`
确认归档可解析，完整恢复仍需下面的恢复演练。

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
5. 使用与备份对应的镜像，确认迁移记录和哈希与该版本完全匹配；
6. 启动一个 Club 应用实例；
7. 检查 `/health/ready`；
8. 验证登录、地址解密、名单证据、礼物单和发货记录。

v0.2 的 Fresh Start 基线不提供 v0.1 或重构中间版本的数据升级；恢复旧备份时使用其对应镜像，
需要跨版本迁移时另行制定和验证方案。

恢复成功标准：

- 用户可以使用原账号登录；
- 地址和领取字段可以解密；
- 名单详情与原始证据对象一致；
- 礼物封面可以读取；
- 礼物单状态历史完整；
- 已录入的发货信息可见且可以复制单号。

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

当前用户名与 UID 认证基线不提供从旧版本（包括 v0.2.0）原地升级的路径，也不迁移旧
账号或密码摘要。先停止并归档旧部署，再创建空数据库和空存储卷，按首次安装流程初始化。
旧备份仅供使用其原版本独立恢复，不能导入新基线。不要手工修改
`drizzle.__drizzle_migrations` 绕过 Readiness。

已采用 `0000_username_uid_baseline` 的数据库可以执行后续追加迁移；迁移器要求现有记录
按顺序匹配目标应用清单的完整前缀，时间戳和 SQL 哈希都必须一致。以下原地升级步骤适用于
此基线内、Changelog 声明兼容的版本，不用于旧认证模型的基线切换。

升级前：

1. 阅读目标版本 Changelog；
2. 创建数据库与对象存储联合备份；
3. 记录当前镜像 Digest；
4. 检查目标迁移文件。

把 `.env` 中的 `CLUB_IMAGE` 更新为目标精确版本，拉取镜像并执行迁移：

```powershell
docker compose pull app
docker compose stop app
docker compose run --rm --no-deps app node dist/server/server/infrastructure/db/migrate.js
docker compose up -d --no-build --force-recreate app
```

升级后验证：

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

随后记录实际镜像 Digest，并检查管理员、主播和普通用户入口，验证直播间连接、近期名单
任务和封面回收运行时。发布维护流程见[发布手册](releasing.md)。

回滚需要恢复与目标镜像 Schema 相匹配的 PostgreSQL 和对象存储备份。

## B站读取账号升级与恢复

已经运行 `0000_username_uid_baseline` 的部署，需要应用 `0001_identity_challenge_capacity` 和
`0002_bilibili_managed_session` 中所有尚未执行的迁移，保留用户及业务数据。
升级前配置独立的 `BILIBILI_CREDENTIAL_KEY_RING` 与活动版本；先停止旧应用，再用目标镜像
迁移并启动。没有读取账号时基础 Readiness 应通过，管理员随后到“B站集成”扫码启用。

B站凭据密钥轮换遵循地址密钥相同的版本规则：先加入新版本、切换活动版本，保留仍被引用
的旧版本。登录、刷新写入新密文时使用活动版本；不会批量重写旧密文。
缺失旧密钥时后台会提示重新扫码，正常管理员登录仍可用。

启动后核验持久化凭据，再恢复常驻连接。若刷新结果已保存，恢复核验；若只留下结果不明的
刷新意图，租约到期后要求重新扫码，不重复使用旧 refresh token。
恢复数据库备份不能撤销 B站已经完成的 token 轮换；回滚到旧代码还必须恢复匹配的迁移历史，
并准备重新扫码。不要只替换镜像或手工修改迁移表。

## B站连接故障

检查：

- 宿主机到 B站 HTTPS 与 WebSocket 的连接；
- “B站集成”中的读取账号是否需要重新扫码、是否暂时不可达；
- 直播间 ID 是否正确；
- 验证直播间是否启用；
- `/admin/verification` 中的最后连接时间；
- 应用日志中的请求与连接错误。

可以先停用异常房间，再启用另一个已配置房间。身份验证运行时会重新计算未过期挑战需要
监听的房间。

## 名单抓取故障

在 `/admin/rosters` 查看任务和抓取尝试：

- 网络、Provider 状态或超时导致的失败由管理员显式重试；
- 一致的延迟结果可以批准或拒绝；
- `READY` 保留完整采集结果，后台会重试内部定稿；应检查数据库或资格处理错误，不要当作外部抓取失败；
- 一致性失败需要重新抓取；
- 对象完整性警告需要检查存储和对应 SHA-256。

自动调度只执行计划任务的首次尝试，不会自动重试 `FAILED`。`READY` 的内部重试不消耗抓取次数。每个任务最多三次抓取尝试；首次
失败后的重试跨过准点窗口时会按迟到名单处理。诊断期间保留任务、尝试、分页元数据和
存储对象。

如果数据库故障使失败结果未能保存，运行中的应用会在下一次成功 Tick 把已失去执行所有者的
`RUNNING` 标成 `FAILED / PROCESS_INTERRUPTED`，不需要为解除卡住状态重启应用。审批提示
批次变化时，应重新加载并审阅当前候选名单后再决定。

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
- 礼物单、状态历史和发货信息更正审计；
- 审计日志。

监控 PostgreSQL 数据卷和对象存储数据卷的剩余空间。清理策略只能处理明确可删除的
业务数据；名单证据、冻结领取信息和审计记录需要保持引用完整。

## 忘记密码

普通用户与主播通过 `/recover` 输入注册 UID，并在平台验证直播间发送一次性验证码，
验证后设置新密码；全部旧会话失效。先检查验证房间与 B站连接健康状态。

无 UID 的平台管理员由服务器操作者使用 `admin:reset-password --username admin` 重置，
CLI 隐藏输入密码。具体命令见[配置参考](configuration.md#管理员引导)。
