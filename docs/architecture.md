# Club 技术架构

## 总览

Club 是一个 TypeScript 模块化单体：

```text
Browser
  -> Fastify HTTP
     -> Better Auth
     -> TypeBox routes
     -> domain workflow services
     -> Drizzle ORM -> PostgreSQL 17
     -> StorageDriver -> private local/object storage
     -> Bilibili and tracking providers

Application process
  -> binding runtime
  -> monthly snapshot runtime
  -> fulfillment runtime
```

同一 Node.js 进程提供 React 静态资源、JSON API、OpenAPI 和后台 Runtime。支持的部署
拓扑是一个应用实例与一个 PostgreSQL 数据库；这让名单任务认领、定时器所有权和关闭
语义保持直接。

## 目录边界

```text
src/server/
  app.ts                         依赖装配、路由注册、健康接口
  infrastructure/
    db/
      database.ts                数据库连接与迁移版本检查
      schema/                    按领域拆分的 Drizzle Schema
    encryption/                 AES-GCM 密钥环
    runtime/                    Runtime 状态与退避控制
    security/                   HTTP 防护、限流和日志脱敏
    storage/                    私有对象存储接口
  modules/
    auth/                       会话与身份守卫
    binding/                    验证码和 B站 UID 绑定
    snapshots/                  月末名单任务、证据、定稿和查询
    gifts/                      发布、资格、领取、查询和履约
    fulfillment/                物流 Provider 与刷新 Runtime
    announcements/              平台和主播公告
    audit/                      变更与敏感读取审计

src/shared/contracts/            TypeBox API 契约与静态类型
src/web/
  api/                           按领域拆分的浏览器 Client
  app/                           路由和 Query Client
  components/                    共享交互组件
  pages/                         用户、主播和管理员页面
  styles/                        token、基础、Shell、领域和响应式 CSS
```

HTTP 路由只负责会话守卫、Schema、参数转换和状态码。跨表写入事务由对应工作流服务
完整持有。

## 账号与权限

账号只有三个身份：

| 身份             | 入口         | 主要能力                               |
| ---------------- | ------------ | -------------------------------------- |
| `USER`           | `/dashboard` | 绑定 UID、查看公告、领取礼物、管理地址 |
| `CREATOR`        | `/creator`   | 发布礼物、查看名单、导出履约信息和发货 |
| `PLATFORM_ADMIN` | `/admin`     | 注册主播、配置验证房间、审查名单和系统 |

Better Auth 管理邮箱密码凭据和会话。`createRequireSession`、
`createRequireCreator` 与 `createRequirePlatformAdmin` 在路由边界执行角色检查；主播守卫
还会加载唯一主播档案。

## B站 UID 绑定

1. 用户请求验证码；
2. 服务选择优先级最高的已启用验证直播间；
3. 数据库只保留验证码摘要、有效期和挑战状态；
4. Binding Runtime 监听平台配置的直播间；
5. 收到消息后按房间、摘要和有效期匹配挑战；
6. 在一个事务中消费挑战并创建 UID 绑定；
7. 事务成功后才确认该直播事件已消费。

一个用户和一个 B站 UID 同时只能有一个有效绑定。数据库瞬时错误不会消费消息，Runtime
可重新处理同一事件。

## 月度名单

### 任务时刻

每个启用主播每个自然月有一个 `snapshot_runs` 任务。计划时刻为主播配置时区当月最后
一天 `23:59:00`，准点窗口到下一分钟结束。

任务创建时冻结：

- 主播 ID；
- B站 UID；
- 直播间 ID；
- 资格月份；
- 截止时区；
- 计划时刻和准点窗口。

后续主播配置只会更新尚未开始且仍允许变化的任务。

### 认领与尝试

自动 Tick 和管理员重试进入同一个认领入口。事务锁定任务并检查：

- 当前状态允许执行；
- 主播仍然启用；
- 没有另一个有效尝试；
- 尝试次数少于三次。

认领成功后先写入 `snapshot_attempts`，再异步执行 Provider 请求。同一 Tick 的到期任务
通过 `Promise.allSettled` 隔离启动；一个主播的慢请求或失败不会阻止其他主播。

### 分页与证据

每一页原始 JSON 计算 SHA-256 后 gzip 压缩并写入私有对象存储。PostgreSQL 仅保存：

- Attempt ID 与页码；
- 对象键；
- 内容哈希；
- 压缩与原始大小；
- 成员数和抓取时间。

分页归一化成员先写入 Attempt 成员表。系统校验页数、声明总数、重复 UID、等级和末页
复核；只有一致结果可以定稿。

### 定稿

- 准点且一致：自动写入不可变 `snapshot_members` 并定稿；
- 迟到且一致：进入 `PENDING_APPROVAL`；
- 不一致或 Provider 失败：记录稳定失败码并进入 `FAILED`；
- 管理员确认迟到结果后才写入定稿成员；
- 定稿事务触发礼物资格匹配。

定稿成员、接受的 Attempt、证据页和已定稿任务由数据库触发器阻止修改或删除。

## 礼物发布与资格

主播创建一份资格月份对应的草稿，配置：

- 礼物名称、说明和封面；
- 领取开始与截止时间；
- 一个或多个礼包及物品；
- 舰长、提督、总督对应的礼包；
- 可选领取字段。

发布请求携带当前完整表单和 `expectedVersion`。服务在一个事务中：

1. 锁定草稿并验证乐观版本；
2. 替换礼包、物品、等级规则和表单；
3. 校验领取窗口与索引；
4. 把发布状态改为 `PUBLISHED`；
5. 对同月已定稿名单执行资格匹配；
6. 写入审计日志。

名单后定稿时调用同一个匹配服务。`gift_release_id + snapshot_member_id` 和
`gift_release_id + bili_uid` 唯一约束保证每位成员只有一张礼物单。

## 领取与加密数据

地址簿中的完整地址以 AES-256-GCM 加密保存。密钥环由版本号和 Base64 32 字节密钥
组成，密文记录保存密钥版本、随机 IV 和认证标签。

领取事务：

1. 锁定礼物单并检查版本、状态和领取窗口；
2. 验证当前有效 UID 绑定与礼物单 UID 一致；
3. 校验所有自定义领取字段；
4. 解密用户选择的地址；
5. 创建独立加密的 `gift_order_addresses` 快照；
6. 加密保存领取选项；
7. 推进到 `SUBMITTED` 并写入状态历史与审计。

冻结地址只保留可选来源 ID，不依赖地址簿外键。地址簿记录可以修改或删除，历史订单仍
可由授权主播读取相同快照。

## 发货与物流

每张礼物单最多有一张 `shipments` 记录。

```text
CLAIMABLE -> SUBMITTED -> SHIPPED -> COMPLETED
     |            |
     -> EXPIRED    -> CANCELLED
```

`SUBMITTED` 同时是用户侧的“等待发货”和主播侧的“待发货”。主播创建运单时，礼物单
在同一事务内直接进入 `SHIPPED`，状态历史只记录真实发生的转换。物流 Runtime 只刷新
到期运单，幂等写入 Provider 事件；确认送达后推进对应订单到 `COMPLETED`。连续失败
次数、最近错误和下次刷新时间保存在运单上。

履约导出以礼物发布为边界，在只读、可重复读事务中读取该主播当前所有 `SUBMITTED`
礼物单及其冻结地址、礼包快照和领取字段，事务结束后生成 XLSX。导出不创建批次、不占用
对象存储，也不推进订单；审计日志只记录礼物发布、行数、生成时间和文件哈希，不记录
明文个人信息。

## Runtime 与健康状态

三个后台 Runtime 统一报告：

```text
state: STARTING | RUNNING | DEGRADED | STOPPED
startedAt
lastTickAt
lastSuccessAt
lastErrorAt
lastErrorCode
nextRetryAt
```

每个 Runtime 独立启动和重试。初始化失败不会阻止其他 Runtime，Tick 错误进入结构化
日志与状态。关闭时先停止创建新 Tick，再等待当前 Tick 的安全边界。

健康接口：

| 接口            | 语义                                              |
| --------------- | ------------------------------------------------- |
| `/health/live`  | HTTP 进程仍能响应                                 |
| `/health/ready` | 迁移版本、数据库、私有存储和关键 Runtime 已初始化 |
| 管理员系统页    | 额外区分 `READY`、`NEEDS_SETUP` 与 `DEGRADED`     |

没有启用的验证直播间属于 `NEEDS_SETUP`，不会阻止管理员登录并完成配置。

## API 契约

`src/shared/contracts` 的 TypeBox Schema 同时用于：

- Fastify 请求和响应验证；
- `/openapi.json`；
- `Static<typeof Schema>` 浏览器类型。

错误使用统一信封：

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Safe message",
    "requestId": "request-id"
  }
}
```

Web 以中文摘要作为主要反馈，同时允许展开错误码并复制请求 ID。

## 数据域

| 领域       | 主要表                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| 认证       | `users`, `sessions`, `accounts`, `verifications`                                                       |
| 主播与绑定 | `creators`, `verification_rooms`, `binding_challenges`, `bilibili_bindings`                            |
| 名单       | `snapshot_runs`, `snapshot_attempts`, `snapshot_pages`, `snapshot_attempt_members`, `snapshot_members` |
| 礼物       | `gift_releases`, `gift_packages`, `gift_package_items`, `gift_tier_rules`, `gift_orders`               |
| 领取       | `gift_order_items`, `addresses`, `gift_order_addresses`, `gift_order_option_values`                    |
| 状态与物流 | `gift_order_status_history`, `shipments`, `tracking_events`                                            |
| 公告与审计 | `announcements`, `announcement_reads`, `audit_logs`                                                    |

礼物发布和平台公告分别保存显式的 `public_visible` 标记。匿名门户只查询已发布、明确公开且
仍在有效期内的内容；发布操作本身不会隐式改变门户可见性。

Drizzle 定义位于 `src/server/infrastructure/db/schema/`，统一从 `index.ts` 导出。SQL
迁移位于 `migrations/`，应用启动前必须完成全部迁移。

## Web 架构

React Router 根据身份提供三个清晰区域。受保护页面按路由懒加载；TanStack Query 管理
服务端状态，页面本地状态只保存尚未提交的编辑内容。

全局 Shell 负责导航、账号菜单和错误边界。对话框和菜单使用 Radix 无头原语，支持
Escape、焦点返回和 Tab 循环；视觉样式仍由语义化 CSS 提供，并按 token、基础、Shell、
公开页面、普通用户、管理工作区和响应式规则拆分。

## 部署边界

生产镜像分两阶段构建。运行层包含：

- Node.js 24；
- 生产依赖；
- `dist/` 编译产物；
- SQL 迁移；
- `LICENSE`。

迁移与管理员 CLI 都使用 `node dist/server/...` 编译入口。Docker 健康检查调用
`/health/ready`，容器停止宽限期为 15 秒。
