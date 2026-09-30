import { FormEvent, useState } from 'react';
import { ApiError, apiSend } from '../api';
import { useApi } from '../hooks';
import { useI18n } from '../i18n';
import { CommentView } from '../types';

const MAX = 1000;

function Comment({ comment, onChange }: { comment: CommentView; onChange: (c: CommentView | null) => void }) {
  const { t, timeAgo } = useI18n();
  const [busy, setBusy] = useState(false);

  async function upvote() {
    setBusy(true);
    try {
      const r = await apiSend<{ upvotes: number; upvotedByMe: boolean }>('POST', `/comments/${comment.id}/upvote`);
      onChange({ ...comment, ...r });
    } catch {
      /* ignore: the count simply doesn't change */
    } finally {
      setBusy(false);
    }
  }

  async function report() {
    setBusy(true);
    try {
      const r = await apiSend<{ hidden: boolean }>('POST', `/comments/${comment.id}/report`);
      onChange(r.hidden ? null : { ...comment, reportedByMe: true });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="comment">
      <p className="comment__meta">
        <span className="comment__name">{comment.name}</span>
        <span className="comment__time">{timeAgo(comment.createdAt)}</span>
      </p>
      <p className="comment__body">{comment.body}</p>
      <div className="comment__actions">
        <button
          type="button"
          className="comment__upvote"
          aria-pressed={comment.upvotedByMe}
          aria-label={`${t.upvote} (${comment.upvotes})`}
          disabled={busy}
          onClick={upvote}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4l8 10h-5v6H9v-6H4z" />
          </svg>
          {comment.upvotes}
        </button>
        <button type="button" className="comment__report" disabled={busy || comment.reportedByMe} onClick={report}>
          {comment.reportedByMe ? t.reported : t.report}
        </button>
      </div>
    </li>
  );
}

export function Discussion({ storyId }: { storyId: number }) {
  const { t } = useI18n();
  const [sort, setSort] = useState<'new' | 'top'>('new');
  const state = useApi<CommentView[]>(`/stories/${storyId}/comments?sort=${sort}`, true, true);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const comments = state.data ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (body.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiSend<CommentView | null>('POST', `/stories/${storyId}/comments`, { name, body, website });
      if (created) state.setData([created, ...comments]);
      setBody('');
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.status === 429 ? t.tooFast : e2.status === 400 ? e2.message : t.sendFailed);
    } finally {
      setBusy(false);
    }
  }

  function replace(id: number, next: CommentView | null) {
    if (!next) setNotice(t.hiddenAfterReports);
    state.setData(next ? comments.map((c) => (c.id === id ? next : c)) : comments.filter((c) => c.id !== id));
  }

  return (
    <section className="section discussion" aria-labelledby="discussion-title">
      <div className="discussion__head">
        <h2 id="discussion-title" className="section-title">
          {t.discussion} <span className="muted">({comments.length})</span>
        </h2>
        <div className="tabs tabs--small" role="group">
          <button type="button" aria-pressed={sort === 'new'} onClick={() => setSort('new')}>
            {t.newest}
          </button>
          <button type="button" aria-pressed={sort === 'top'} onClick={() => setSort('top')}>
            {t.top}
          </button>
        </div>
      </div>
      <p className="muted discussion__rules">{t.guidelines}</p>

      <form className="comment-form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="comment-name">
          {t.yourName}
        </label>
        <input
          id="comment-name"
          className="input"
          value={name}
          maxLength={40}
          placeholder={t.yourName}
          onChange={(e) => setName(e.target.value)}
          autoComplete="nickname"
        />
        <label className="visually-hidden" htmlFor="comment-body">
          {t.yourComment}
        </label>
        <textarea
          id="comment-body"
          className="input"
          rows={3}
          value={body}
          maxLength={MAX}
          placeholder={t.commentPlaceholder}
          onChange={(e) => setBody(e.target.value)}
          required
        />
        {/* Honeypot: invisible to people, tempting to bots. */}
        <input
          className="honeypot"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          name="website"
        />
        <div className="comment-form__row">
          <span className="muted">{t.charsLeft(MAX - body.length)}</span>
          <button type="submit" className="button button--primary" disabled={busy || body.trim().length < 2}>
            {busy ? t.posting : t.postComment}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>

      {notice && <p className="notice">{notice}</p>}
      {state.data && comments.length === 0 && <p className="empty-line">{t.noComments}</p>}
      <ul className="comments">
        {comments.map((c) => (
          <Comment key={c.id} comment={c} onChange={(next) => replace(c.id, next)} />
        ))}
      </ul>
    </section>
  );
}
