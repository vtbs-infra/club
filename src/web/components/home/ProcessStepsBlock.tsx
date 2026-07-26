import { blockClass, type HomeBlockProperties } from './types';

export function ProcessStepsBlock({ block }: HomeBlockProperties<'process_steps'>) {
  return (
    <section className={blockClass(block)} id={block.id}>
      <div className="home-block-inner">
        <div className="home-section-heading">
          <p className="home-eyebrow">简单四步</p>
          <h2>{block.content.title}</h2>
        </div>
        <ol className="home-process-list">
          {block.content.steps.map((step, index) => (
            <li key={`${step.title}-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
