import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../api';
import { useI18n } from '../i18n';
import { Stats } from '../types';

const CHECK_EVERY_MS = 60_000;

/**
 * Checks once a minute whether the pipeline has finished a new run since the page
 * loaded, and offers to show the new stories (without yanking the page from under the reader).
 */
export function LiveUpdates({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useI18n();
  const seen = useRef<string | null>(null);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function check() {
      if (document.hidden) return;
      try {
        const stats = await apiGet<Stats>('/stats');
        const latest = stats.lastRun?.finishedAt ?? null;
        if (seen.current === null) seen.current = latest;
        else if (latest && latest !== seen.current && !stopped) setFresh(true);
      } catch {
        /* offline or server asleep: try again next minute */
      }
    }
    void check();
    const id = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  if (!fresh) return null;
  return (
    <div className="live-banner" role="status">
      <span className="live-dot" aria-hidden="true" />
      <span>{t.newStories}</span>
      <button
        type="button"
        className="button button--primary"
        onClick={() => {
          apiGet<Stats>('/stats').then((s) => (seen.current = s.lastRun?.finishedAt ?? seen.current)).catch(() => {});
          setFresh(false);
          onRefresh();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      >
        {t.showNew}
      </button>
    </div>
  );
}
