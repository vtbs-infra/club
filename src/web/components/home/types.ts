import type { SiteBlock, SiteBlockType, SiteHomeResponse } from '../../../shared/site-content';
import type { Identity } from '../../api/identity';

export type BlockOf<T extends SiteBlockType> = Extract<SiteBlock, { readonly type: T }>;

export interface HomeBlockProperties<T extends SiteBlockType> {
  readonly block: BlockOf<T>;
  readonly home: SiteHomeResponse;
  readonly identity: Identity | null;
}

export function assetUrl(assetId: string | undefined, thumbnail = false): string | undefined {
  return assetId
    ? `/api/v1/site-assets/${assetId}${thumbnail ? '?variant=thumbnail' : ''}`
    : undefined;
}

export function blockClass(block: SiteBlock): string {
  const style = block.style;
  return [
    'home-block',
    `home-block-${block.type}`,
    `home-variant-${block.themeVariant}`,
    `home-padding-${style.padding ?? 'normal'}`,
    `home-width-${style.maxWidth ?? 'wide'}`,
    `home-align-${style.align ?? 'left'}`,
    `home-background-${style.background ?? 'default'}`,
    `home-tone-${style.textTone ?? 'auto'}`,
  ].join(' ');
}
