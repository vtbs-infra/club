import { blockClass, type HomeBlockProperties } from './types';

export function CallToActionBlock({ block }: HomeBlockProperties<'cta'>) {
  return (
    <section className={blockClass(block)}>
      <div className="home-block-inner home-cta">
        <h2>{block.content.title}</h2>
        <p>{block.content.description}</p>
        <div className="home-actions">
          <a className="button" href={block.content.action.href}>
            {block.content.action.label}
          </a>
          {block.content.secondaryAction ? (
            <a className="button button-secondary" href={block.content.secondaryAction.href}>
              {block.content.secondaryAction.label}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
