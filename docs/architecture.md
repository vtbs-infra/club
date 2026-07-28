# 技术架构

Club 是一个 TypeScript 模块化单体。一个 Node.js 进程负责 HTTP、Web 静态资源和后台
任务，PostgreSQL 保存事务数据，本地对象存储保存大体积证据和礼物图片。

## 运行结构

```text
Browser
  |
  | HTTPS / JSON
  v
Fastify
  |-- Better Auth
  |-- TypeBox request schemas
  |-- domain services
  |-- Bilibili room connections
  |-- monthly roster scheduler
  |-- tracking refresh scheduler
  |-- React production assets
  |
  +--> PostgreSQL 17
  |
  +--> local object storage
  |
  +--> Bilibili public-web endpoints
```

支持的部署拓扑使用一个应用实例。直播间连接、名单调度和物流刷新都由该进程持有。

## 代码目录

```text
src/
  server/
    app.ts
    config/
    infrastructure/
    modules/
  shared/
  web/
    api/
    app/
    components/
    pages/
migrations/
tests/
  unit/
  integration/
  e2e/
```

`src/server/app.ts` 负责组装依赖、注册路由、启动后台运行时并设置统一错误处理。

服务端模块：

| 模块                 | 职责                             |
| -------------------- | -------------------------------- |
| `auth`               | Better Auth 配置和会话读取       |
| `creators`           | 账号身份、主播档案和管理员概览   |
| `verification-rooms` | 平台验证直播间配置与测试         |
| `binding`            | 一次性挑战、UID 绑定和房间需求   |
| `bilibili`           | 直播消息与名单 Provider 适配     |
| `snapshots`          | 月度任务、抓取尝试、证据和定稿   |
| `gifts`              | 礼物发布、图片、礼物单和状态流转 |
| `addresses`          | 地址加密和地址簿                 |
| `fulfillment`        | 物流 Provider 与刷新运行时       |
| `announcements`      | 平台与主播公告                   |
| `audit`              | 业务操作审计                     |
| `system-status`      | 健康检查与管理员系统状态         |

## 账号与授权

`users.role` 取值：

- `USER`
- `CREATOR`
- `PLATFORM_ADMIN`

公开注册由 Better Auth 创建 `USER`。平台管理员创建主播档案时，在一个数据库事务中
锁定目标用户、检查其身份、插入 `creators` 并更新账号身份。

主播路由通过登录会话解析 `creators.user_id`，将结果附加到当前请求。主播业务接口
使用该档案 ID 查询数据。

平台管理员接口使用独立的管理员守卫。普通用户接口以会话用户 ID 和当前活跃 UID
绑定为数据范围。

## UID 绑定

绑定过程由三个核心记录组成：

- `verification_rooms`：平台配置的验证房间；
- `binding_challenges`：短期一次性挑战；
- `bilibili_bindings`：账号与 B站 UID 的绑定历史。

挑战创建过程：

1. 选择一个已启用的验证房间；
2. 生成不易混淆的随机 ASCII 验证码；
3. 使用认证密钥计算验证码摘要；
4. 保存挑战的房间、摘要和过期时间；
5. 通知房间连接管理器保持监听。

消息到达后，绑定服务在事务中验证房间、消息时间、挑战状态、验证码摘要和 UID
唯一性。原始验证码不会写入数据库。

活跃绑定由 `unbound_at is null` 表示。解绑保留绑定记录并写入审计日志。

## 月度名单

`snapshot_runs` 表示一个主播在一个资格月份的名单任务。任务创建时冻结：

- `period_start`
- `cutoff_timezone`
- `scheduled_cutoff_at`
- `on_time_window_end_at`

计划时刻是主播时区当月最后一天 `23:59:00`。准时窗口到下一分钟结束，抓取开始时间
决定 `ON_TIME` 或 `LATE`。

一次抓取尝试写入：

- `snapshot_attempts`：状态、时间、Provider 元数据和失败原因；
- `snapshot_pages`：对象键、SHA-256、字节数、成员数和抓取时间；
- `snapshot_attempt_members`：通过校验的候选成员。

Provider 不提供原子快照令牌，因此适配器抓取全部分页后再次抓取第一页。总数、页数、
关键成员、等级、排序、UID 唯一性和最终数量必须保持一致。

定稿过程在一个事务中把候选成员写入 `snapshot_members` 并更新任务状态。准时且一致的
尝试自动定稿；延迟且一致的尝试等待平台管理员批准。

## 礼物发布与资格匹配

礼物发布由以下记录组成：

- `gift_releases`
- `gift_packages`
- `gift_package_items`
- `gift_tier_rules`

草稿保存完整发布定义。发布时服务会锁定发布记录，检查三种等级规则，更新状态，并
调用资格匹配。

资格匹配也会在名单定稿时调用。算法：

1. 查找同一主播、同一月份的 `PUBLISHED` 发布与 `FINALIZED` 名单；
2. 读取名单成员、礼包、项目和等级规则；
3. 为每个名单成员尝试插入 `gift_orders`；
4. 根据发放模式计算该成员获得的礼包；
5. 把礼包名称、说明、项目和数量复制到 `gift_order_items`。

`gift_orders.snapshot_member_id` 和唯一约束保证同一资格成员只生成一个礼物单。

礼物单创建时 `user_id` 为空，所有权依据是 `bili_uid`。普通用户的活跃绑定用于展示
对应礼物单。提交领取时才冻结平台账号。

## 领取与加密快照

用户提交礼物单时，服务在一个事务中：

1. 锁定礼物单并检查版本；
2. 验证状态与领取时间；
3. 验证账号的活跃 UID 绑定；
4. 校验发布定义中的领取字段；
5. 读取并解密用户选择的地址；
6. 创建独立的 `gift_order_addresses` 加密副本；
7. 加密写入 `gift_order_option_values`；
8. 设置 `user_id` 并进入 `SUBMITTED`；
9. 追加 `gift_order_status_history` 和审计记录。

地址和选项使用不同的加密用途字符串，避免密文跨记录或跨用途复用。

## 订单与发货

订单主状态流：

```text
CLAIMABLE -> SUBMITTED -> PROCESSING -> SHIPPED -> COMPLETED
```

终止分支：

```text
CLAIMABLE -> EXPIRED
SUBMITTED | PROCESSING -> CANCELLED
```

发货服务允许从 `SUBMITTED` 直接录入物流，并先追加隐含的 `PROCESSING` 记录。

一次发货创建：

- `shipments`
- 对应的 `shipment_items`
- 初始状态和下次查询时间

同一礼物项目只能进入一条有效发货记录。所有项目完成发货后，礼物单进入 `SHIPPED`。
Provider 返回的物流节点追加到 `tracking_events`；送达状态可以把礼物单推进为
`COMPLETED`。

## 公告

`announcements.scope` 为 `PLATFORM` 或 `CREATOR`。

平台公告面向已登录用户。主播公告的可见范围通过用户在该主播下的礼物单计算。公告
支持草稿、立即发布、严重级别、置顶、过期时间、乐观版本更新和已读记录。

`announcement_reads` 按用户和公告保存阅读状态。

## 后台运行时

### B站绑定

启动时读取未过期挑战，恢复房间需求。每个需要监听的房间由一个连接条目管理。挑战
创建和结束会增加或减少房间需求。

### 名单调度

启动时：

1. 清理超过一小时的临时存储对象；
2. 标记被进程中断的抓取尝试；
3. 预创建当前月和下一个月的任务；
4. 执行一次到期检查。

之后每 30 秒执行一次调度 Tick。同一进程内不会并发执行两个 Tick。

### 物流刷新

物流运行时查询到达 `next_tracking_refresh_at` 的运单，调用配置的 Provider，并追加
状态事件。

所有后台运行时在 Fastify 关闭时释放连接和定时器。

## 数据库结构

| 领域     | 表                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| 认证     | `users`, `sessions`, `accounts`, `verifications`                                                                   |
| 主播     | `creators`                                                                                                         |
| UID 验证 | `verification_rooms`, `binding_challenges`, `bilibili_bindings`                                                    |
| 名单     | `snapshot_runs`, `snapshot_attempts`, `snapshot_pages`, `snapshot_attempt_members`, `snapshot_members`             |
| 礼物定义 | `gift_releases`, `gift_packages`, `gift_package_items`, `gift_tier_rules`                                          |
| 礼物单   | `gift_orders`, `gift_order_items`, `gift_order_addresses`, `gift_order_option_values`, `gift_order_status_history` |
| 地址簿   | `addresses`                                                                                                        |
| 发货     | `shipments`, `shipment_items`, `tracking_events`                                                                   |
| 公告     | `announcements`, `announcement_reads`                                                                              |
| 控制     | `audit_logs`, `idempotency_records`                                                                                |

Drizzle 定义位于 `src/server/infrastructure/db/schema.ts`，SQL 迁移位于
`migrations/`。

数据库触发器保护：

- 审计日志和状态历史的追加语义；
- 完成的抓取尝试与已定稿名单；
- 已发布礼物内容；
- 冻结的账号、地址、选项和礼包快照；
- 礼物单状态与版本；
- 发货身份、项目归属和物流事件；
- 公告身份与版本；
- 已完成的幂等请求结果。

服务层负责给出业务错误；数据库约束负责阻止绕过服务层的非法写入。

## 对象存储

本地存储驱动使用临时文件加原子替换写入对象，并拒绝绝对路径和目录穿越。

名单分页对象路径：

```text
private/snapshots/{runId}/{attemptId}/page-{page}.json.gz
```

原始响应先计算 SHA-256，再使用 gzip 压缩。PostgreSQL 保存对象键和摘要，不保存完整
分页 JSON。

礼物封面通过专用上传服务校验 MIME、文件大小和图片内容，并使用专用读取接口返回。

## HTTP API

| 路径                      | 用途                   |
| ------------------------- | ---------------------- |
| `/api/auth/*`             | Better Auth            |
| `/api/v1/me/*`            | 普通用户个人数据与操作 |
| `/api/v1/creator/*`       | 主播工作台             |
| `/api/v1/admin/*`         | 平台管理               |
| `/api/v1/gift-releases/*` | 礼物封面读取           |
| `/health/live`            | 进程存活               |
| `/health/ready`           | PostgreSQL 与存储就绪  |
| `/openapi.json`           | OpenAPI 3.1            |

TypeBox Schema 同时用于运行时校验和 OpenAPI 生成。修改请求经过 Origin 校验与内存
限流。错误响应格式：

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Human-readable message",
    "requestId": "uuid"
  }
}
```

## Web 应用

React Router 根据身份组织三个区域：

```text
/dashboard, /gifts, /announcements, /account
/creator/*
/admin/*
```

`/app` 读取当前身份并跳转到对应入口。受保护布局在渲染前校验会话和身份。TanStack
Query 管理服务端状态，统一 API Client 处理 JSON、错误和请求凭据。

生产构建输出到 `dist/web`。Fastify 为静态资源设置长期缓存，为 HTML、API 和健康
接口设置独立缓存策略。

## 安全边界

- 状态修改请求校验 Origin；
- 登录态和业务接口按账号身份守卫；
- 地址与领取字段使用版本化 AES-256-GCM；
- 日志和审计查询递归脱敏；
- CSP、HSTS、`X-Frame-Options` 和内容类型保护由 Fastify 设置；
- 文件上传与存储键都在服务端校验；
- 备份需要同时包含 PostgreSQL、对象存储、认证密钥和完整加密密钥环。
