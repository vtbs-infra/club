import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  createDefaultBlock,
  isSitePageContent,
  siteBlockTypes,
  type SiteAdminState,
  type SiteBlock,
  type SiteBlockType,
  type SiteHomeResponse,
  type SitePageContent,
} from '../../../shared/site-content';
import {
  getHomepageAdmin,
  getHomepagePreview,
  listSiteAssets,
  publishHomepage,
  restoreHomepageVersion,
  saveHomepageDraft,
} from '../../api/site-content';
import { HomeRenderer } from '../../components/home/HomeRenderer';
import { AssetLibrary } from '../../components/site-editor/AssetLibrary';
import { BlockInspector } from '../../components/site-editor/BlockInspector';
import { ErrorNotice, LoadingState } from '../../components/Ui';

const blockNames: Readonly<Record<SiteBlockType, string>> = {
  active_campaign: '当前活动',
  announcement_list: '公告列表',
  card_group: '卡片分组',
  cta: '行动按钮',
  divider: '分隔留白',
  gallery: '图片画廊',
  hero: '品牌 Hero',
  image_banner: '图片横幅',
  image_text: '图文介绍',
  process_steps: '领取流程',
  rich_text: '富文本',
  user_tasks: '用户任务',
};

type EditorSection = 'assets' | 'content' | 'site';
type PreviewMode = 'desktop' | 'mobile';

export function AdminSitePage() {
  const admin = useQuery({
    queryFn: getHomepageAdmin,
    queryKey: ['admin', 'site', 'home'],
  });
  if (admin.isPending) return <LoadingState label="正在读取首页草稿…" />;
  if (!admin.data) return <ErrorNotice error={admin.error} />;
  return (
    <SiteEditor
      adminError={admin.error}
      key={`${admin.data.draft.id ?? 'new'}:${admin.data.draft.version}`}
      state={admin.data}
    />
  );
}

function SiteEditor({
  adminError,
  state,
}: {
  readonly adminError: Error | null;
  readonly state: SiteAdminState;
}) {
  const client = useQueryClient();
  const preview = useQuery({
    queryFn: getHomepagePreview,
    queryKey: ['admin', 'site', 'home', 'preview'],
    retry: false,
  });
  const assets = useQuery({
    queryFn: listSiteAssets,
    queryKey: ['admin', 'site-assets'],
  });
  const [content, setContent] = useState<SitePageContent>(() =>
    structuredClone(state.draft.content),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    state.draft.content.blocks[0]?.id ?? null,
  );
  const [section, setSection] = useState<EditorSection>('content');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [newBlockType, setNewBlockType] = useState<SiteBlockType>('image_text');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const synchronize = (nextState: SiteAdminState) => {
    client.setQueryData(['admin', 'site', 'home'], nextState);
    setContent(structuredClone(nextState.draft.content));
    setSelectedId((current) =>
      nextState.draft.content.blocks.some((block) => block.id === current)
        ? current
        : (nextState.draft.content.blocks[0]?.id ?? null),
    );
  };
  const savedContent = state.draft.content;
  const dirty = JSON.stringify(content) !== JSON.stringify(savedContent);
  const valid = isSitePageContent(content);
  const save = useMutation({
    mutationFn: () => saveHomepageDraft(content, state.draft.id),
    onSuccess: synchronize,
  });
  const publish = useMutation({
    mutationFn: () => {
      if (!state.draft.id) throw new Error('请先保存草稿。');
      return publishHomepage(state.draft.id);
    },
    onSuccess: async (state) => {
      synchronize(state);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['site', 'home'] }),
        client.invalidateQueries({ queryKey: ['admin', 'site', 'home', 'preview'] }),
      ]);
    },
  });
  const restore = useMutation({
    mutationFn: (versionId: string) => restoreHomepageVersion(versionId, state.draft.id),
    onSuccess: synchronize,
  });

  const selected = content.blocks.find((block) => block.id === selectedId) ?? null;
  const previewHome = useMemo<SiteHomeResponse>(
    () => ({
      ...(preview.data ?? {
        announcements: [],
        campaigns: [],
        content,
        user: null,
      }),
      content,
    }),
    [content, preview.data],
  );

  const updateBlock = (updated: SiteBlock) =>
    setContent((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.id === updated.id ? updated : block)),
    }));
  const moveBlock = (from: number, to: number) => {
    if (to < 0 || to >= content.blocks.length || from === to) return;
    setContent((current) => {
      const blocks = [...current.blocks];
      const [moved] = blocks.splice(from, 1);
      if (moved) blocks.splice(to, 0, moved);
      return { ...current, blocks };
    });
  };

  const error = adminError ?? assets.error ?? save.error ?? publish.error ?? restore.error;
  return (
    <div className="site-editor-page">
      <header className="site-editor-toolbar">
        <div>
          <p className="eyebrow">SITE CONTENT</p>
          <h1>首页编辑器</h1>
          <span>
            {dirty ? '有未保存修改' : '草稿已保存'} · 已发布版本 {state.published.version}
          </span>
        </div>
        <div className="page-actions">
          <button
            aria-pressed={previewMode === 'desktop'}
            className="button ghost"
            onClick={() => setPreviewMode('desktop')}
            type="button"
          >
            桌面预览
          </button>
          <button
            aria-pressed={previewMode === 'mobile'}
            className="button ghost"
            onClick={() => setPreviewMode('mobile')}
            type="button"
          >
            手机预览
          </button>
          <button
            className="button secondary"
            disabled={!dirty || !valid || save.isPending}
            onClick={() => save.mutate()}
            type="button"
          >
            {save.isPending ? '正在保存…' : '保存草稿'}
          </button>
          <button
            className="button primary"
            disabled={dirty || !state.draft.id || publish.isPending}
            onClick={() => publish.mutate()}
            type="button"
          >
            {publish.isPending ? '正在发布…' : '发布'}
          </button>
        </div>
      </header>
      {!valid ? (
        <div className="inline-notice notice-danger">
          当前内容不符合安全规则；请检查必填字段、链接和模块数量。
        </div>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      <nav aria-label="首页编辑分区" className="site-editor-navigation">
        <button
          className={section === 'site' ? 'active' : ''}
          onClick={() => setSection('site')}
          type="button"
        >
          站点信息
        </button>
        <button
          className={section === 'content' ? 'active' : ''}
          onClick={() => setSection('content')}
          type="button"
        >
          首页内容
        </button>
        <button
          className={section === 'assets' ? 'active' : ''}
          onClick={() => setSection('assets')}
          type="button"
        >
          图片资源
        </button>
        <Link to="/admin/appearance">主题与外观</Link>
      </nav>

      {section === 'site' ? (
        <section className="panel site-information-panel">
          <div>
            <p className="eyebrow">SITE DETAILS</p>
            <h2>站点名称与页脚</h2>
            <p>这些内容会显示在公开首页和页脚中。</p>
          </div>
          <div className="site-information-fields">
            <label>
              站点名称
              <input
                maxLength={100}
                onChange={(event) =>
                  setContent((current) => ({
                    ...current,
                    site: { ...current.site, name: event.target.value },
                  }))
                }
                value={content.site.name}
              />
            </label>
            <label>
              站点简介
              <textarea
                maxLength={200}
                onChange={(event) =>
                  setContent((current) => ({
                    ...current,
                    site: { ...current.site, tagline: event.target.value },
                  }))
                }
                value={content.site.tagline}
              />
            </label>
            <label>
              页脚文字
              <input
                maxLength={300}
                onChange={(event) =>
                  setContent((current) => ({
                    ...current,
                    site: { ...current.site, footerText: event.target.value },
                  }))
                }
                value={content.site.footerText}
              />
            </label>
          </div>
        </section>
      ) : null}

      {section === 'assets' ? <AssetLibrary /> : null}

      {section === 'content' ? (
        <div className="site-editor-workspace">
          <aside className="panel site-editor-blocks">
            <div className="site-editor-add">
              <select
                onChange={(event) => setNewBlockType(event.target.value as SiteBlockType)}
                value={newBlockType}
              >
                {siteBlockTypes.map((type) => (
                  <option key={type} value={type}>
                    {blockNames[type]}
                  </option>
                ))}
              </select>
              <button
                className="button small primary"
                onClick={() => {
                  const block = createDefaultBlock(newBlockType, `block-${crypto.randomUUID()}`);
                  setContent((current) => ({ ...current, blocks: [...current.blocks, block] }));
                  setSelectedId(block.id);
                }}
                type="button"
              >
                添加模块
              </button>
            </div>
            <ol>
              {content.blocks.map((block, index) => (
                <li
                  className={selectedId === block.id ? 'selected' : ''}
                  draggable
                  key={block.id}
                  onDragEnd={() => setDraggedIndex(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDragStart={() => setDraggedIndex(index)}
                  onDrop={() => {
                    if (draggedIndex !== null) moveBlock(draggedIndex, index);
                    setDraggedIndex(null);
                  }}
                >
                  <button
                    className="site-editor-block-select"
                    onClick={() => setSelectedId(block.id)}
                    type="button"
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{blockNames[block.type]}</strong>
                    <small>{block.enabled ? block.audience : '已隐藏'}</small>
                  </button>
                  <div className="site-editor-block-actions">
                    <button
                      aria-label="上移"
                      disabled={index === 0}
                      onClick={() => moveBlock(index, index - 1)}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label="下移"
                      disabled={index === content.blocks.length - 1}
                      onClick={() => moveBlock(index, index + 1)}
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => updateBlock({ ...block, enabled: !block.enabled })}
                      type="button"
                    >
                      {block.enabled ? '隐藏' : '显示'}
                    </button>
                    <button
                      onClick={() => {
                        const duplicate: SiteBlock = {
                          ...structuredClone(block),
                          id: `block-${crypto.randomUUID()}`,
                        };
                        setContent((current) => {
                          const blocks = [...current.blocks];
                          blocks.splice(index + 1, 0, duplicate);
                          return { ...current, blocks };
                        });
                        setSelectedId(duplicate.id);
                      }}
                      type="button"
                    >
                      复制
                    </button>
                    <button
                      onClick={() => {
                        setContent((current) => ({
                          ...current,
                          blocks: current.blocks.filter((item) => item.id !== block.id),
                        }));
                        setSelectedId(null);
                      }}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
          <section className={`site-preview-stage preview-${previewMode}`}>
            <div className="site-preview-label">
              {previewMode === 'desktop' ? '桌面预览' : '手机预览'} · 未发布草稿
            </div>
            <div className="site-preview-canvas">
              <HomeRenderer home={previewHome} preview />
            </div>
          </section>
          <aside className="panel site-editor-inspector">
            <BlockInspector assets={assets.data ?? []} block={selected} onChange={updateBlock} />
            <details className="site-version-history">
              <summary>历史版本</summary>
              {state.versions.map((version) => (
                <div key={version.id}>
                  <span>
                    v{version.version}
                    {version.publishedAt ? ' · 已发布' : ''}
                  </span>
                  <button
                    disabled={dirty || restore.isPending || version.id === state.draft.id}
                    onClick={() => restore.mutate(version.id)}
                    type="button"
                  >
                    恢复为草稿
                  </button>
                </div>
              ))}
            </details>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
