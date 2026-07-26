import { blockClass, type HomeBlockProperties } from './types';

export function RichTextBlock({ block }: HomeBlockProperties<'rich_text'>) {
  return (
    <section className={blockClass(block)}>
      <div className="home-block-inner home-rich-text">
        <h2>{block.content.title}</h2>
        {block.content.paragraphs.map((paragraph, index) => (
          <p key={`${block.id}-${index}`}>{paragraph}</p>
        ))}
        {block.content.actions.length ? (
          <div className="home-actions">
            {block.content.actions.map((action, index) => (
              <a
                className={index === 0 ? 'button' : 'button button-secondary'}
                href={action.href}
                key={`${action.href}-${action.label}`}
              >
                {action.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
