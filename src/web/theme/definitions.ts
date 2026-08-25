import { THEME_PRESETS, type ThemePreset } from '../../shared/contracts/appearance';

export interface ThemeDefinition {
  readonly description: string;
  readonly id: ThemePreset;
  readonly name: string;
  readonly swatches: readonly [string, string, string];
  readonly themeColor: string;
}

export const THEME_DEFINITIONS = {
  archive: {
    description: '米色纸张、深蓝墨色与克制红金，像一份认真保存的礼物档案。',
    id: 'archive',
    name: '舰长礼物档案馆',
    swatches: ['#efe7d7', '#34577a', '#b84b4b'],
    themeColor: '#efe7d7',
  },
  moe: {
    description: '明亮蓝粉、柔和渐变与轻盈表面，是 Club 当前的元气基线。',
    id: 'moe',
    name: '超元气补给站',
    swatches: ['#f4f7fb', '#1777b5', '#ff9fbd'],
    themeColor: '#f4f7fb',
  },
  neon: {
    description: '深色控制台配合紫青高光，保留直播间氛围但不过度发光。',
    id: 'neon',
    name: '直播间控制台',
    swatches: ['#080b16', '#8a7dff', '#50e6ff'],
    themeColor: '#080b16',
  },
  pixel: {
    description: '深紫底、青粉强调和阶梯阴影，像一艘清晰利落的像素补给舰。',
    id: 'pixel',
    name: '像素补给舰',
    swatches: ['#130d24', '#54d9ff', '#ff75cf'],
    themeColor: '#130d24',
  },
} satisfies Record<ThemePreset, ThemeDefinition>;

export const THEME_OPTIONS = THEME_PRESETS.map((preset) => THEME_DEFINITIONS[preset]);
