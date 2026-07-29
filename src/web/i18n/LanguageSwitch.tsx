import { useI18n } from './context';

export function LanguageSwitch({ compact = false }: { readonly compact?: boolean }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className={compact ? 'language-switch compact' : 'language-switch'} role="group">
      <span className="sr-only">{t('切换语言', 'Switch language')}</span>
      <button
        aria-pressed={language === 'zh-CN'}
        onClick={() => setLanguage('zh-CN')}
        type="button"
      >
        中文
      </button>
      <button aria-pressed={language === 'en'} onClick={() => setLanguage('en')} type="button">
        EN
      </button>
    </div>
  );
}
