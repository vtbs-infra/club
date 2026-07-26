import { assetUrl, blockClass, type HomeBlockProperties } from './types';

export function ImageTextBlock({ block }: HomeBlockProperties<'image_text'>) {
  return (
    <section className={blockClass(block)}>
      <div className={`home-block-inner home-image-text ${block.content.layout}`}>
        <div className="home-image-text-media">
          {block.content.assetId ? (
            <img alt="" loading="lazy" src={assetUrl(block.content.assetId)} />
          ) : (
            <div className="home-abstract-art" aria-hidden="true">
              <span>✦</span>
            </div>
          )}
        </div>
        <div className="home-image-text-copy">
          <p className="home-eyebrow">{block.content.eyebrow}</p>
          <h2>{block.content.title}</h2>
          <p>{block.content.body}</p>
        </div>
      </div>
    </section>
  );
}
