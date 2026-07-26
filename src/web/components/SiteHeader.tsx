import { Link, NavLink, useNavigate } from 'react-router-dom';

import { signOut } from '../api/identity';
import { useI18n } from '../i18n/context';

interface SiteHeaderProperties {
  readonly authenticated?: boolean;
  readonly platformAdmin?: boolean;
}

export function SiteHeader({ authenticated = false, platformAdmin = false }: SiteHeaderProperties) {
  const navigate = useNavigate();
  const { language, toggleLanguage } = useI18n();

  return (
    <header className="nav">
      <Link className="brand" to="/" aria-label="Club home">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        <span>Club</span>
      </Link>
      <nav className="nav-links" aria-label="Primary navigation">
        <button
          aria-label={language === 'zh-CN' ? '切换到英文' : 'Switch to Chinese'}
          className="language-toggle"
          onClick={toggleLanguage}
          type="button"
        >
          {language === 'zh-CN' ? 'EN' : '中文'}
        </button>
        {authenticated ? (
          <>
            <NavLink to="/organizations">Organizations</NavLink>
            <NavLink to="/claims">Claims</NavLink>
            <NavLink to="/announcements">Notices</NavLink>
            <NavLink to="/account">Account</NavLink>
            {platformAdmin ? (
              <>
                <NavLink to="/platform/operations">Platform</NavLink>
                <NavLink to="/platform/appearance">Appearance</NavLink>
              </>
            ) : null}
            <button
              className="button button-quiet"
              type="button"
              onClick={async () => {
                await signOut();
                await navigate('/login', { replace: true });
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link to="/login">Sign in</Link>
            <Link className="button button-small" to="/register">
              Create account
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
