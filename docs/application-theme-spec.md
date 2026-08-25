# Club 全局主题规格

> 状态：已确认，待实施
>
> 规格日期：2026-08-26

## 1. 目标

Club 提供四套由项目维护的全局主题预设。平台管理员选择并应用其中一套后，公开页面、
认证页面、普通用户工作台、主播工作台、平台管理后台以及浮层组件统一使用该主题。

主题只改变产品的视觉语言，不改变业务能力、信息架构、页面布局、交互流程或权限边界。
主题选择是独立的平台外观设置，不属于公开门户内容，也不进入未来的页面编辑器版本。

本规格交付以下完整能力：

- 平台管理员可以预览并应用四套固定主题；
- 所有访问者和账号身份共享当前已应用主题；
- 全应用组件通过同一套语义设计令牌响应主题；
- 主题设置能够持久化、审计并在重新部署后保持；
- 页面首次加载和主题读取失败时仍保持可用；
- 每套主题都满足桌面、窄屏、深浅色和无障碍要求。

## 2. 产品边界

### 2.1 应用范围

主题覆盖：

- `/` 公开首页；
- `/login` 与 `/register`；
- 404、全局错误、加载和空状态；
- `/dashboard`、`/gifts`、`/announcements` 与 `/account/*`；
- `/creator/*`；
- `/admin/*`；
- Radix Dialog、Dropdown Menu 及其他挂载到 `body` 的浮层；
- 桌面导航、移动导航和页脚；
- 浏览器 `theme-color` 与原生控件的 `color-scheme`。

主题不影响 JSON API、OpenAPI、健康接口、日志、导出文件、邮件或第三方页面。

### 2.2 选择权限

- 只有 `PLATFORM_ADMIN` 可以修改主题；
- 主题以整个 Club 部署为单位生效；
- 普通用户和主播不能选择个人主题；
- 不按主播、页面、账号或浏览器分别保存主题；
- 不根据操作系统浅色或深色偏好自动覆盖平台选择。

### 2.3 不在本期实现

- 自定义颜色、圆角、字体或阴影；
- 上传主题包、字体、背景或 CSS；
- 任意 CSS、JavaScript 或 HTML；
- 页面级或区块级主题覆盖；
- 定时切换、节日主题或随机主题；
- 主题市场、插件或第三方主题；
- 主题草稿、历史版本或恢复操作；
- 跨标签页、WebSocket、SSE 或轮询实时推送；
- 公开门户页面编辑器与内容版本管理。

## 3. 主题预设

主题 ID 是数据库和 API 的稳定值。显示名称可以调整，但 ID 的删除或重命名必须通过
显式数据迁移完成。

| ID        | 显示名称       | 色彩与气质                       | 排版与形状                       |
| --------- | -------------- | -------------------------------- | -------------------------------- |
| `moe`     | 超元气补给站   | 明亮蓝粉、柔和渐变、轻盈表面     | 当前产品基线，圆润但保持清晰     |
| `neon`    | 直播间控制台   | 深色底、紫青强调、克制的霓虹高光 | 中等圆角，重点元素使用有限发光   |
| `archive` | 舰长礼物档案馆 | 米色纸张、深蓝墨色、红金点缀     | 标题使用衬线气质，正文保持易读   |
| `pixel`   | 像素补给舰     | 深紫底、青粉强调、阶梯式阴影     | 直角结构，短标题与编号体现像素感 |

`moe` 是数据库、初始 HTML 和主题读取失败时的默认主题。它应延续当前 Club 的主要视觉，
使默认部署在引入主题能力后没有突兀变化。

### 3.1 共同视觉不变量

四套主题必须共享：

- 相同的 DOM 语义、内容顺序和路由；
- 相同的间距体系、响应式断点和信息密度；
- 相同的控件高度、触摸区域和焦点行为；
- 相同的状态含义和图标辅助表达；
- 相同的加载、错误、空状态和禁用逻辑；
- 相同的动效时长和 `prefers-reduced-motion` 行为。

主题可以改变：

- 页面背景、表面、边框和文本配色；
- 主色、辅助强调色和状态色的适配值；
- 标题字体栈；
- 圆角、阴影与边框风格；
- 公开首页等页面已有元素的纯 CSS 装饰。

主题不得改变：

- 页面布局、列数、排序或显隐；
- 按钮含义、状态名称或工作流；
- 表格、表单和导航的功能结构；
- 正文可读性和最小触摸区域；
- 用户可以执行的任何操作。

## 4. 管理员交互

### 4.1 入口

平台管理导航增加“主题”，路由为：

```text
/admin/appearance
```

页面标题为“主题与外观”。该入口只管理全局外观，不承载公开门户内容编辑。

### 4.2 页面内容

页面按以下顺序展示：

1. 当前已应用主题；
2. 四张主题预设卡片；
3. 每套主题的名称、说明、代表色和关键控件样例；
4. 预览状态提示；
5. “应用到整个应用”和“取消预览”操作。

预设选择使用原生 radio 与 fieldset 语义，不为这一交互增加新的 UI 依赖。

### 4.3 预览与应用

管理员选择预设后，`AppearanceProvider` 立即把它作为当前浏览器的本地预览主题。外观
管理页面自身的导航、按钮、表单、卡片、状态元素和浮层随之变化，数据库与其他客户端
保持不变。

```text
ACTIVE(applied)
    -> select
PREVIEWING(candidate)
    -> apply success -> ACTIVE(candidate)
    -> cancel        -> ACTIVE(applied)
    -> leave page    -> ACTIVE(applied)
    -> apply failure -> PREVIEWING(candidate) + error
```

交互规则：

- 选择卡片不调用更新接口；
- 预览期间明确提示“尚未应用到其他用户”；
- 候选主题等于已应用主题时，应用和取消操作不可用；
- “应用到整个应用”直接提交，不增加确认弹窗；
- 保存失败时保留候选预览并显示标准错误详情；
- 成功后更新全局已应用状态并清除预览状态；
- 取消或组件卸载时恢复已应用主题；
- 不增加离开页面拦截，未应用选择没有需要保护的数据；
- 不提供“恢复部署默认”，重新选择 `moe` 即可。

主题变化不主动推送给已打开的其他客户端。其他客户端在下一次完整页面加载后读取新主题。

## 5. 系统架构

```text
platform_appearance
        │
        ▼
AppearanceService
        │
        ├── GET /api/v1/appearance
        └── PUT /api/v1/admin/appearance
                    │
                    ▼
            AppearanceProvider
                    │
                    ▼
     <html data-app-theme="neon">
                    │
                    ▼
        全局语义设计令牌与组件样式
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
  公开/认证页    各角色工作台    Radix 浮层
```

### 5.1 代码边界

```text
src/shared/contracts/
  appearance.ts

src/server/infrastructure/db/schema/
  appearance.ts

src/server/modules/appearance/
  appearance-service.ts
  routes.ts

src/web/api/
  appearance.ts

src/web/theme/
  AppearanceProvider.tsx
  context.ts
  definitions.ts

src/web/pages/admin/
  AdminAppearancePage.tsx

src/web/styles/
  tokens.css
  themes.css
  base.css
  shell.css
  portal.css
  auth.css
  recipient.css
  management.css
  responsive.css
```

主题不会进入 portal、gifts、announcements、users 或 creators 模块。应用组装层只负责创建
服务并注册路由。

## 6. 共享契约与 API

### 6.1 TypeBox 契约

`src/shared/contracts/appearance.ts` 定义并导出：

```ts
export const THEME_PRESETS = ['moe', 'neon', 'archive', 'pixel'] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

export const ThemePresetSchema = Type.Union([
  Type.Literal('moe'),
  Type.Literal('neon'),
  Type.Literal('archive'),
  Type.Literal('pixel'),
]);

export const AppearanceSchema = Type.Object({
  themePreset: ThemePresetSchema,
});

export const UpdateAppearanceSchema = Type.Object({
  themePreset: ThemePresetSchema,
});
```

Schema 同时用于 Fastify 请求与响应验证、OpenAPI 和 Web 静态类型。Web 端主题元数据使用
`satisfies Record<ThemePreset, ThemeDefinition>` 保证四个预设都有名称、说明、代表色与
浏览器主题色。

### 6.2 公开读取

```http
GET /api/v1/appearance
```

响应：

```json
{
  "themePreset": "moe"
}
```

该接口无需登录，不返回操作者、时间戳或审计信息。它使用现有 API `no-store` 策略。

### 6.3 管理员更新

```http
PUT /api/v1/admin/appearance
Content-Type: application/json

{
  "themePreset": "pixel"
}
```

要求 `PLATFORM_ADMIN`。成功响应使用 `AppearanceSchema`。非法主题由 TypeBox 请求校验
拒绝；未登录和身份不匹配使用现有认证错误边界。

不增加管理员专用 GET。外观管理页使用全局 Provider 已读取的公开状态。

## 7. 数据模型与事务

新增单例表 `platform_appearance`：

| 列                   | 类型        | 约束                                |
| -------------------- | ----------- | ----------------------------------- |
| `id`                 | text        | 主键，固定为 `global`               |
| `theme_preset`       | text        | 非空，只允许四个 `ThemePreset`      |
| `updated_by_user_id` | uuid/null   | 引用 `users.id`，迁移种子行允许为空 |
| `created_at`         | timestamptz | 非空，默认当前时间                  |
| `updated_at`         | timestamptz | 非空，默认当前时间                  |

迁移必须：

- 创建主题合法值和单例 ID 检查约束；
- 插入 `id = 'global'`、`theme_preset = 'moe'` 的初始行；
- 可以在空数据库和已有数据库上安全执行；
- 更新 Drizzle Schema、导出和迁移快照。

`AppearanceService.update` 在一个事务内：

1. 使用 `FOR UPDATE` 读取单例行；
2. 单例行缺失时报告内部数据完整性错误；
3. 候选主题与当前主题相同时直接返回，不更新时间或审计；
4. 更新主题、操作者与时间；
5. 写入同事务审计记录。

审计动作使用稳定名称 `platform-appearance.updated`，目标类型为
`platform-appearance`，目标 ID 为 `global`，摘要只包含变更前后的主题 ID。

主题只有一个完全可逆的标量字段，因此不使用乐观版本。并发管理员更新通过行锁串行化，
最后一次明确应用生效。

没有删除、恢复或批量更新接口。

## 8. Web 主题运行时

### 8.1 Provider 状态

`AppearanceProvider` 位于 `QueryClientProvider` 内、`RouterProvider` 外，维护：

```text
appliedTheme     最近一次成功读取或应用的主题
previewTheme     管理员本地候选主题，可为空
renderedTheme    previewTheme ?? appliedTheme
loadError        公开外观读取错误，可为空
```

Provider 提供：

- `setPreviewTheme(theme)`；
- `cancelPreview()`；
- `acceptAppliedTheme(theme)`；
- 当前已应用主题、展示主题和读取错误。

管理员更新请求仍由 `src/web/api/appearance.ts` 与 TanStack Query mutation 管理；mutation
成功后更新 appearance Query，并调用 `acceptAppliedTheme`。

### 8.2 启动与失败语义

`src/web/index.html` 初始设置：

```html
<html lang="zh-CN" data-app-theme="moe"></html>
```

Provider 每个文档会话读取一次 `/api/v1/appearance`：

- 读取成功：更新 `appliedTheme`；
- 读取失败：保留 `moe`，应用继续可用；
- 外观管理页：显式展示读取错误；
- 其他页面：不以全局错误阻塞业务功能。

不使用 localStorage、Cookie、内联服务器配置或动态 HTML 注入。非默认主题在首次公开接口
返回后生效；不为消除这一短暂切换增加第二套缓存状态。

清除登录相关 Query Cache 时，不得把 Provider 已保存的 `appliedTheme` 重置为 `moe`。

### 8.3 文档副作用

当 `renderedTheme` 变化时，Provider 使用布局副作用：

1. 更新 `document.documentElement.dataset.appTheme`；
2. 更新 `<meta name="theme-color">`；
3. 不修改业务 DOM、文案或路由；
4. 不使用 `MutationObserver`；
5. 不在每个页面重复主题逻辑。

主题属性设置在 `<html>`，使挂载到 `body` 的 Radix Portal 自然继承变量。

## 9. CSS 与设计令牌

### 9.1 令牌分层

布局、交互和视觉令牌分为以下类别。

不会随主题改变：

- 内容宽度与阅读宽度；
- 控件高度和最小触摸区域；
- 响应式断点；
- 间距尺度；
- 动效时长与减少动效规则。

随主题改变：

- `--canvas`、`--surface`、`--surface-soft`、`--surface-muted`；
- `--ink`、`--ink-strong`、`--muted`、`--muted-strong`；
- `--line`、`--line-strong`；
- `--primary`、`--primary-hover`、`--primary-soft`、`--primary-border`；
- `--accent`、`--accent-soft`；
- success、warning、danger 和 info 的前景、背景、边框令牌；
- `--focus-ring`；
- `--radius-*` 与 `--shadow-*`；
- `--font-body` 与 `--font-display`；
- 浏览器 `color-scheme`。

现有 `--blue`、`--pink` 等承担交互语义的色相令牌必须改为用途名称。装饰性的冷暖色可以
保留为明确的 accent 令牌，但业务组件不能依赖“蓝色等于主操作”之类的假设。

### 9.2 文件职责和导入顺序

```css
@import './tokens.css';
@import './themes.css';
@import './base.css';
@import './shell.css';
@import './portal.css';
@import './auth.css';
@import './recipient.css';
@import './management.css';
@import './responsive.css';
```

- `tokens.css` 定义默认 Moe 令牌及主题不变量；
- `themes.css` 只定义其他主题的令牌覆盖；
- 基础、Shell 和领域 CSS 只消费语义令牌；
- `portal.css` 承载公开首页结构及有限主题装饰；
- `auth.css` 独立承载登录和注册页面；
- `responsive.css` 不按主题重复断点。

### 9.3 选择器约束

禁止在 `themes.css` 中逐个覆盖业务页面或组件：

```css
/* 禁止 */
html[data-app-theme='pixel'] .gift-order-card { ... }
html[data-app-theme='neon'] .admin-roster-row { ... }
```

基础组件必须消费令牌：

```css
.button.primary {
  background: var(--primary);
  color: var(--on-primary);
}
```

页面独有且不影响结构的装饰可以在该页面 CSS 内使用主题选择器：

```css
html[data-app-theme='archive'] .portal-hero::before { ... }
```

业务样式文件中的可见颜色原则上必须来自令牌。颜色字面量只允许出现在主题定义和明确
归属某个主题的装饰渐变中。不要为了执行该约束引入 Stylelint 或 CSS AST 依赖；提交前
通过源码检查和针对性 `rg` 审查。

### 9.4 组件和排版约束

- 所有主题保持至少 44px 的主要交互控件高度；
- Pixel 的直角风格不能缩小控件或压缩信息；
- Archive 的衬线字体只用于标题和展示文本；
- Pixel 的等宽字体只用于短标题、编号和标签；
- 表单正文、表格数据和长文本保持适合中文阅读的字体；
- Neon 的发光效果只用于重点动作、选中状态和有限装饰；
- 深色主题必须显式适配输入框、表格、弹窗、菜单、骨架屏和浏览器原生控件；
- 状态不能只依赖颜色表达，继续使用文字、图标和形状辅助。

## 10. 安全、性能和运维

- 主题 ID 是公开、非敏感配置；
- 更新接口继续使用现有会话、平台管理员守卫和 Origin 防护；
- 不接受用户提供的 CSS、HTML、脚本、字体 URL 或资源 URL；
- 四套主题 CSS 随主应用一次性构建，不按主题拆包；
- 启动只增加一个小型公开 JSON 请求；
- 主题读取不写审计；
- 主题更新写审计但不写业务状态历史；
- 主题设置不参与 readiness，读取失败不能阻止管理员进入系统修复其他配置；
- 已打开客户端不实时同步，避免常驻连接和轮询；
- 生产构建、迁移和 Docker 部署流程保持不变。

## 11. 无障碍与响应式验收

每套主题必须满足：

- 普通正文与背景达到 WCAG AA 对比度目标；
- 大号文本和非文本控件边界具有足够对比；
- `:focus-visible` 在所有表面上清晰可见；
- hover、focus、selected、disabled 和 destructive 状态可以区分；
- 原生 radio 主题选择支持键盘方向键和标签点击；
- Dialog 与 Dropdown 保持焦点管理、Escape 和返回焦点行为；
- 390px、800px 和桌面宽度保持现有核心操作能力；
- 主题不制造新的按钮换行、状态长条或水平溢出问题；
- 深色主题下图片、占位图和骨架屏不会产生突兀白块。

## 12. 测试规格

### 12.1 单元测试

- `ThemePresetSchema` 只接受四个稳定 ID；
- Web 主题定义通过穷尽 `Record` 覆盖全部 ID；
- Provider 的纯状态转换在需要提取纯函数时单独验证；
- 不为 CSS 颜色实现脆弱的文本快照或选择器镜像测试。

### 12.2 PostgreSQL 集成测试

新增 `tests/integration/appearance.test.ts`，证明：

- 迁移后默认主题为 `moe`；
- 匿名请求可以读取当前主题；
- 普通用户和主播不能更新；
- 平台管理员可以依次应用四个主题；
- 非法值由请求 Schema 拒绝；
- 主题在重新构建 App 后保持；
- 真实变化记录操作者和变更前后摘要；
- 重复提交相同主题不更新时间且不增加审计；
- 单例约束和合法值约束生效。

迁移测试同时验证空数据库安装和已有迁移升级。

### 12.3 浏览器工作流测试

新增 `tests/browser/appearance.spec.ts`。浏览器测试基础设施为所有页面提供稳定的默认
`{ themePreset: 'moe' }` Bootstrap 响应；主题专属场景可以覆盖该响应。

场景至少覆盖：

- 服务端返回非默认主题后 `<html>` 属性和 `theme-color` 正确；
- 选择卡片只进入本地预览，不发送 PUT；
- 取消预览恢复已应用主题；
- 离开外观页恢复未应用预览；
- 应用成功发送正确请求并保留新主题；
- 应用失败保留候选预览并显示标准错误；
- Neon 或 Pixel 下打开 Dropdown 和 Dialog 时颜色与文字可见；
- 390px 下主题管理页、移动导航和主要按钮不溢出。

不建立所有页面乘以所有主题的像素截图矩阵。浏览器测试证明状态与关键样式继承；最终
视觉验收覆盖代表页面。

### 12.4 代表页面矩阵

每套主题人工验收：

- 公开首页与登录页；
- 普通用户仪表盘和礼物详情；
- 主播礼物编辑和履约页面；
- 平台名单与系统页面；
- 空、加载、错误和禁用状态；
- Dropdown、Dialog、输入框、表格和状态标签；
- 390px、800px 与桌面宽度。

## 13. 实施路线

所有阶段直接构建最终结构，不保留旧变量别名、双主题路径、临时 Provider、页面级兼容
分支或页面编辑器占位代码。功能完成前不发布部分主题能力。

### 阶段一：语义设计令牌

- [ ] 确定最终令牌契约；
- [ ] 将承担语义的色相变量替换为用途变量；
- [ ] 将基础、Shell、用户和管理样式中的可见颜色收敛到令牌；
- [ ] 把公开首页与认证样式拆为 `portal.css` 和 `auth.css`；
- [ ] 保持默认 Moe 外观、布局和交互行为不变；
- [ ] 完成源码审查、`pnpm check`、单元测试和 Web 构建。

### 阶段二：平台外观领域

- [ ] 增加共享 TypeBox 契约；
- [ ] 增加 Drizzle Schema、SQL 迁移、约束和默认行；
- [ ] 实现 `AppearanceService` 的读取、更新、事务和审计；
- [ ] 注册公开读取与管理员更新路由；
- [ ] 验证 OpenAPI；
- [ ] 完成 PostgreSQL 集成与迁移测试。

### 阶段三：全局主题运行时

- [ ] 增加 Web API Client 与穷尽主题定义；
- [ ] 增加 `AppearanceProvider` 和预览状态；
- [ ] 设置初始 HTML、`data-app-theme`、`theme-color` 与 `color-scheme`；
- [ ] 完成 Moe、Neon、Archive 和 Pixel 令牌；
- [ ] 适配公共、认证、用户、主播、管理员与 Radix Portal；
- [ ] 删除遗留硬编码颜色和组件级主题特殊分支。

### 阶段四：管理员主题管理

- [ ] 增加 `/admin/appearance` 懒加载路由与导航；
- [ ] 实现当前主题、四套卡片和代表色；
- [ ] 实现本地整页预览、取消、卸载恢复和显式应用；
- [ ] 复用现有加载、错误和操作反馈组件；
- [ ] 完成主题管理浏览器测试。

### 阶段五：全应用验收与部署

- [ ] 按代表页面矩阵检查四套主题；
- [ ] 修复对比度、溢出、状态和浮层问题；
- [ ] 运行格式、Lint、TypeScript、单元、集成、构建和浏览器测试；
- [ ] 更新架构、产品指南与管理员文档，只描述最终行为；
- [ ] 构建 Docker 镜像、应用迁移并重新部署开发环境；
- [ ] 验证 readiness、公开主题和管理员应用流程。

## 14. 完成定义

只有同时满足以下条件，主题功能才算完成：

1. 四套主题可以由平台管理员预览并应用；
2. 主题覆盖所有应用页面和 Radix 浮层；
3. 默认 Moe 与当前产品的结构和可用性一致；
4. 主题变化不改变任何业务流程、状态或权限；
5. 数据库约束、持久化、权限和审计具有集成测试；
6. 预览、取消、应用成功和失败具有浏览器测试；
7. 四套主题通过代表页面、390px、800px 和桌面验收；
8. 没有任意 CSS、环境覆盖、个人主题、页面主题或主题版本系统；
9. 没有新 UI 库、编辑器依赖或运行时主题包；
10. 完整质量门与 Docker 开发部署通过。
