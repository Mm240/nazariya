import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiSend } from '../api';
import { API_URL } from '../config';
import { useDocumentTitle } from '../hooks';
import { useI18n } from '../i18n';

interface Queue {
  feedback: { id: number; storyId: number; kind: string; note: string | null; createdAt: string; storyTitle: string | null }[];
  comments: {
    id: number;
    storyId: number;
    name: string;
    body: string;
    upvotes: number;
    reports: number;
    hidden: boolean;
    createdAt: string;
  }[];
}

/** Private moderation page. Not linked anywhere; it needs the ADMIN_TOKEN set on the API. */
export default function Admin() {
  const { t, timeAgo } = useI18n();
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem('nazariya:admin') ?? '';
    } catch {
      return '';
    }
  });
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  useDocumentTitle(t.moderation);

  async function load(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/queue`, { headers: { 'X-Admin-Token': token } });
      if (!res.ok) throw new ApiError(res.status, res.statusText);
      setQueue(await res.json());
      try {
        sessionStorage.setItem('nazariya:admin', token);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setQueue(null);
      setError((err as ApiError).status === 403 ? t.wrongToken : t.sendFailed);
    }
  }

  async function act(method: 'POST' | 'DELETE', path: string) {
    try {
      await apiSend(method, path, undefined, { 'X-Admin-Token': token });
      await load();
    } catch {
      setError(t.sendFailed);
    }
  }

  return (
    <div className="admin">
      <header className="page-head">
        <h1 className="page-title">{t.moderation}</h1>
      </header>
      <form className="admin__login" onSubmit={load}>
        <label htmlFor="admin-token" className="visually-hidden">
          {t.adminToken}
        </label>
        <input
          id="admin-token"
          className="input"
          type="password"
          placeholder={t.adminToken}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="current-password"
        />
        <button className="button button--primary" type="submit">
          {t.openQueue}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}

      {queue && (
        <>
          <section className="section">
            <h2 className="section-title">
              {t.openReports} <span className="muted">({queue.feedback.length})</span>
            </h2>
            {queue.feedback.length === 0 && <p className="empty-line">{t.nothingOpen}</p>}
            <ul className="mod-list">
              {queue.feedback.map((f) => (
                <li key={f.id} className="mod-item">
                  <p>
                    <strong>{t.problemKinds[f.kind] ?? f.kind}</strong> <span className="muted">{timeAgo(f.createdAt)}</span>
                  </p>
                  <p>
                    <Link to={`/story/${f.storyId}`}>{f.storyTitle ?? `#${f.storyId}`}</Link>
                  </p>
                  {f.note && <p className="mod-item__note">{f.note}</p>}
                  <button type="button" className="button button--quiet" onClick={() => act('POST', `/admin/feedback/${f.id}/resolve`)}>
                    {t.resolve}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="section">
            <h2 className="section-title">{t.recentComments}</h2>
            <ul className="mod-list">
              {queue.comments.map((c) => (
                <li key={c.id} className={`mod-item${c.hidden ? ' mod-item--hidden' : ''}`}>
                  <p>
                    <strong>{c.name}</strong> <span className="muted">{timeAgo(c.createdAt)}</span>{' '}
                    {c.hidden && <span className="flag">{t.hiddenLabel}</span>}{' '}
                    <span className="muted">
                      ▲ {c.upvotes}, {t.report}: {c.reports}
                    </span>
                  </p>
                  <p className="mod-item__note">{c.body}</p>
                  <p className="mod-item__actions">
                    <Link to={`/story/${c.storyId}`}>#{c.storyId}</Link>
                    {c.hidden ? (
                      <button type="button" className="button button--quiet" onClick={() => act('POST', `/admin/comments/${c.id}/restore`)}>
                        {t.restore}
                      </button>
                    ) : (
                      <button type="button" className="button button--quiet" onClick={() => act('POST', `/admin/comments/${c.id}/hide`)}>
                        {t.hide}
                      </button>
                    )}
                    <button type="button" className="button button--quiet" onClick={() => act('DELETE', `/admin/comments/${c.id}`)}>
                      {t.remove}
                    </button>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
