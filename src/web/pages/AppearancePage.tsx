import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';

import type { UiTheme } from '../../shared/ui-theme';
import {
  getAppearance,
  restoreAppearance,
  updateAppearance,
  type AppearanceState,
} from '../api/appearance';
import { AuthenticatedPage } from '../components/AuthenticatedPage';
import { useTheme } from '../theme/context';

interface ThemeOption {
  readonly description: string;
  readonly eyebrow: string;
  readonly id: UiTheme;
  readonly name: string;
  readonly swatches: readonly string[];
}

const themeOptions: readonly ThemeOption[] = [
  {
    description: 'Soft candy colors, friendly cards, and a fan-first gift experience.',
    eyebrow: '方案 1 / SCHEME 01',
    id: 'moe',
    name: 'Hyper-Energy Supply Station',
    swatches: ['#ff5f9e', '#54c7ec', '#ffd166', '#fff5f8'],
  },
  {
    description: 'Dark glass, live telemetry, and neon command-center energy.',
    eyebrow: '方案 2 / SCHEME 02',
    id: 'neon',
    name: 'Live Room Console',
    swatches: ['#7c6cff', '#21e6c1', '#ff4d8d', '#080b14'],
  },
  {
    description: 'Warm paper, catalog structure, and a refined archival character.',
    eyebrow: '方案 3 / SCHEME 03',
    id: 'archive',
    name: 'Captain Gift Archive',
    swatches: ['#b84434', '#183153', '#b88a44', '#f5eddd'],
  },
  {
    description: 'Crisp pixels, playful status blocks, and a compact supply-ship HUD.',
    eyebrow: '方案 4 / SCHEME 04',
    id: 'pixel',
    name: 'Pixel Supply Ship',
    swatches: ['#ff63b7', '#69e2ff', '#ffe66d', '#100b24'],
  },
] as const;

export function AppearancePage() {
  return (
    <AuthenticatedPage>
      {(identity) =>
        identity.user.platformRole === 'PLATFORM_ADMIN' ? (
          <AppearanceEditor />
        ) : (
          <Navigate replace to="/organizations" />
        )
      }
    </AuthenticatedPage>
  );
}

function AppearanceEditor() {
  const appearance = useQuery({
    queryFn: getAppearance,
    queryKey: ['platform', 'appearance'],
  });
  const [selection, setSelection] = useState<UiTheme | null>(null);
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const selectedTheme = selection ?? appearance.data?.activeTheme ?? 'archive';

  const synchronize = (state: AppearanceState) => {
    queryClient.setQueryData(['platform', 'appearance'], state);
    setSelection(state.activeTheme);
    setTheme(state.activeTheme);
  };
  const publish = useMutation({
    mutationFn: () => updateAppearance(selectedTheme, appearance.data?.version ?? 0),
    onSuccess: synchronize,
  });
  const restore = useMutation({
    mutationFn: () => restoreAppearance(appearance.data?.version ?? 0),
    onSuccess: synchronize,
  });
  const error = publish.error ?? restore.error ?? appearance.error;

  return (
    <section className="page-content appearance-page">
      <p className="section-kicker">PLATFORM APPEARANCE</p>
      <h1>Choose the global interface.</h1>
      <p className="lede">
        Every visitor sees the published design. Only a platform administrator can change it after
        deployment.
      </p>

      {appearance.isPending ? <div className="page-state">Loading appearance settings…</div> : null}
      {error ? (
        <div className="page-state page-error">
          Appearance settings could not be saved. Refresh and try again.
        </div>
      ) : null}

      {appearance.data ? (
        <>
          <div className="appearance-summary" aria-label="Current appearance">
            <div>
              <span>Published interface</span>
              <strong>
                {themeOptions.find((option) => option.id === appearance.data.activeTheme)?.name}
              </strong>
            </div>
            <div>
              <span>Deployment default</span>
              <strong>{appearance.data.deploymentTheme.toUpperCase()}</strong>
            </div>
            <div>
              <span>Administrator override</span>
              <strong>{appearance.data.overrideTheme?.toUpperCase() ?? 'NONE'}</strong>
            </div>
          </div>

          <div className="theme-gallery" role="radiogroup" aria-label="Interface schemes">
            {themeOptions.map((option) => (
              <button
                aria-checked={selectedTheme === option.id}
                className="theme-option"
                data-preview-theme={option.id}
                key={option.id}
                onClick={() => setSelection(option.id)}
                role="radio"
                type="button"
              >
                <span className="theme-option-number">{option.eyebrow}</span>
                <strong>{option.name}</strong>
                <span>{option.description}</span>
                <span className="theme-swatches" aria-hidden="true">
                  {option.swatches.map((color) => (
                    <i key={color} style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="theme-option-state">
                  {selectedTheme === option.id ? 'Selected' : 'Select scheme'}
                </span>
              </button>
            ))}
          </div>

          <div className="appearance-actions">
            <button
              className="button"
              disabled={
                publish.isPending ||
                restore.isPending ||
                selectedTheme === appearance.data.activeTheme
              }
              onClick={() => publish.mutate()}
              type="button"
            >
              {publish.isPending ? 'Publishing…' : 'Publish selected interface'}
            </button>
            <button
              className="button secondary-button"
              disabled={
                publish.isPending || restore.isPending || appearance.data.overrideTheme === null
              }
              onClick={() => restore.mutate()}
              type="button"
            >
              {restore.isPending ? 'Restoring…' : 'Restore deployment default'}
            </button>
          </div>
          <p className="muted appearance-note">
            Selecting a card is only a preview choice. The global interface changes after you
            publish.
          </p>
        </>
      ) : null}
    </section>
  );
}
