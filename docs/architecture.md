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
  -> gift cover cleanup runtime
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
    gifts/                      发布、资格、领取、查询、履约和封面生命周期
    fulfillment/                物流 Provider 与刷新 Runtime
    announcements/              平台和主播公告
    appearance/                 部署级主题读取、更新与审计
    portal/                     匿名公开礼物与公告查询
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

## 公开门户

匿名门户是当前 Club 部署的统一公开入口，不按主播创建独立站点。`PortalService` 只查询
已经发布、明确公开且仍在有效时间内的礼物和平台公告。公开状态是礼物发布与公告上的
独立字段，发布操作不会隐式将内容公开。

门户返回适合匿名展示的最小 DTO，不返回名单、资格、账号或领取信息。所有资格检查和
领取操作仍从登录后的角色工作台开始。

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
4. 响应提交后向 Binding Runtime 发出连接需求变化信号；
5. Runtime 合并并串行处理信号，监听仍有有效挑战的验证直播间；
6. 收到消息后按房间、摘要和有效期匹配挑战；
7. 在一个事务中消费挑战并创建 UID 绑定；
8. 事务成功后才确认该直播事件已消费。

一个用户和一个 B站 UID 同时只能有一个有效绑定。数据库瞬时错误不会消费消息，Runtime
可重新处理同一事件。查询挑战状态是纯读取：接口可以把已经越过有效期的 `ACTIVE`
挑战投影为 `EXPIRED`，持久状态由 Runtime 的维护周期统一收口。请求验证码和配置直播间
不会同步等待外部直播连接；周期协调也不会反复延长已经进入空闲宽限期的房间连接。

如果消息证明的 UID 已有有效绑定，服务会在消费挑战的同一事务中创建独立的
`binding_conflicts` 记录。记录冻结冲突发生时的挑战、UID 和原 Binding ID，并遵循
`OPEN → RESOLVED | DISMISSED`。管理员解决冲突时按顺序锁定冲突、记录中的原绑定和挑战；
只允许解除该原绑定，绝不按 UID 重新查找并操作后来的绑定。原绑定已经独立解除时，可以
安全地把冲突标记为已解决；驳回只关闭请求，不修改绑定。关闭后的冲突事实不可再次变更。

## 主播身份

主播不是一组手填的 B站字段。平台管理员只能从拥有有效 B站绑定的普通用户中注册主播；
注册流程通过 `CreatorProfileSource` 以已验证 UID 读取 B站显示名称和规范直播间，再在同一
事务中创建主播档案、关联该绑定并切换账号身份。

成为主播后，UID 绑定不能解除或替换。UID、显示名称和直播间属于 B站身份事实，只有显式
刷新资料时才从 Provider 更新；平台只维护名单结算时区和月度同步开关。关闭同步只取消或
阻止未来名单任务，不禁用主播账号，也不影响历史名单、礼物或该账号的普通用户功能。

## 月度名单

### 任务时刻

每个开启月度名单同步的主播每个自然月有一个 `snapshot_runs` 任务。计划时刻为主播配置
时区当月最后一天 `23:59:00`，准点窗口到下一分钟结束。

任务创建时冻结：

- 主播 ID；
- B站 UID；
- 直播间 ID；
- 资格月份；
- 截止时区；
- 计划时刻和准点窗口。

后续时区设置或 B站资料刷新只会更新尚未开始且仍允许变化的任务。

### 认领与尝试

自动 Tick 和管理员重试共享同一套事务认领约束，但拥有互斥的控制面：自动 Tick 只认领
`SCHEDULED` 并执行首次尝试；`FAILED` 和 `REJECTED` 只能由管理员显式重试。系统不会在
后台自动消耗剩余尝试次数。事务锁定任务并检查：

- 当前状态允许执行；
- 主播仍然开启月度名单同步；
- 没有另一个有效尝试；
- 尝试次数少于三次。

认领成功后先写入 `snapshot_attempts`，记录调度器或管理员发起来源，再异步执行 Provider
请求。同一 Tick 最多并发执行四个到期任务；一个主播的慢请求或失败不会阻止其他主播。
应用关闭时先禁止新抓取并取消所有活动请求，在数据库仍可用时将正常取消记录为明确的
失败，再等待任务全部结束；非正常终止遗留的 `RUNNING` 由下次启动恢复。

### 分页与证据

初次分页和一致性复查的每一份原始 JSON 都计算 SHA-256，gzip 压缩后写入私有对象存储。
PostgreSQL 仅保存：

- Attempt ID 与页码；
- 对象键；
- 内容哈希；
- 压缩与原始大小；
- 成员数和抓取时间。

第一页会在请求后续分页前校验页数、声明总数和响应大小上限。分页归一化成员先写入
Attempt 成员表。系统随后校验分页元数据、重复 UID、等级和首页复核；只有一致结果可以
定稿。

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

关闭发布在一个事务中阻止后续资格匹配，并把仍处于 `CLAIMABLE` 的礼物单推进到
`EXPIRED`。已经提交或进入履约流程的礼物单不被回退。

### 封面对象生命周期

封面文件先完成类型校验、解码、缩放和 WebP 转换，再建立持久对象记录：

```text
STAGED -> ACTIVE -> DELETE_PENDING -> 删除
```

`STAGED` 表示数据库已经记录、但尚未绑定草稿的对象；它可能尚未写入存储，也可能已经写入
并等待激活。只有草稿可以关联一张 `ACTIVE` 封面。替换、移除封面或删除草稿会在同一
数据库事务中把旧对象转为 `DELETE_PENDING`。清理 Runtime 在安全窗口后处理 `STAGED`，
也处理未被礼物引用的 `DELETE_PENDING`。对象不存在视为幂等成功，存储删除成功后才删除
数据库记录；存储失败会保留待处理记录供后续 Tick 重试。

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
在同一事务内直接进入 `SHIPPED`，状态历史只记录真实发生的转换。运单进度只包含
`LABEL_CREATED -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED`，只能前进；Provider
报告的物流异常是与进度正交的当前异常，恢复后清除异常但不会让进度回退。每次 Provider
事件仍作为不可变事实保存。

物流 Runtime 和系统诊断共用同一个到期筛选，只刷新仍处于 `SHIPPED` 且已到计划时间的
未送达运单。网络响应写回前会重新锁定并复核订单与运单，避免与人工操作竞争；确认送达后
在同一事务内推进订单到 `COMPLETED`。主播人工完成礼物单时会终止该运单的后续刷新并
清除当前异常。连续请求失败次数、最近错误和下次刷新时间保存在运单上。

履约导出以礼物发布为边界，在只读、可重复读事务中读取该主播当前所有 `SUBMITTED`
礼物单及其冻结地址、礼包快照和领取字段，事务结束后生成 XLSX。导出不创建批次、不占用
对象存储，也不推进订单；审计日志只记录礼物发布、行数、生成时间和文件哈希，不记录
明文个人信息。

## 公告与已读状态

平台公告和主播公告共享显式生命周期：

```text
DRAFT -> PUBLISHED -> WITHDRAWN
             ^           |
             +-----------+
```

只有从未发布的 `DRAFT` 可以删除；`DRAFT` 和 `WITHDRAWN` 可以编辑，`PUBLISHED` 也允许
在线更新内容但保持原发布时间。发布、重新发布、撤下和内容保存是独立命令，全部在事务内
递增版本并写入审计；重新发布会刷新发布时间并清除撤下时间。业务判断只依赖状态，时间字段
记录实际发生的发布与撤下事实，数据库约束和触发器共同阻止非法转换。

`announcement_reads` 记录用户实际读到的版本，而不是永久布尔值；公告内容更新或重新发布
后，旧版本的已读记录不会遮蔽新内容。接收范围由查询服务按账号和礼物单关系决定。

## Runtime 与健康状态

四个后台 Runtime 统一报告：

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
日志与状态。关闭时先停止创建新 Tick，再取消可取消的外部请求并等待所有已登记任务真正
结束，最后才释放数据库和存储；进程级 watchdog 只负责处理违反取消约定的异常情况。

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

持续增长的操作集合按领域使用稳定游标和摘要响应，包括礼物单、礼物发布、公告、名单任务、
名单成员、分页证据、主播、绑定冲突和审计日志。名单 Attempt 最多三条，作为详情中的硬上限
子集合直接返回；地址和验证直播间分别限制为最多 20 条，作为配置集合直接返回。用户候选
搜索固定最多返回 20 条。不同领域使用自己的不可变排序键，不共享通用分页框架。

公开的 `GET /api/v1/appearance` 返回当前部署使用的主题预设，无需登录。只有平台管理员
可以通过 `PUT /api/v1/admin/appearance` 更新该值；重复应用当前主题是无副作用操作。

## 数据域

| 领域       | 主要表                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| 认证       | `users`, `sessions`, `accounts`, `verifications`                                                               |
| 主播与绑定 | `creators`, `verification_rooms`, `binding_challenges`, `bilibili_bindings`, `binding_conflicts`               |
| 名单       | `snapshot_runs`, `snapshot_attempts`, `snapshot_pages`, `snapshot_attempt_members`, `snapshot_members`         |
| 礼物       | `gift_releases`, `gift_cover_objects`, `gift_packages`, `gift_package_items`, `gift_tier_rules`, `gift_orders` |
| 领取       | `gift_order_items`, `addresses`, `gift_order_addresses`, `gift_order_option_values`                            |
| 状态与物流 | `gift_order_status_history`, `shipments`, `tracking_events`                                                    |
| 公告与审计 | `announcements`, `announcement_reads`, `audit_logs`                                                            |
| 平台外观   | `platform_appearance`                                                                                          |

礼物发布和平台公告分别保存显式的 `public_visible` 标记。匿名门户只查询已发布、明确公开且
仍在有效期内的内容；发布操作本身不会隐式改变门户可见性。

Drizzle 定义位于 `src/server/infrastructure/db/schema/`，统一从 `index.ts` 导出。SQL
迁移位于 `migrations/`。当前版本以单一 fresh-install 迁移建立完整 Schema、单例数据和
数据库触发器；应用启动前必须完成迁移，Readiness 要求迁移集合与应用版本精确匹配。

## Web 架构

React Router 根据身份提供三个清晰区域。受保护页面按路由懒加载；TanStack Query 管理
服务端状态，页面本地状态只保存尚未提交的编辑内容。

`AppearanceProvider` 在路由外读取部署级主题，并把稳定的主题 ID 写到 `<html>`。全部页面、
Shell 和挂载到 `body` 的 Radix 浮层通过同一套语义设计令牌继承主题。读取失败时使用 Moe
默认主题，不阻塞公开页面或登录；管理员预览只存在于当前页面，显式应用成功后才持久化。

全局 Shell 负责导航、账号菜单和错误边界。对话框和菜单使用 Radix 无头原语，支持
Escape、焦点返回和 Tab 循环；视觉样式仍由语义化 CSS 提供，并按 token、基础、Shell、
主题覆盖、公开页面、认证页面、普通用户、管理工作区和响应式规则拆分。

## 部署边界

生产镜像分两阶段构建。运行层包含：

- Node.js 24；
- 生产依赖；
- `dist/` 编译产物；
- SQL 迁移；
- `LICENSE`。

`package.json` 是应用版本的唯一来源。运行镜像保留该文件，健康接口、管理员系统页和
OpenAPI 从同一版本值生成响应。正式镜像使用精确语义版本 Tag，并通过 OCI Revision 和
Digest 关联到 Git 提交。

迁移与管理员 CLI 都使用 `node dist/server/...` 编译入口。Docker 健康检查调用
`/health/ready`，容器停止宽限期为 15 秒。
