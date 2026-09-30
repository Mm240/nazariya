import { useState } from 'react';
import { ApiError, apiSend } from '../api';
import { useApi } from '../hooks';
import { useI18n } from '../i18n';
import { Side, VoteSummary } from '../types';

const SIDES: Side[] = ['for', 'against', 'unsure'];

/** "Where do you stand?": vote first, then see how other readers answered. */
export function SidePoll({ storyId }: { storyId: number }) {
  const { t } = useI18n();
  const state = useApi<VoteSummary>(`/stories/${storyId}/votes`, false, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = state.data;
  const labels: Record<Side, string> = { for: t.voteFor, against: t.voteAgainst, unsure: t.voteUnsure };

  async function vote(side: Side) {
    setBusy(true);
    setError(null);
    try {
      state.setData(await apiSend<VoteSummary>('POST', `/stories/${storyId}/votes`, { side }));
    } catch (err) {
      setError((err as ApiError).status === 429 ? t.tooFast : t.sendFailed);
    } finally {
      setBusy(false);
    }
  }

  const total = v ? v.for + v.against + v.unsure : 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <div className="poll">
      <p className="poll__title">{t.whereStand}</p>
      <div className="poll__buttons" role="group" aria-label={t.whereStand}>
        {SIDES.map((side) => (
          <button
            key={side}
            type="button"
            className={`poll__button poll__button--${side}`}
            aria-pressed={v?.mine === side}
            disabled={busy || !v}
            onClick={() => vote(side)}
          >
            {labels[side]}
          </button>
        ))}
      </div>
      {v?.mine && total > 0 && (
        <div className="poll__results" aria-live="polite">
          <div className="poll__bar" role="img" aria-label={SIDES.map((s) => `${labels[s]} ${pct(v[s])}%`).join(', ')}>
            {SIDES.map((s) =>
              v[s] > 0 ? <span key={s} className={`poll__seg poll__seg--${s}`} style={{ flexGrow: v[s] }} /> : null,
            )}
          </div>
          <ul className="poll__legend">
            {SIDES.map((s) => (
              <li key={s} className={`poll__legend-item poll__legend-item--${s}`}>
                <strong>{pct(v[s])}%</strong> {labels[s]}
                {v.mine === s && <span className="poll__mine"> ({t.yourVote})</span>}
              </li>
            ))}
          </ul>
          <p className="poll__note">
            {t.readersSaid(total)}. {t.changeVote} {t.pollNote}
          </p>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** Compact result bar for story cards. */
export function VoteBar({ votes }: { votes: { for: number; against: number; unsure: number } }) {
  const total = votes.for + votes.against + votes.unsure;
  if (!total) return <span className="vote-bar vote-bar--empty" aria-hidden="true" />;
  return (
    <span className="vote-bar" aria-hidden="true">
      {(['for', 'against', 'unsure'] as const).map((s) =>
        votes[s] ? <span key={s} className={`poll__seg poll__seg--${s}`} style={{ flexGrow: votes[s] }} /> : null,
      )}
    </span>
  );
}
