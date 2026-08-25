import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Palette } from 'lucide-react';
import { useEffect, type FormEvent } from 'react';

import {
  appearanceQueryKey,
  updateAppearance,
  type Appearance,
  type ThemePreset,
} from '../../api/client';
import { ErrorNotice, InlineNotice, PageHeader, StatusBadge } from '../../components/Ui';
import { useAppearance } from '../../theme/context';
import { THEME_DEFINITIONS, THEME_OPTIONS } from '../../theme/definitions';

export function AdminAppearancePage() {
  const queryClient = useQueryClient();
  const {
    acceptAppliedTheme,
    appliedTheme,
    cancelPreview,
    loadError,
    previewTheme,
    setPreviewTheme,
  } = useAppearance();
  const selectedTheme = previewTheme ?? appliedTheme;
  const hasPreview = selectedTheme !== appliedTheme;
  const apply = useMutation({
    mutationFn: updateAppearance,
    onSuccess: (appearance) => {
      queryClient.setQueryData<Appearance>(appearanceQueryKey, appearance);
      acceptAppliedTheme(appearance.themePreset);
    },
  });

  useEffect(
    () => () => {
      cancelPreview();
    },
    [cancelPreview],
  );

  const chooseTheme = (theme: ThemePreset) => {
    apply.reset();
    if (theme === appliedTheme) cancelPreview();
    else setPreviewTheme(theme);
  };
  const currentDefinition = THEME_DEFINITIONS[appliedTheme];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="平台外观"
        intro="选择一套由 Club 维护的预设，并在当前页面完整预览后应用到所有访问者。主题不会改变页面结构或业务流程。"
        title="主题与外观"
      />

      {loadError ? <ErrorNotice error={loadError} /> : null}

      <section className="panel appearance-current-panel" aria-labelledby="current-theme-title">
        <span className="appearance-current-icon" aria-hidden="true">
          <Palette size={24} />
        </span>
        <div className="appearance-current-copy">
          <p className="eyebrow" id="current-theme-title">
            当前已应用
          </p>
          <h2>{currentDefinition.name}</h2>
          <p>{currentDefinition.description}</p>
        </div>
        <StatusBadge
          label={loadError ? '本地回退' : '全站生效中'}
          tone={loadError ? 'warning' : 'success'}
        />
      </section>

      <form
        className="panel appearance-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (hasPreview) apply.mutate(selectedTheme);
        }}
      >
        <fieldset className="appearance-fieldset" disabled={apply.isPending}>
          <legend>选择主题预设</legend>
          <p className="appearance-fieldset-intro">
            选择后只会改变这个浏览器中的预览；点击应用前，其他用户不会看到变化。
          </p>
          <div className="appearance-theme-grid">
            {THEME_OPTIONS.map((theme) => {
              const isApplied = theme.id === appliedTheme;
              const isSelected = theme.id === selectedTheme;
              return (
                <label className="appearance-theme-option" key={theme.id}>
                  <input
                    aria-label={theme.name}
                    checked={isSelected}
                    name="theme-preset"
                    onChange={() => chooseTheme(theme.id)}
                    type="radio"
                    value={theme.id}
                  />
                  <span className="appearance-theme-card">
                    <span className="appearance-theme-heading">
                      <span>
                        <strong>{theme.name}</strong>
                        <small>{theme.id}</small>
                      </span>
                      {isApplied ? (
                        <span className="appearance-applied-mark">
                          <Check aria-hidden="true" size={14} />
                          已应用
                        </span>
                      ) : null}
                    </span>
                    <span className="appearance-swatches" aria-hidden="true">
                      {theme.swatches.map((swatch) => (
                        <span
                          aria-hidden="true"
                          className="appearance-swatch"
                          key={swatch}
                          style={{ backgroundColor: swatch }}
                        />
                      ))}
                    </span>
                    <span className="appearance-theme-description">{theme.description}</span>
                    <span className="appearance-component-preview" aria-hidden="true">
                      <span className="appearance-sample-button">主要操作</span>
                      <span className="status-badge status-tone-success">状态正常</span>
                      <span className="appearance-sample-input">输入内容</span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {hasPreview ? (
          <InlineNotice tone="warning">
            <p>正在本地预览“{THEME_DEFINITIONS[selectedTheme].name}”，尚未应用到其他用户。</p>
          </InlineNotice>
        ) : null}
        {apply.isError ? <ErrorNotice error={apply.error} /> : null}
        {apply.isSuccess ? (
          <InlineNotice tone="success">
            <p>“{currentDefinition.name}”已应用到整个应用。</p>
          </InlineNotice>
        ) : null}

        <div className="form-actions appearance-actions">
          <button
            className="button ghost"
            disabled={!hasPreview || apply.isPending}
            onClick={() => {
              apply.reset();
              cancelPreview();
            }}
            type="button"
          >
            取消预览
          </button>
          <button
            className="button primary"
            disabled={!hasPreview || apply.isPending}
            type="submit"
          >
            {apply.isPending ? '正在应用…' : '应用到整个应用'}
          </button>
        </div>
      </form>
    </div>
  );
}
