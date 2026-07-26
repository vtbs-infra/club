import { blockClass, type HomeBlockProperties } from './types';

export function CardGroupBlock({ block }: HomeBlockProperties<'card_group'>) {
  return (
    <section className={blockClass(block)}>
      <div className="home-block-inner">
        <h2>{block.content.title}</h2>
        <div className="home-card-group">
          {block.content.cards.map((card) => (
            <article key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
              {card.href ? <a href={card.href}>了解更多 →</a> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
