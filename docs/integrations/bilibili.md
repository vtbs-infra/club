# B站集成

Club 通过三个适配器边界连接 B站：

| 接口                   | 用途                             |
| ---------------------- | -------------------------------- |
| `LiveMessageSource`    | 接收验证直播间消息，证明用户 UID |
| `CreatorProfileSource` | 读取主播显示名称和规范直播间     |
| `GuardRosterSource`    | 获取主播月度大航海名单           |

生产配置使用 `public-web` 实现，测试使用 `fake` 实现：

```text
BILIBILI_LIVE_SOURCE=public-web
BILIBILI_ROSTER_SOURCE=public-web
```

公开 Web 接口可能随 B站调整而变化。Provider 原始结构只存在于适配器内部，业务模块
使用 Club 规范化后的类型。

## UID 验证

### 完整流程

1. 平台管理员配置并启用验证直播间。
2. 普通用户创建绑定挑战。
3. Club 返回一次性验证码和直播间链接。
4. 房间连接管理器保持该房间处于监听状态。
5. 用户使用需要绑定的 B站账号发送验证码。
6. 直播消息适配器输出消息内容和发送者 UID。
7. 绑定服务在一个事务中消费挑战并激活 UID 绑定。

验证结果以消息发送者为准。挑战请求体不接受用户提供的直播间 ID 或 UID。

### 直播消息连接

`PublicWebLiveMessageSource` 使用 `bilibili-live-danmaku` 0.7.16 完成：

- 短号与真实房间号解析；
- 弹幕服务器和 Token 获取；
- WebSocket 协议；
- 心跳；
- zlib 与 Brotli 消息解压；
- `DANMU_MSG` 事件解析。

依赖源码：
[`Minteea/bilibili-live-danmaku`](https://github.com/Minteea/bilibili-live-danmaku)

连接步骤：

```text
初始化匿名 Cookie
  -> 解析直播间
  -> 获取弹幕服务器与 Token
  -> 连接 wss://<host>/sub
  -> 认证
  -> 心跳与消息接收
```

适配器还会在房间被挑战使用期间轮询近期消息，并用稳定事件 ID 去重。这样可以处理出现
在直播间消息历史中、但匿名 WebSocket 未收到的消息。

匿名 Cookie 和当前房间 Token 只保存在进程内存。部署主机需要访问 B站 HTTPS 与
WebSocket 服务。

### 规范化消息

```json
{
  "eventId": "<Provider ID 或确定性 SHA-256>",
  "roomId": "<平台配置的直播间 ID>",
  "biliUid": "<正十进制 UID>",
  "biliDisplayName": "<显示名称或 null>",
  "message": "<消息文本>",
  "occurredAt": "<Date>"
}
```

字段来源：

- `DANMU_MSG.info[1]`：消息文本；
- `DANMU_MSG.info[2][0]`：发送者 UID。

缺失、为零、超出 JavaScript 安全整数范围或非数字的 UID 会被丢弃。

近期消息的时间必须晚于挑战创建时间。一秒容差用于处理不包含毫秒的 Provider
时间戳。

### 房间连接生命周期

`RoomConnectionManager` 为每个当前需要的房间维护一个连接：

- 创建挑战会增加房间需求；
- 挑战消费、取消或过期会减少房间需求；
- 短暂空闲宽限期避免相邻挑战反复重连；
- 连接关闭、认证失败和解码错误会更新房间健康状态；
- 重连使用有上限的指数退避；
- 进程启动时读取未过期挑战并恢复房间需求。

B站连接故障不会阻止 Fastify 提供 Liveness 接口。

## 主播资料

注册主播前，普通用户必须先通过直播间验证码建立有效 UID 绑定。平台把这个已验证 UID 交给
`CreatorProfileSource`，依次查询账号的直播间别名和直播间资料，并验证返回房间确实属于同一
UID。规范化结果只有三个字段：

```json
{
  "biliUid": "<已验证 UID>",
  "displayName": "<B站当前昵称>",
  "roomId": "<规范直播间 ID>"
}
```

没有可用直播间、UID 不一致、空昵称或非法标识都会使注册或刷新失败。平台不接受手填值
替代 Provider 结果。注册后，主播或平台管理员可以显式刷新昵称与直播间；刷新只更新未来
且尚未开始的名单任务，已经执行或定稿的任务继续保留创建时冻结的主播信息。

当 `BILIBILI_ROSTER_SOURCE=public-web` 时使用公开 Web 资料适配器；`fake` 模式使用确定性
测试资料源。

## 月度大航海名单

### Provider 请求

`PublicWebGuardRosterSource` 调用：

```text
/xlive/app-room/v2/guardTab/topListNew
```

请求使用匿名内存 Cookie，分页大小为 30。

响应元数据：

| 字段        | 含义                            |
| ----------- | ------------------------------- |
| `info.num`  | 声明的成员总数                  |
| `info.page` | 声明的分页总数                  |
| `info.now`  | 当前页码                        |
| `top3`      | Provider 在各页重复返回的前三名 |
| `list`      | 其余成员                        |

第一页把 `top3` 加入一次，再追加 `list`；后续页面只处理 `list`。

### 成员规范化

| Provider 字段       | Club 字段      |
| ------------------- | -------------- |
| `uinfo.uid`         | B站 UID        |
| `uinfo.base.name`   | 抓取时显示名称 |
| `uinfo.guard.level` | 大航海等级     |
| `rank`              | 排名           |

等级映射：

| 原始值 | Club 等级  |
| ------ | ---------- |
| `1`    | `GOVERNOR` |
| `2`    | `ADMIRAL`  |
| `3`    | `CAPTAIN`  |

出现其他等级值时，整次抓取不会通过一致性校验。

## 分页一致性

Provider 没有返回服务端快照时间或一致性 Token。Club 将一次名单任务定义为有时间上限
的完整抓取区间：

1. 获取第一页并读取声明总数与页数；
2. 使用有限并发获取全部声明分页；
3. 再次获取第一页；
4. 比较元数据和关键成员集合；
5. 规范化并验证完整成员列表。

以下情况会使尝试失败：

- 成员总数或分页总数变化；
- 复查第一页时关键成员发生变化；
- 缺页或页码顺序错误；
- UID 重复；
- 等级未知；
- 规范化成员数与声明总数不一致；
- 抓取超过 120 秒。

只有通过完整一致性检查的尝试可以进入名单定稿流程。

## 原始证据

每个 Provider 原始响应按以下顺序处理：

1. 对原始字节计算 SHA-256；
2. 使用 gzip 压缩；
3. 原子写入对象存储。

对象路径：

```text
private/snapshots/{runId}/{attemptId}/page-{page}.json.gz
```

PostgreSQL 保存：

- 对象键；
- SHA-256；
- 原始与压缩字节数；
- 成员数量；
- 抓取时间；
- Provider 分页元数据；
- 规范化候选成员；
- 定稿成员。

数据库和对象存储需要作为同一个备份集保存。

## 自动化测试

测试覆盖：

- 直播消息 Fixture 规范化；
- 近期消息时间与稳定事件 ID；
- 连接复用、失败隔离与重连；
- 挑战过期、重放、冲突、解绑和进程重启；
- 名单 Fixture 规范化；
- 主播资料与规范直播间解析；
- 分页漂移、一致性和超时；
- 名单定稿与证据不可变约束。

名单 Fixture：

```text
tests/fixtures/bilibili/guard-roster-page.json
```

CI 使用 `fake` Provider，不访问真实 B站服务。

## Provider 变更处理

当房间认证、响应字段、压缩方式或风控行为变化时：

1. 在适配器内更新解析与连接逻辑；
2. 更新脱敏 Fixture；
3. 运行单元测试和 PostgreSQL 集成测试；
4. 使用非敏感直播间完成连接与名单测试；
5. 检查存储证据 SHA-256 和规范化成员数；
6. 部署后观察验证房间与名单任务状态。

业务服务、数据库和前端 API 类型不应直接引用 Provider 原始响应结构。
