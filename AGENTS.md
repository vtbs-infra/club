# AGENTS.md

Club 是服务 B站主播和大航海成员的自托管礼物领取与发货平台：一个 TypeScript 模块化单体，
使用 Fastify、React 和 PostgreSQL。

## 取向

下面是做判断时的方向，不是规则：

- 复杂度要由真实、当前的需求来证明；
- 修根因而不是修症状，出现更简单的模型时敢于删除，包括刚写好的东西；
- 正确、清晰的模型比功能多更重要。

过去的决定只是背景，不是先例。依据当下的事实重新判断。

## 去哪里找答案

行为以代码和测试为准，文档只写代码里看不出来的东西。前后端共用的接口定义在
`src/shared/contracts/`，数据库结构在 `src/server/infrastructure/db/schema/`。

- [开发](docs/development.md)：本地启动、测试、数据库迁移和发布
- [部署与运维](docs/deploy.md)
- [使用指南](docs/guide.md)

## 常用命令

```bash
npm run check              # 格式、lint、类型和迁移一致性
npm test                   # 单元测试
npm run test:integration   # 需要 TEST_DATABASE_URL
```

改变行为时，同时更新受影响的文档。`CHANGELOG.md` 在发版时统一整理，平时不用逐个提交维护。
