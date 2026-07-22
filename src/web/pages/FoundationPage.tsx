import { useQuery } from '@tanstack/react-query';

import { fetchReadiness } from '../api/health';

const foundations = [
  'Fastify API with TypeBox contracts',
  'PostgreSQL readiness and migrations',
  'Private atomic local storage',
  'Single-process production delivery',
];

export function FoundationPage() {
  const readiness = useQuery({
    queryFn: fetchReadiness,
    queryKey: ['system', 'readiness'],
    refetchInterval: 10_000,
    retry: false,
  });

  const status = readiness.data?.status;
  const statusLabel = readiness.isPending
    ? 'Checking services'
    : status === 'ok'
      ? 'Foundation ready'
      : 'Setup required';

  return (
    <main className="shell">
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="Club home">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span>Club</span>
        </a>
        <span className="milestone">Milestone 0</span>
      </nav>

      <section className="hero">
        <div className="eyebrow">OPEN-SOURCE · SELF-HOSTED</div>
        <h1>
          Community gifts,
          <br />
          handled with care.
        </h1>
        <p className="lede">
          A dependable home for Bilibili guard eligibility, claims, fulfillment, and shipment
          tracking—built for creators and their communities.
        </p>

        <div className="status-card" aria-live="polite">
          <span
            className={`status-dot ${status === 'ok' ? 'status-dot-ready' : ''}`}
            aria-hidden="true"
          />
          <div>
            <strong>{statusLabel}</strong>
            <span>
              {status === 'ok'
                ? 'Database and private storage are responding.'
                : 'The application shell is running. Check service configuration.'}
            </span>
          </div>
        </div>
      </section>

      <section className="foundation" aria-labelledby="foundation-title">
        <div>
          <p className="section-kicker">THE FOUNDATION</p>
          <h2 id="foundation-title">A small, production-shaped core.</h2>
        </div>
        <ul>
          {foundations.map((item, index) => (
            <li key={item}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
