import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export function ProductBrand({
  className,
  context,
  to = '/',
}: {
  readonly className?: string;
  readonly context?: string;
  readonly to?: string;
}) {
  return (
    <Link className={['brand', className].filter(Boolean).join(' ')} to={to}>
      <span className="brand-mark" aria-hidden="true">
        <Sparkles size={18} strokeWidth={2.35} />
      </span>
      <span className="brand-name">Club</span>
      {context ? <small>{context}</small> : null}
    </Link>
  );
}
