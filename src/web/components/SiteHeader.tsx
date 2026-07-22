import { Link, NavLink, useNavigate } from 'react-router-dom';

import { signOut } from '../api/identity';

interface SiteHeaderProperties {
  readonly authenticated?: boolean;
  readonly platformAdmin?: boolean;
}

export function SiteHeader({ authenticated = false, platformAdmin = false }: SiteHeaderProperties) {
  const navigate = useNavigate();

  return (
    <header className="nav">
      <Link className="brand" to="/" aria-label="Club home">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        <span>Club</span>
      </Link>
      <nav className="nav-links" aria-label="Primary navigation">
        {authenticated ? (
          <>
            <NavLink to="/organizations">Organizations</NavLink>
            <NavLink to="/account">Account</NavLink>
            {platformAdmin ? <NavLink to="/platform/verification-rooms">Platform</NavLink> : null}
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
