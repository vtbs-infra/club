import type { ReactNode } from 'react';

import type { SiteAction, SiteAsset, SiteBlock } from '../../../shared/site-content';

interface BlockInspectorProperties {
  readonly assets: readonly SiteAsset[];
  readonly block: SiteBlock | null;
  readonly onChange: (block: SiteBlock) => void;
}

function Field({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <label className="site-editor-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function contentWith(block: SiteBlock, key: string, value: unknown): SiteBlock {
  return {
    ...block,
    content: { ...block.content, [key]: value },
  } as SiteBlock;
}

function styleWith(block: SiteBlock, key: string, value: unknown): SiteBlock {
  return {
    ...block,
    style: { ...block.style, [key]: value || undefined },
  };
}

function ActionFields({
  action,
  label,
  onChange,
}: {
  readonly action: SiteAction | undefined;
  readonly label: string;
  readonly onChange: (action: SiteAction | undefined) => void;
}) {
  return (
    <fieldset className="site-editor-action">
      <legend>{label}</legend>
      <Field label="按钮文字">
        <input
          maxLength={80}
          onChange={(event) =>
            onChange(
              event.target.value
                ? { href: action?.href ?? '/', label: event.target.value }
                : undefined,
            )
          }
          value={action?.label ?? ''}
        />
      </Field>
      <Field label="链接">
        <input
          maxLength={500}
          onChange={(event) =>
            onChange(action ? { ...action, href: event.target.value } : undefined)
          }
          placeholder="/claims 或 https://..."
          value={action?.href ?? ''}
        />
      </Field>
    </fieldset>
  );
}

function AssetSelect({
  assets,
  label,
  onChange,
  value,
}: {
  readonly assets: readonly SiteAsset[];
  readonly label: string;
  readonly onChange: (assetId: string | undefined) => void;
  readonly value: string | undefined;
}) {
  return (
    <Field label={label}>
      <select onChange={(event) => onChange(event.target.value || undefined)} value={value ?? ''}>
        <option value="">使用主题默认图形</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.filename}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function BlockInspector({ assets, block, onChange }: BlockInspectorProperties) {
  if (!block) {
    return <div className="site-editor-empty">从中间列表选择一个模块进行编辑。</div>;
  }
  const updateContent = (key: string, value: unknown) => onChange(contentWith(block, key, value));
  const updateStyle = (key: string, value: unknown) => onChange(styleWith(block, key, value));
  let fields: ReactNode = null;

  switch (block.type) {
    case 'hero':
      fields = (
        <>
          <Field label="标签文字">
            <input
              maxLength={120}
              onChange={(event) => updateContent('eyebrow', event.target.value)}
              value={block.content.eyebrow}
            />
          </Field>
          <Field label="主标题">
            <input
              maxLength={160}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="副标题">
            <textarea
              maxLength={800}
              onChange={(event) => updateContent('description', event.target.value)}
              rows={4}
              value={block.content.description}
            />
          </Field>
          <AssetSelect
            assets={assets}
            label="主播头像"
            onChange={(value) => updateContent('avatarAssetId', value)}
            value={block.content.avatarAssetId}
          />
          <AssetSelect
            assets={assets}
            label="桌面背景图"
            onChange={(value) => updateContent('backgroundDesktopAssetId', value)}
            value={block.content.backgroundDesktopAssetId}
          />
          <AssetSelect
            assets={assets}
            label="手机背景图"
            onChange={(value) => updateContent('backgroundMobileAssetId', value)}
            value={block.content.backgroundMobileAssetId}
          />
          <ActionFields
            action={block.content.primaryAction}
            label="主按钮"
            onChange={(value) => updateContent('primaryAction', value)}
          />
          <ActionFields
            action={block.content.secondaryAction}
            label="次按钮"
            onChange={(value) => updateContent('secondaryAction', value)}
          />
        </>
      );
      break;
    case 'user_tasks':
      fields = (
        <Field label="模块标题">
          <input
            maxLength={120}
            onChange={(event) => updateContent('title', event.target.value)}
            value={block.content.title}
          />
        </Field>
      );
      break;
    case 'active_campaign':
      fields = (
        <>
          <Field label="模块标题">
            <input
              maxLength={120}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="无活动时提示">
            <textarea
              maxLength={300}
              onChange={(event) => updateContent('emptyText', event.target.value)}
              value={block.content.emptyText}
            />
          </Field>
        </>
      );
      break;
    case 'image_text':
      fields = (
        <>
          <Field label="标签文字">
            <input
              maxLength={120}
              onChange={(event) => updateContent('eyebrow', event.target.value)}
              value={block.content.eyebrow}
            />
          </Field>
          <Field label="标题">
            <input
              maxLength={180}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="正文">
            <textarea
              maxLength={4000}
              onChange={(event) => updateContent('body', event.target.value)}
              rows={7}
              value={block.content.body}
            />
          </Field>
          <AssetSelect
            assets={assets}
            label="配图"
            onChange={(value) => updateContent('assetId', value)}
            value={block.content.assetId}
          />
          <Field label="布局">
            <select
              onChange={(event) => updateContent('layout', event.target.value)}
              value={block.content.layout}
            >
              <option value="image-left">图片左 / 文字右</option>
              <option value="image-right">文字左 / 图片右</option>
            </select>
          </Field>
        </>
      );
      break;
    case 'rich_text':
      fields = (
        <>
          <Field label="标题">
            <input
              maxLength={180}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="正文（每段一行）">
            <textarea
              onChange={(event) =>
                updateContent(
                  'paragraphs',
                  event.target.value.split('\n').filter((line) => line.trim()),
                )
              }
              rows={8}
              value={block.content.paragraphs.join('\n')}
            />
          </Field>
          <ActionFields
            action={block.content.actions[0]}
            label="按钮"
            onChange={(value) => updateContent('actions', value ? [value] : [])}
          />
        </>
      );
      break;
    case 'announcement_list':
      fields = (
        <>
          <Field label="模块标题">
            <input
              maxLength={120}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="显示条数">
            <select
              onChange={(event) => updateContent('limit', Number(event.target.value))}
              value={block.content.limit}
            >
              {[2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </>
      );
      break;
    case 'process_steps':
      fields = (
        <>
          <Field label="模块标题">
            <input
              maxLength={120}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="步骤（标题|说明，每行一步）">
            <textarea
              onChange={(event) =>
                updateContent(
                  'steps',
                  event.target.value
                    .split('\n')
                    .filter((line) => line.trim())
                    .map((line) => {
                      const [title, ...description] = line.split('|');
                      return {
                        description: description.join('|').trim(),
                        title: title?.trim() ?? '',
                      };
                    }),
                )
              }
              rows={8}
              value={block.content.steps
                .map((step) => `${step.title}|${step.description}`)
                .join('\n')}
            />
          </Field>
        </>
      );
      break;
    case 'image_banner':
      fields = (
        <>
          <Field label="标题">
            <input
              maxLength={160}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="说明">
            <textarea
              maxLength={500}
              onChange={(event) => updateContent('description', event.target.value)}
              value={block.content.description}
            />
          </Field>
          <AssetSelect
            assets={assets}
            label="横幅图片"
            onChange={(value) => updateContent('assetId', value)}
            value={block.content.assetId}
          />
          <ActionFields
            action={block.content.action}
            label="按钮"
            onChange={(value) => updateContent('action', value)}
          />
        </>
      );
      break;
    case 'card_group':
      fields = (
        <>
          <Field label="模块标题">
            <input
              maxLength={120}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="卡片（标题|说明|链接，每行一张）">
            <textarea
              onChange={(event) =>
                updateContent(
                  'cards',
                  event.target.value
                    .split('\n')
                    .filter((line) => line.trim())
                    .map((line) => {
                      const [title = '', description = '', href = ''] = line.split('|');
                      return {
                        description: description.trim(),
                        ...(href.trim() ? { href: href.trim() } : {}),
                        title: title.trim(),
                      };
                    }),
                )
              }
              rows={8}
              value={block.content.cards
                .map((card) => `${card.title}|${card.description}|${card.href ?? ''}`)
                .join('\n')}
            />
          </Field>
        </>
      );
      break;
    case 'gallery':
      fields = (
        <>
          <Field label="模块标题">
            <input
              maxLength={120}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <fieldset className="site-editor-action">
            <legend>选择图片</legend>
            {assets.map((asset) => {
              const selected = block.content.items.some((item) => item.assetId === asset.id);
              return (
                <label className="site-editor-asset-check" key={asset.id}>
                  <input
                    checked={selected}
                    onChange={() =>
                      updateContent(
                        'items',
                        selected
                          ? block.content.items.filter((item) => item.assetId !== asset.id)
                          : [
                              ...block.content.items,
                              { assetId: asset.id, caption: asset.filename },
                            ],
                      )
                    }
                    type="checkbox"
                  />
                  <img alt="" src={asset.thumbnailUrl} />
                  <span>{asset.filename}</span>
                </label>
              );
            })}
          </fieldset>
        </>
      );
      break;
    case 'cta':
      fields = (
        <>
          <Field label="标题">
            <input
              maxLength={160}
              onChange={(event) => updateContent('title', event.target.value)}
              value={block.content.title}
            />
          </Field>
          <Field label="说明">
            <textarea
              maxLength={500}
              onChange={(event) => updateContent('description', event.target.value)}
              value={block.content.description}
            />
          </Field>
          <ActionFields
            action={block.content.action}
            label="主按钮"
            onChange={(value) => (value ? updateContent('action', value) : undefined)}
          />
          <ActionFields
            action={block.content.secondaryAction}
            label="次按钮"
            onChange={(value) => updateContent('secondaryAction', value)}
          />
        </>
      );
      break;
    case 'divider':
      fields = (
        <Field label="可选文字">
          <input
            maxLength={80}
            onChange={(event) => updateContent('label', event.target.value || undefined)}
            value={block.content.label ?? ''}
          />
        </Field>
      );
      break;
  }

  return (
    <div className="site-block-inspector">
      <div className="site-editor-inspector-title">
        <span>{block.type}</span>
        <strong>{block.id}</strong>
      </div>
      <Field label="可见范围">
        <select
          onChange={(event) =>
            onChange({ ...block, audience: event.target.value as SiteBlock['audience'] })
          }
          value={block.audience}
        >
          <option value="all">所有人</option>
          <option value="anonymous">仅未登录用户</option>
          <option value="authenticated">仅登录用户</option>
        </select>
      </Field>
      <Field label="主题变体">
        <select
          onChange={(event) =>
            onChange({ ...block, themeVariant: event.target.value as SiteBlock['themeVariant'] })
          }
          value={block.themeVariant}
        >
          <option value="default">默认</option>
          <option value="accent">强调</option>
          <option value="subtle">柔和</option>
        </select>
      </Field>
      {fields}
      <details className="site-editor-style-panel">
        <summary>通用外观</summary>
        <Field label="上下间距">
          <select
            onChange={(event) => updateStyle('padding', event.target.value)}
            value={block.style.padding ?? 'normal'}
          >
            <option value="compact">紧凑</option>
            <option value="normal">标准</option>
            <option value="spacious">宽松</option>
          </select>
        </Field>
        <Field label="内容宽度">
          <select
            onChange={(event) => updateStyle('maxWidth', event.target.value)}
            value={block.style.maxWidth ?? 'wide'}
          >
            <option value="narrow">窄</option>
            <option value="normal">标准</option>
            <option value="wide">宽</option>
            <option value="full">全宽</option>
          </select>
        </Field>
        <Field label="文本对齐">
          <select
            onChange={(event) => updateStyle('align', event.target.value)}
            value={block.style.align ?? 'left'}
          >
            <option value="left">左对齐</option>
            <option value="center">居中</option>
          </select>
        </Field>
        <Field label="背景语义">
          <select
            onChange={(event) => updateStyle('background', event.target.value)}
            value={block.style.background ?? 'default'}
          >
            <option value="default">默认</option>
            <option value="muted">柔和</option>
            <option value="accent">强调</option>
          </select>
        </Field>
        <Field label="文字色调">
          <select
            onChange={(event) => updateStyle('textTone', event.target.value)}
            value={block.style.textTone ?? 'auto'}
          >
            <option value="auto">自动</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </Field>
        <Field label={`背景遮罩 ${Math.round((block.style.overlay ?? 0.36) * 100)}%`}>
          <input
            max="0.8"
            min="0"
            onChange={(event) => updateStyle('overlay', Number(event.target.value))}
            step="0.05"
            type="range"
            value={block.style.overlay ?? 0.36}
          />
        </Field>
      </details>
    </div>
  );
}
