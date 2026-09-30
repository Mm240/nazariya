import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiState } from '../hooks';
import { useI18n } from '../i18n';

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton__row">
          <div className="skeleton__bar" />
          <div className="skeleton__line skeleton__line--wide" />
          <div className="skeleton__line" />
        </div>
      ))}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <p className={`notice notice--${tone}`} role={tone === 'warn' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

/** Loading, waking-server and error handling shared by every page. */
export function Loadable<T>({
  state,
  rows,
  children,
}: {
  state: ApiState<T>;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  const { t } = useI18n();
  if (state.data !== undefined) return <>{children(state.data)}</>;
  if (state.error) {
    return (
      <div className="error">
        <p>{t.loadFailed}</p>
        <button type="button" className="button" onClick={state.retry}>
          {t.tryAgain}
        </button>
      </div>
    );
  }
  return (
    <>
      {state.slow && <Notice>{t.waking}</Notice>}
      <Skeleton rows={rows} />
    </>
  );
}

export function EmptyState({ title, body, action = true }: { title: string; body?: string; action?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="empty">
      <h2 className="empty__title">{title}</h2>
      {body && <p>{body}</p>}
      {action && (
        <Link className="button" to="/">
          {t.goHome}
        </Link>
      )}
    </div>
  );
}
