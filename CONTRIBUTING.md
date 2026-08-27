# 参与 Club 开发

感谢你参与 Club。提交改动前，请先阅读[开发指南](docs/development.md)和与改动相关的
[技术架构](docs/architecture.md)。

## 开发原则

- 从普通用户、主播或平台管理员的真实工作流出发，不从页面或数据表反推需求；
- 保持 TypeScript 模块化单体和单应用实例边界；
- 共享 TypeBox Schema 是服务端、OpenAPI 与浏览器类型的共同契约；
- 领域服务持有事务、审计、幂等和并发规则，HTTP 路由只处理协议边界；
- 修复数据模型或交互根因，删除已经失效的兼容路径；
- 不引入未被当前需求证明的扩展机制。

## 提交前检查

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
$env:TEST_DATABASE_URL = 'postgres://club:<password>@localhost:55432/postgres'
pnpm test:integration
pnpm test:browser
```

数据库变更必须包含新的迁移和 PostgreSQL 集成测试。界面工作流变更应在足够低的测试层级
证明业务规则，并在 Playwright 中覆盖用户意图、响应式布局或关键交互。

提交中不得包含 `.env`、真实账号数据、地址、Session Cookie、验证码、密钥、构建目录或
测试报告。使用简洁、可回滚的提交，每个提交只承载一个完整目的。

## Pull Request

Pull Request 应说明：

- 解决的用户问题；
- 最终行为和明确不包含的范围；
- 数据库、配置、部署或兼容性影响；
- 实际运行过的验证命令。

发布维护流程见[发布手册](docs/releasing.md)。
