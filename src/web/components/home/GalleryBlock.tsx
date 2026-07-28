import { assetUrl, blockClass, type HomeBlockProperties } from './types';

export function GalleryBlock({ block }: HomeBlockProperties<'gallery'>) {
  return (
    <section className={blockClass(block)}>
      <div className="home-block-inner">
        <h2>{block.content.title}</h2>
        {block.content.items.length ? (
          <div className="home-gallery">
            {block.content.items.map((item) => (
              <figure key={`${item.assetId}-${item.caption}`}>
                <img alt={item.caption} loading="lazy" src={assetUrl(item.assetId)} />
                <figcaption>{item.caption}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="home-empty-state">上传图片后可在这里展示往期礼物与活动。</div>
        )}
      </div>
    </section>
  );
}
