import type { SiteHomeResponse } from '../../../shared/site-content';
import type { Identity } from '../../api/identity';
import { ActiveCampaignBlock } from './ActiveCampaignBlock';
import { AnnouncementListBlock } from './AnnouncementListBlock';
import { CallToActionBlock } from './CallToActionBlock';
import { CardGroupBlock } from './CardGroupBlock';
import { DividerBlock } from './DividerBlock';
import { GalleryBlock } from './GalleryBlock';
import { HeroBlock } from './HeroBlock';
import { ImageBannerBlock } from './ImageBannerBlock';
import { ImageTextBlock } from './ImageTextBlock';
import { ProcessStepsBlock } from './ProcessStepsBlock';
import { RichTextBlock } from './RichTextBlock';
import { UserTasksBlock } from './UserTasksBlock';

interface HomeRendererProperties {
  readonly home: SiteHomeResponse;
  readonly identity: Identity | null;
}

export function HomeRenderer({ home, identity }: HomeRendererProperties) {
  return (
    <div className="home-renderer">
      {home.content.blocks
        .filter(
          (block) =>
            block.enabled &&
            (block.audience === 'all' ||
              (block.audience === 'anonymous' && !identity) ||
              (block.audience === 'authenticated' && identity)),
        )
        .map((block) => {
          const properties = { block, home, identity };
          switch (block.type) {
            case 'hero':
              return <HeroBlock {...properties} block={block} key={block.id} />;
            case 'user_tasks':
              return <UserTasksBlock {...properties} block={block} key={block.id} />;
            case 'active_campaign':
              return <ActiveCampaignBlock {...properties} block={block} key={block.id} />;
            case 'image_text':
              return <ImageTextBlock {...properties} block={block} key={block.id} />;
            case 'rich_text':
              return <RichTextBlock {...properties} block={block} key={block.id} />;
            case 'announcement_list':
              return <AnnouncementListBlock {...properties} block={block} key={block.id} />;
            case 'process_steps':
              return <ProcessStepsBlock {...properties} block={block} key={block.id} />;
            case 'image_banner':
              return <ImageBannerBlock {...properties} block={block} key={block.id} />;
            case 'card_group':
              return <CardGroupBlock {...properties} block={block} key={block.id} />;
            case 'gallery':
              return <GalleryBlock {...properties} block={block} key={block.id} />;
            case 'cta':
              return <CallToActionBlock {...properties} block={block} key={block.id} />;
            case 'divider':
              return <DividerBlock {...properties} block={block} key={block.id} />;
          }
        })}
    </div>
  );
}
