import { blockClass, type HomeBlockProperties } from './types';

export function DividerBlock({ block }: HomeBlockProperties<'divider'>) {
  return (
    <div className={blockClass(block)} role="separator">
      <div className="home-block-inner home-divider">
        {block.content.label ? <span>{block.content.label}</span> : null}
      </div>
    </div>
  );
}
