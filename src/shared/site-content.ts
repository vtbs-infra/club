import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const siteBlockTypes = [
  'hero',
  'user_tasks',
  'active_campaign',
  'image_text',
  'rich_text',
  'announcement_list',
  'process_steps',
  'image_banner',
  'card_group',
  'gallery',
  'cta',
  'divider',
] as const;

const AssetIdSchema = Type.String({
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
});

export const SiteActionSchema = Type.Object(
  {
    href: Type.String({ maxLength: 500, minLength: 1 }),
    label: Type.String({ maxLength: 80, minLength: 1 }),
  },
  { additionalProperties: false },
);

export const SiteBlockStyleSchema = Type.Object(
  {
    align: Type.Optional(Type.Union([Type.Literal('left'), Type.Literal('center')])),
    background: Type.Optional(
      Type.Union([Type.Literal('default'), Type.Literal('muted'), Type.Literal('accent')]),
    ),
    backgroundAssetId: Type.Optional(AssetIdSchema),
    backgroundPosition: Type.Optional(
      Type.Union([Type.Literal('top'), Type.Literal('center'), Type.Literal('bottom')]),
    ),
    maxWidth: Type.Optional(
      Type.Union([
        Type.Literal('narrow'),
        Type.Literal('normal'),
        Type.Literal('wide'),
        Type.Literal('full'),
      ]),
    ),
    overlay: Type.Optional(Type.Number({ maximum: 0.8, minimum: 0 })),
    padding: Type.Optional(
      Type.Union([Type.Literal('compact'), Type.Literal('normal'), Type.Literal('spacious')]),
    ),
    textTone: Type.Optional(
      Type.Union([Type.Literal('auto'), Type.Literal('light'), Type.Literal('dark')]),
    ),
  },
  { additionalProperties: false },
);

const commonBlockProperties = {
  audience: Type.Union([
    Type.Literal('all'),
    Type.Literal('anonymous'),
    Type.Literal('authenticated'),
  ]),
  enabled: Type.Boolean(),
  id: Type.String({ maxLength: 80, minLength: 1, pattern: '^[a-zA-Z0-9_-]+$' }),
  style: SiteBlockStyleSchema,
  themeVariant: Type.Union([
    Type.Literal('default'),
    Type.Literal('accent'),
    Type.Literal('subtle'),
  ]),
};

function block<TType extends (typeof siteBlockTypes)[number], TContent extends TSchema>(
  type: TType,
  content: TContent,
) {
  return Type.Object(
    {
      ...commonBlockProperties,
      content,
      type: Type.Literal(type),
    },
    { additionalProperties: false },
  );
}

const HeroBlockSchema = block(
  'hero',
  Type.Object(
    {
      avatarAssetId: Type.Optional(AssetIdSchema),
      backgroundDesktopAssetId: Type.Optional(AssetIdSchema),
      backgroundMobileAssetId: Type.Optional(AssetIdSchema),
      description: Type.String({ maxLength: 800 }),
      eyebrow: Type.String({ maxLength: 120 }),
      primaryAction: Type.Optional(SiteActionSchema),
      secondaryAction: Type.Optional(SiteActionSchema),
      title: Type.String({ maxLength: 160, minLength: 1 }),
    },
    { additionalProperties: false },
  ),
);

const UserTasksBlockSchema = block(
  'user_tasks',
  Type.Object({ title: Type.String({ maxLength: 120 }) }, { additionalProperties: false }),
);

const ActiveCampaignBlockSchema = block(
  'active_campaign',
  Type.Object(
    {
      emptyText: Type.String({ maxLength: 300 }),
      title: Type.String({ maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
);

const ImageTextBlockSchema = block(
  'image_text',
  Type.Object(
    {
      assetId: Type.Optional(AssetIdSchema),
      body: Type.String({ maxLength: 4_000 }),
      eyebrow: Type.String({ maxLength: 120 }),
      layout: Type.Union([Type.Literal('image-left'), Type.Literal('image-right')]),
      title: Type.String({ maxLength: 180 }),
    },
    { additionalProperties: false },
  ),
);

const RichTextBlockSchema = block(
  'rich_text',
  Type.Object(
    {
      actions: Type.Array(SiteActionSchema, { maxItems: 4 }),
      paragraphs: Type.Array(Type.String({ maxLength: 2_000 }), { maxItems: 20 }),
      title: Type.String({ maxLength: 180 }),
    },
    { additionalProperties: false },
  ),
);

const AnnouncementListBlockSchema = block(
  'announcement_list',
  Type.Object(
    {
      limit: Type.Integer({ maximum: 4, minimum: 2 }),
      title: Type.String({ maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
);

const ProcessStepsBlockSchema = block(
  'process_steps',
  Type.Object(
    {
      steps: Type.Array(
        Type.Object(
          {
            description: Type.String({ maxLength: 500 }),
            title: Type.String({ maxLength: 100 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 8, minItems: 2 },
      ),
      title: Type.String({ maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
);

const ImageBannerBlockSchema = block(
  'image_banner',
  Type.Object(
    {
      action: Type.Optional(SiteActionSchema),
      assetId: Type.Optional(AssetIdSchema),
      description: Type.String({ maxLength: 500 }),
      title: Type.String({ maxLength: 160 }),
    },
    { additionalProperties: false },
  ),
);

const CardGroupBlockSchema = block(
  'card_group',
  Type.Object(
    {
      cards: Type.Array(
        Type.Object(
          {
            description: Type.String({ maxLength: 500 }),
            href: Type.Optional(Type.String({ maxLength: 500 })),
            title: Type.String({ maxLength: 100 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 4, minItems: 2 },
      ),
      title: Type.String({ maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
);

const GalleryBlockSchema = block(
  'gallery',
  Type.Object(
    {
      items: Type.Array(
        Type.Object(
          {
            assetId: AssetIdSchema,
            caption: Type.String({ maxLength: 160 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 12 },
      ),
      title: Type.String({ maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
);

const CallToActionBlockSchema = block(
  'cta',
  Type.Object(
    {
      action: SiteActionSchema,
      description: Type.String({ maxLength: 500 }),
      secondaryAction: Type.Optional(SiteActionSchema),
      title: Type.String({ maxLength: 160 }),
    },
    { additionalProperties: false },
  ),
);

const DividerBlockSchema = block(
  'divider',
  Type.Object(
    { label: Type.Optional(Type.String({ maxLength: 80 })) },
    { additionalProperties: false },
  ),
);

export const SiteBlockSchema = Type.Union([
  HeroBlockSchema,
  UserTasksBlockSchema,
  ActiveCampaignBlockSchema,
  ImageTextBlockSchema,
  RichTextBlockSchema,
  AnnouncementListBlockSchema,
  ProcessStepsBlockSchema,
  ImageBannerBlockSchema,
  CardGroupBlockSchema,
  GalleryBlockSchema,
  CallToActionBlockSchema,
  DividerBlockSchema,
]);

export const SitePageContentSchema = Type.Object(
  {
    blocks: Type.Array(SiteBlockSchema, { maxItems: 40 }),
    schemaVersion: Type.Literal(1),
    site: Type.Object(
      {
        footerText: Type.String({ maxLength: 300 }),
        name: Type.String({ maxLength: 100, minLength: 1 }),
        tagline: Type.String({ maxLength: 200 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type SiteAction = Static<typeof SiteActionSchema>;
export type SiteBlock = Static<typeof SiteBlockSchema>;
export type SiteBlockStyle = Static<typeof SiteBlockStyleSchema>;
export type SiteBlockType = (typeof siteBlockTypes)[number];
export type SitePageContent = Static<typeof SitePageContentSchema>;

export interface SiteCampaignSummary {
  readonly claimDeadlineAt: string;
  readonly claimStartAt: string;
  readonly coverImageUrl: string | null;
  readonly creatorName: string;
  readonly description: string;
  readonly eligibilityMonth: string;
  readonly id: string;
  readonly title: string;
}

export interface SiteAnnouncementSummary {
  readonly body: string;
  readonly id: string;
  readonly pinned: boolean;
  readonly publishedAt: string;
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL';
  readonly title: string;
}

export interface SiteUserSummary {
  readonly addressReady: boolean;
  readonly binding: { readonly displayName: string | null; readonly maskedUid: string } | null;
  readonly latestDelivery: {
    readonly orderId: string;
    readonly status: string;
    readonly title: string;
  } | null;
  readonly pendingGift: {
    readonly claimDeadlineAt: string;
    readonly orderId: string;
    readonly title: string;
  } | null;
}

export interface SiteHomeResponse {
  readonly announcements: readonly SiteAnnouncementSummary[];
  readonly campaigns: readonly SiteCampaignSummary[];
  readonly content: SitePageContent;
  readonly user: SiteUserSummary | null;
}

export interface SitePageVersionSummary {
  readonly createdAt: string;
  readonly createdByUserId: string;
  readonly id: string;
  readonly publishedAt: string | null;
  readonly version: number;
}

export interface SiteAdminState {
  readonly draft: {
    readonly content: SitePageContent;
    readonly id: string | null;
    readonly version: number;
  };
  readonly published: {
    readonly content: SitePageContent;
    readonly id: string | null;
    readonly version: number;
  };
  readonly versions: readonly SitePageVersionSummary[];
}

export interface SiteAsset {
  readonly createdAt: string;
  readonly filename: string;
  readonly height: number;
  readonly id: string;
  readonly mimeType: 'image/webp';
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly thumbnailUrl: string;
  readonly url: string;
  readonly width: number;
}

function isSafeHref(href: string): boolean {
  if (href.startsWith('/') || href.startsWith('#')) return !href.startsWith('//');
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function actionsFor(blockValue: SiteBlock): readonly SiteAction[] {
  switch (blockValue.type) {
    case 'hero':
      return [blockValue.content.primaryAction, blockValue.content.secondaryAction].filter(
        (action): action is SiteAction => action !== undefined,
      );
    case 'rich_text':
      return blockValue.content.actions;
    case 'image_banner':
      return blockValue.content.action ? [blockValue.content.action] : [];
    case 'cta':
      return [blockValue.content.action, blockValue.content.secondaryAction].filter(
        (action): action is SiteAction => action !== undefined,
      );
    case 'card_group':
      return blockValue.content.cards
        .filter((card) => card.href !== undefined)
        .map((card) => ({ href: card.href!, label: card.title }));
    default:
      return [];
  }
}

export function isSitePageContent(value: unknown): value is SitePageContent {
  if (!Value.Check(SitePageContentSchema, value)) return false;
  const identifiers = new Set<string>();
  for (const currentBlock of value.blocks) {
    if (identifiers.has(currentBlock.id)) return false;
    identifiers.add(currentBlock.id);
    if (!actionsFor(currentBlock).every((action) => isSafeHref(action.href))) return false;
  }
  return true;
}

export function assertSitePageContent(value: unknown): asserts value is SitePageContent {
  if (!isSitePageContent(value)) {
    throw new TypeError('Invalid or unsafe homepage content.');
  }
}

export const defaultSitePageContent: SitePageContent = {
  blocks: [
    {
      audience: 'all',
      content: {
        description: '确认舰长礼物资格、提交收货信息，并随时查看礼物发放进度。',
        eyebrow: '舰长礼物计划',
        primaryAction: { href: '/app', label: '查看我的礼物' },
        secondaryAction: { href: '#claim-process', label: '了解领取流程' },
        title: '欢迎来到舰长礼物站',
      },
      enabled: true,
      id: 'home-hero',
      style: {
        align: 'left',
        background: 'accent',
        backgroundPosition: 'center',
        maxWidth: 'wide',
        overlay: 0.36,
        padding: 'spacious',
        textTone: 'light',
      },
      themeVariant: 'accent',
      type: 'hero',
    },
    {
      audience: 'authenticated',
      content: { title: '我的当前任务' },
      enabled: true,
      id: 'home-user-tasks',
      style: { maxWidth: 'wide', padding: 'normal' },
      themeVariant: 'default',
      type: 'user_tasks',
    },
    {
      audience: 'anonymous',
      content: {
        actions: [
          { href: '/register', label: '注册账号' },
          { href: '/login', label: '登录' },
        ],
        paragraphs: ['注册账号 → 绑定 UID → 获得资格 → 填写地址 → 等待礼物'],
        title: '加入礼物计划',
      },
      enabled: true,
      id: 'home-anonymous-flow',
      style: { align: 'center', background: 'muted', maxWidth: 'wide', padding: 'normal' },
      themeVariant: 'subtle',
      type: 'rich_text',
    },
    {
      audience: 'all',
      content: { emptyText: '新的礼物活动准备好后会在这里出现。', title: '当前礼物活动' },
      enabled: true,
      id: 'home-active-campaign',
      style: { maxWidth: 'wide', padding: 'normal' },
      themeVariant: 'default',
      type: 'active_campaign',
    },
    {
      audience: 'all',
      content: {
        body: '每个月，我们都会根据舰长名单，为符合资格的舰长准备限定礼物。希望这些小小的心意，可以成为我们共同回忆的一部分。',
        eyebrow: '关于礼物计划',
        layout: 'image-left',
        title: '感谢每一次陪伴',
      },
      enabled: true,
      id: 'home-about',
      style: { background: 'muted', maxWidth: 'wide', padding: 'spacious' },
      themeVariant: 'subtle',
      type: 'image_text',
    },
    {
      audience: 'all',
      content: {
        steps: [
          { description: '在指定直播间发送一次性验证码。', title: '绑定 UID' },
          { description: '系统自动匹配已发布的舰长记录。', title: '确认资格' },
          { description: '选择地址并填写礼物选项。', title: '提交领取' },
          { description: '在站内随时查看物流进度。', title: '等待发货' },
        ],
        title: '礼物领取流程',
      },
      enabled: true,
      id: 'claim-process',
      style: { maxWidth: 'wide', padding: 'spacious' },
      themeVariant: 'default',
      type: 'process_steps',
    },
    {
      audience: 'all',
      content: { limit: 4, title: '最新公告' },
      enabled: true,
      id: 'home-announcements',
      style: { background: 'muted', maxWidth: 'wide', padding: 'normal' },
      themeVariant: 'subtle',
      type: 'announcement_list',
    },
    {
      audience: 'anonymous',
      content: {
        action: { href: '/register', label: '立即加入' },
        description: '登录后查看属于你的礼物与配送进度。',
        secondaryAction: { href: '/login', label: '已有账号' },
        title: '准备好领取礼物了吗？',
      },
      enabled: true,
      id: 'home-cta',
      style: { align: 'center', background: 'accent', maxWidth: 'wide', padding: 'spacious' },
      themeVariant: 'accent',
      type: 'cta',
    },
  ],
  schemaVersion: 1,
  site: {
    footerText: '由 Club 提供技术支持',
    name: '舰长礼物站',
    tagline: '主播品牌展示、粉丝礼物领取和进度查询的统一入口',
  },
};

export function createDefaultBlock(type: SiteBlockType, id: string): SiteBlock {
  const common = {
    audience: 'all' as const,
    enabled: true,
    id,
    style: { maxWidth: 'wide' as const, padding: 'normal' as const },
    themeVariant: 'default' as const,
  };
  switch (type) {
    case 'hero':
      return {
        ...common,
        content: { description: '填写副标题', eyebrow: '礼物计划', title: '填写主标题' },
        type,
      };
    case 'user_tasks':
      return { ...common, audience: 'authenticated', content: { title: '我的当前任务' }, type };
    case 'active_campaign':
      return {
        ...common,
        content: { emptyText: '暂无进行中的活动。', title: '当前礼物活动' },
        type,
      };
    case 'image_text':
      return {
        ...common,
        content: {
          body: '填写图文内容',
          eyebrow: '介绍',
          layout: 'image-left',
          title: '图文标题',
        },
        type,
      };
    case 'rich_text':
      return {
        ...common,
        content: { actions: [], paragraphs: ['填写正文内容'], title: '正文标题' },
        type,
      };
    case 'announcement_list':
      return { ...common, content: { limit: 4, title: '最新公告' }, type };
    case 'process_steps':
      return {
        ...common,
        content: {
          steps: [
            { description: '填写步骤说明', title: '第一步' },
            { description: '填写步骤说明', title: '第二步' },
          ],
          title: '流程说明',
        },
        type,
      };
    case 'image_banner':
      return {
        ...common,
        content: { description: '填写横幅说明', title: '横幅标题' },
        type,
      };
    case 'card_group':
      return {
        ...common,
        content: {
          cards: [
            { description: '填写卡片说明', title: '卡片一' },
            { description: '填写卡片说明', title: '卡片二' },
          ],
          title: '卡片分组',
        },
        type,
      };
    case 'gallery':
      return { ...common, content: { items: [], title: '活动图集' }, type };
    case 'cta':
      return {
        ...common,
        content: {
          action: { href: '/register', label: '立即开始' },
          description: '填写行动说明',
          title: '行动标题',
        },
        type,
      };
    case 'divider':
      return { ...common, content: {}, type };
  }
}
