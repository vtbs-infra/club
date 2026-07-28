import type { CSSProperties } from 'react';

import { assetUrl, blockClass, type HomeBlockProperties } from './types';

export function ImageBannerBlock({ block }: HomeBlockProperties<'image_banner'>) {
  const image = assetUrl(block.content.assetId ?? block.style.backgroundAssetId);
  const style = {
    '--home-banner-image': image ? `url("${image}")` : 'none',
    '--home-overlay': String(block.style.overlay ?? 0.32),
    '--home-position': block.style.backgroundPosition ?? 'center',
  } as CSSProperties;
  return (
    <section className={`${blockClass(block)} home-image-banner`} style={style}>
      <div className="home-block-inner">
        <h2>{block.content.title}</h2>
        <p>{block.content.description}</p>
        {block.content.action ? (
          <a className="button" href={block.content.action.href}>
            {block.content.action.label}
          </a>
        ) : null}
      </div>
    </section>
  );
}
