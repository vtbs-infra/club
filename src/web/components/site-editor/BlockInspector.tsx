import type {
  SiteAction,
  SiteAsset,
  SiteBlock,
  SiteBlockStyle,
} from '../../../shared/site-content';

function setOptional<T extends object, K extends keyof T>(source: T, key: K, value: T[K]): T {
  const result = { ...source };
  if (value === undefined) delete result[key];
  else result[key] = value;
  return result;
}

function AssetSelect({
  assets,
  label,
  onChange,
  value,
}: {
  readonly assets: readonly SiteAsset[];
  readonly label: string;
  readonly onChange: (value: string | undefined) => void;
  readonly value: string | undefined;
}) {
  return (
    <label>
      {label}
      <select onChange={(event) => onChange(event.target.value || undefined)} value={value ?? ''}>
        <option value="">使用主题默认图形</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.filename}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionEditor({
  action,
  label,
  onChange,
  optional = false,
}: {
  readonly action: SiteAction | undefined;
  readonly label: string;
  readonly onChange: (action: SiteAction | undefined) => void;
  readonly optional?: boolean;
}) {
  return (
    <fieldset className="site-action-editor">
      <legend>{label}</legend>
      {optional ? (
        <label className="check-field">
          <input
            checked={action !== undefined}
            onChange={(event) =>
              onChange(event.target.checked ? { href: '/', label: '了解更多' } : undefined)
            }
            type="checkbox"
          />
          启用按钮
        </label>
      ) : null}
      {action ? (
        <div className="form-grid">
          <label>
            按钮文字
            <input
              maxLength={80}
              onChange={(event) => onChange({ ...action, label: event.target.value })}
              value={action.label}
            />
          </label>
          <label>
            链接
            <input
              maxLength={500}
              onChange={(event) => onChange({ ...action, href: event.target.value })}
              placeholder="/gifts 或 https://..."
              value={action.href}
            />
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

function CommonFields({
  assets,
  block,
  onChange,
}: {
  readonly assets: readonly SiteAsset[];
  readonly block: SiteBlock;
  readonly onChange: (block: SiteBlock) => void;
}) {
  const setStyle = <K extends keyof SiteBlockStyle>(key: K, value: SiteBlockStyle[K]) =>
    onChange({
      ...block,
      style: setOptional(block.style, key, value),
    });
  return (
    <details className="site-inspector-section" open>
      <summary>显示与布局</summary>
      <div className="site-inspector-fields">
        <label className="switch-field">
          <input
            checked={block.enabled}
            onChange={(event) => onChange({ ...block, enabled: event.target.checked })}
            type="checkbox"
          />
          <span>
            <strong>显示模块</strong>
            <small>关闭后不会出现在公开首页。</small>
          </span>
        </label>
        <div className="form-grid">
          <label>
            可见范围
            <select
              onChange={(event) =>
                onChange({
                  ...block,
                  audience: event.target.value as SiteBlock['audience'],
                })
              }
              value={block.audience}
            >
              <option value="all">所有人</option>
              <option value="anonymous">仅未登录</option>
              <option value="authenticated">仅已登录</option>
            </select>
          </label>
          <label>
            主题变体
            <select
              onChange={(event) =>
                onChange({
                  ...block,
                  themeVariant: event.target.value as SiteBlock['themeVariant'],
                })
              }
              value={block.themeVariant}
            >
              <option value="default">默认</option>
              <option value="subtle">柔和</option>
              <option value="accent">强调</option>
            </select>
          </label>
          <label>
            内容宽度
            <select
              onChange={(event) =>
                setStyle('maxWidth', event.target.value as NonNullable<SiteBlockStyle['maxWidth']>)
              }
              value={block.style.maxWidth ?? 'wide'}
            >
              <option value="narrow">窄</option>
              <option value="normal">标准</option>
              <option value="wide">宽</option>
              <option value="full">全宽</option>
            </select>
          </label>
          <label>
            上下间距
            <select
              onChange={(event) =>
                setStyle('padding', event.target.value as NonNullable<SiteBlockStyle['padding']>)
              }
              value={block.style.padding ?? 'normal'}
            >
              <option value="compact">紧凑</option>
              <option value="normal">标准</option>
              <option value="spacious">宽松</option>
            </select>
          </label>
          <label>
            文本对齐
            <select
              onChange={(event) =>
                setStyle('align', event.target.value as NonNullable<SiteBlockStyle['align']>)
              }
              value={block.style.align ?? 'left'}
            >
              <option value="left">左对齐</option>
              <option value="center">居中</option>
            </select>
          </label>
          <label>
            背景语义
            <select
              onChange={(event) =>
                setStyle(
                  'background',
                  event.target.value as NonNullable<SiteBlockStyle['background']>,
                )
              }
              value={block.style.background ?? 'default'}
            >
              <option value="default">默认</option>
              <option value="muted">柔和</option>
              <option value="accent">强调</option>
            </select>
          </label>
          <label>
            文字色调
            <select
              onChange={(event) =>
                setStyle('textTone', event.target.value as NonNullable<SiteBlockStyle['textTone']>)
              }
              value={block.style.textTone ?? 'auto'}
            >
              <option value="auto">自动</option>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <label>
            遮罩强度
            <input
              max={0.8}
              min={0}
              onChange={(event) => setStyle('overlay', Number(event.target.value))}
              step={0.05}
              type="range"
              value={block.style.overlay ?? 0}
            />
          </label>
        </div>
        <AssetSelect
          assets={assets}
          label="模块背景图"
          onChange={(backgroundAssetId) => setStyle('backgroundAssetId', backgroundAssetId)}
          value={block.style.backgroundAssetId}
        />
      </div>
    </details>
  );
}

export function BlockInspector({
  assets,
  block,
  onChange,
}: {
  readonly assets: readonly SiteAsset[];
  readonly block: SiteBlock | null;
  readonly onChange: (block: SiteBlock) => void;
}) {
  if (!block) {
    return <p className="quiet-line">从模块列表选择一个模块进行编辑。</p>;
  }

  let contentFields;
  switch (block.type) {
    case 'hero':
      contentFields = (
        <>
          <label>
            标签文字
            <input
              maxLength={120}
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, eyebrow: event.target.value } })
              }
              value={block.content.eyebrow}
            />
          </label>
          <label>
            主标题
            <input
              maxLength={160}
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            副标题
            <textarea
              maxLength={800}
              onChange={(event) =>
                onChange({
                  ...block,
                  content: { ...block.content, description: event.target.value },
                })
              }
              rows={4}
              value={block.content.description}
            />
          </label>
          <AssetSelect
            assets={assets}
            label="主播头像"
            onChange={(avatarAssetId) =>
              onChange({
                ...block,
                content: setOptional(block.content, 'avatarAssetId', avatarAssetId),
              })
            }
            value={block.content.avatarAssetId}
          />
          <AssetSelect
            assets={assets}
            label="桌面背景图"
            onChange={(backgroundDesktopAssetId) =>
              onChange({
                ...block,
                content: setOptional(
                  block.content,
                  'backgroundDesktopAssetId',
                  backgroundDesktopAssetId,
                ),
              })
            }
            value={block.content.backgroundDesktopAssetId}
          />
          <AssetSelect
            assets={assets}
            label="手机背景图"
            onChange={(backgroundMobileAssetId) =>
              onChange({
                ...block,
                content: setOptional(
                  block.content,
                  'backgroundMobileAssetId',
                  backgroundMobileAssetId,
                ),
              })
            }
            value={block.content.backgroundMobileAssetId}
          />
          <ActionEditor
            action={block.content.primaryAction}
            label="主按钮"
            onChange={(primaryAction) =>
              onChange({
                ...block,
                content: setOptional(block.content, 'primaryAction', primaryAction),
              })
            }
            optional
          />
          <ActionEditor
            action={block.content.secondaryAction}
            label="次按钮"
            onChange={(secondaryAction) =>
              onChange({
                ...block,
                content: setOptional(block.content, 'secondaryAction', secondaryAction),
              })
            }
            optional
          />
        </>
      );
      break;
    case 'user_tasks':
      contentFields = (
        <label>
          模块标题
          <input
            maxLength={120}
            onChange={(event) =>
              onChange({ ...block, content: { ...block.content, title: event.target.value } })
            }
            value={block.content.title}
          />
        </label>
      );
      break;
    case 'active_campaign':
      contentFields = (
        <>
          <label>
            模块标题
            <input
              maxLength={120}
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            空状态文字
            <textarea
              maxLength={300}
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, emptyText: event.target.value } })
              }
              value={block.content.emptyText}
            />
          </label>
        </>
      );
      break;
    case 'image_text':
      contentFields = (
        <>
          <label>
            标签文字
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, eyebrow: event.target.value } })
              }
              value={block.content.eyebrow}
            />
          </label>
          <label>
            图文标题
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            图文内容
            <textarea
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, body: event.target.value } })
              }
              rows={7}
              value={block.content.body}
            />
          </label>
          <label>
            布局
            <select
              onChange={(event) =>
                onChange({
                  ...block,
                  content: {
                    ...block.content,
                    layout: event.target.value as 'image-left' | 'image-right',
                  },
                })
              }
              value={block.content.layout}
            >
              <option value="image-left">图片左 / 文字右</option>
              <option value="image-right">文字左 / 图片右</option>
            </select>
          </label>
          <AssetSelect
            assets={assets}
            label="内容图片"
            onChange={(assetId) =>
              onChange({
                ...block,
                content: setOptional(block.content, 'assetId', assetId),
              })
            }
            value={block.content.assetId}
          />
        </>
      );
      break;
    case 'rich_text':
      contentFields = (
        <>
          <label>
            标题
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            正文（每段一行）
            <textarea
              onChange={(event) =>
                onChange({
                  ...block,
                  content: {
                    ...block.content,
                    paragraphs: event.target.value.split('\n'),
                  },
                })
              }
              rows={8}
              value={block.content.paragraphs.join('\n')}
            />
          </label>
          <label>
            按钮（文字|链接，每行一个）
            <textarea
              onChange={(event) =>
                onChange({
                  ...block,
                  content: {
                    ...block.content,
                    actions: event.target.value
                      .split('\n')
                      .filter(Boolean)
                      .map((line) => {
                        const [label = '', href = ''] = line.split('|');
                        return { href: href.trim(), label: label.trim() };
                      }),
                  },
                })
              }
              rows={4}
              value={block.content.actions
                .map((action) => `${action.label}|${action.href}`)
                .join('\n')}
            />
          </label>
        </>
      );
      break;
    case 'announcement_list':
      contentFields = (
        <div className="form-grid">
          <label>
            模块标题
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            显示条数
            <select
              onChange={(event) =>
                onChange({
                  ...block,
                  content: { ...block.content, limit: Number(event.target.value) },
                })
              }
              value={block.content.limit}
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
        </div>
      );
      break;
    case 'process_steps':
      contentFields = (
        <>
          <label>
            模块标题
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            步骤（标题|说明，每行一步）
            <textarea
              onChange={(event) =>
                onChange({
                  ...block,
                  content: {
                    ...block.content,
                    steps: event.target.value
                      .split('\n')
                      .filter(Boolean)
                      .map((line) => {
                        const [title = '', description = ''] = line.split('|');
                        return { description: description.trim(), title: title.trim() };
                      }),
                  },
                })
              }
              rows={8}
              value={block.content.steps
                .map((step) => `${step.title}|${step.description}`)
                .join('\n')}
            />
          </label>
        </>
      );
      break;
    case 'image_banner':
      contentFields = (
        <>
          <label>
            横幅标题
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            横幅说明
            <textarea
              onChange={(event) =>
                onChange({
                  ...block,
                  content: { ...block.content, description: event.target.value },
                })
              }
              value={block.content.description}
            />
          </label>
          <AssetSelect
            assets={assets}
            label="横幅图片"
            onChange={(assetId) =>
              onChange({
                ...block,
                content: setOptional(block.content, 'assetId', assetId),
              })
            }
            value={block.content.assetId}
          />
          <ActionEditor
            action={block.content.action}
            label="横幅按钮"
            onChange={(action) =>
              onChange({
                ...block,
                content: setOptional(block.content, 'action', action),
              })
            }
            optional
          />
        </>
      );
      break;
    case 'card_group':
      contentFields = (
        <>
          <label>
            分组标题
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            卡片（标题|说明|链接，每行一张）
            <textarea
              onChange={(event) =>
                onChange({
                  ...block,
                  content: {
                    ...block.content,
                    cards: event.target.value
                      .split('\n')
                      .filter(Boolean)
                      .map((line) => {
                        const [title = '', description = '', href = ''] = line.split('|');
                        return {
                          description: description.trim(),
                          ...(href.trim() ? { href: href.trim() } : {}),
                          title: title.trim(),
                        };
                      }),
                  },
                })
              }
              rows={8}
              value={block.content.cards
                .map((card) => `${card.title}|${card.description}|${card.href ?? ''}`)
                .join('\n')}
            />
          </label>
        </>
      );
      break;
    case 'gallery':
      contentFields = (
        <>
          <label>
            图库标题
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <div className="gallery-selector">
            {assets.map((asset) => {
              const selected = block.content.items.some((item) => item.assetId === asset.id);
              return (
                <label className="check-field" key={asset.id}>
                  <input
                    checked={selected}
                    onChange={(event) =>
                      onChange({
                        ...block,
                        content: {
                          ...block.content,
                          items: event.target.checked
                            ? [
                                ...block.content.items,
                                { assetId: asset.id, caption: asset.filename },
                              ]
                            : block.content.items.filter((item) => item.assetId !== asset.id),
                        },
                      })
                    }
                    type="checkbox"
                  />
                  {asset.filename}
                </label>
              );
            })}
          </div>
        </>
      );
      break;
    case 'cta':
      contentFields = (
        <>
          <label>
            行动标题
            <input
              onChange={(event) =>
                onChange({ ...block, content: { ...block.content, title: event.target.value } })
              }
              value={block.content.title}
            />
          </label>
          <label>
            行动说明
            <textarea
              onChange={(event) =>
                onChange({
                  ...block,
                  content: { ...block.content, description: event.target.value },
                })
              }
              value={block.content.description}
            />
          </label>
          <ActionEditor
            action={block.content.action}
            label="主按钮"
            onChange={(action) => {
              if (action) onChange({ ...block, content: { ...block.content, action } });
            }}
          />
          <ActionEditor
            action={block.content.secondaryAction}
            label="次按钮"
            onChange={(secondaryAction) =>
              onChange({
                ...block,
                content: setOptional(block.content, 'secondaryAction', secondaryAction),
              })
            }
            optional
          />
        </>
      );
      break;
    case 'divider':
      contentFields = (
        <label>
          分隔标签（可选）
          <input
            onChange={(event) =>
              onChange({
                ...block,
                content: setOptional(block.content, 'label', event.target.value || undefined),
              })
            }
            value={block.content.label ?? ''}
          />
        </label>
      );
      break;
  }

  return (
    <div className="site-block-inspector">
      <div>
        <p className="eyebrow">BLOCK SETTINGS</p>
        <h2>编辑模块</h2>
        <code>{block.type}</code>
      </div>
      <details className="site-inspector-section" open>
        <summary>内容</summary>
        <div className="site-inspector-fields">{contentFields}</div>
      </details>
      <CommonFields assets={assets} block={block} onChange={onChange} />
    </div>
  );
}
