import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { UiTheme } from '../../../shared/ui-theme';
import {
  getAppearance,
  restoreAppearance,
  updateAppearance,
  type AppearanceState,
} from '../../api/appearance';
import { useTheme } from '../../theme/context';
import { ErrorNotice, LoadingState, PageHeader } from '../../components/Ui';

interface ThemeOption {
  readonly description: string;
  readonly id: UiTheme;
  readonly name: string;
  readonly scheme: string;
  readonly swatches: readonly string[];
}

const themeOptions: readonly ThemeOption[] = [
  {
    description: '柔和糖果配色、亲切卡片与面向粉丝的礼物体验。',
    id: 'moe',
    name: '超元气补给站',
    scheme: '方案 1',
    swatches: ['#ff5f9e', '#54c7ec', '#ffd166', '#fff5f8'],
  },
  {
    description: '深色玻璃质感、实时数据与霓虹控制台氛围。',
    id: 'neon',
    name: '直播间控制台',
    scheme: '方案 2',
    swatches: ['#7c6cff', '#21e6c1', '#ff4d8d', '#080b14'],
  },
  {
    description: '温润纸张、目录结构与精致的档案气质。',
    id: 'archive',
    name: '舰长礼物档案馆',
    scheme: '方案 3',
    swatches: ['#b84434', '#183153', '#b88a44', '#f5eddd'],
  },
  {
    description: '清晰像素、趣味状态块与紧凑的补给舰界面。',
    id: 'pixel',
    name: '像素补给舰',
    scheme: '方案 4',
    swatches: ['#ff63b7', '#69e2ff', '#ffe66d', '#100b24'],
  },
] as const;

export function AdminAppearancePage() {
  const appearance = useQuery({
    queryFn: getAppearance,
    queryKey: ['admin', 'appearance'],
  });
  if (appearance.isPending) return <LoadingState label="正在读取外观设置…" />;
  if (!appearance.data) return <ErrorNotice error={appearance.error} />;
  return (
    <AppearanceEditor
      key={`${appearance.data.version}:${appearance.data.activeTheme}`}
      state={appearance.data}
    />
  );
}

function AppearanceEditor({ state }: { readonly state: AppearanceState }) {
  const [selection, setSelection] = useState<UiTheme>(state.activeTheme);
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const synchronize = (nextState: AppearanceState) => {
    queryClient.setQueryData(['admin', 'appearance'], nextState);
    setSelection(nextState.activeTheme);
    setTheme(nextState.activeTheme);
  };
  const publish = useMutation({
    mutationFn: () => updateAppearance(selection, state.version),
    onSuccess: synchronize,
  });
  const restore = useMutation({
    mutationFn: () => restoreAppearance(state.version),
    onSuccess: synchronize,
  });

  return (
    <div className="stack-lg appearance-page">
      <PageHeader
        eyebrow="PLATFORM APPEARANCE"
        intro="部署时由 UI_THEME 选择默认方案；部署后只有平台管理员可以发布全站主题。"
        title="主题与外观"
      />
      {publish.error || restore.error ? (
        <ErrorNotice error={publish.error ?? restore.error} />
      ) : null}
      <section className="appearance-summary">
        <div>
          <span>当前已发布</span>
          <strong>{themeOptions.find((option) => option.id === state.activeTheme)?.name}</strong>
        </div>
        <div>
          <span>部署默认</span>
          <strong>{state.deploymentTheme.toUpperCase()}</strong>
        </div>
        <div>
          <span>管理员覆盖</span>
          <strong>{state.overrideTheme?.toUpperCase() ?? '无'}</strong>
        </div>
      </section>
      <section aria-label="界面方案" className="theme-gallery" role="radiogroup">
        {themeOptions.map((option) => (
          <button
            aria-checked={selection === option.id}
            className="theme-option"
            data-preview-theme={option.id}
            key={option.id}
            onClick={() => setSelection(option.id)}
            role="radio"
            type="button"
          >
            <span>{option.scheme}</span>
            <strong>{option.name}</strong>
            <p>{option.description}</p>
            <span className="theme-swatches" aria-hidden="true">
              {option.swatches.map((color) => (
                <i key={color} style={{ backgroundColor: color }} />
              ))}
            </span>
            <b>{selection === option.id ? '已选择' : '选择主题'}</b>
          </button>
        ))}
      </section>
      <div className="form-actions">
        <button
          className="button primary"
          disabled={publish.isPending || restore.isPending || selection === state.activeTheme}
          onClick={() => publish.mutate()}
          type="button"
        >
          {publish.isPending ? '正在发布…' : '发布所选主题'}
        </button>
        <button
          className="button ghost"
          disabled={publish.isPending || restore.isPending || state.overrideTheme === null}
          onClick={() => restore.mutate()}
          type="button"
        >
          {restore.isPending ? '正在恢复…' : '恢复部署默认'}
        </button>
      </div>
    </div>
  );
}
