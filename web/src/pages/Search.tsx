import { useSearchParams } from 'react-router-dom';
import { Loadable } from '../components/States';
import { StoryList } from '../components/StoryRow';
import { useApi, useDocumentTitle } from '../hooks';
import { useI18n } from '../i18n';
import { StorySummary } from '../types';

export default function Search() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const ok = q.length >= 2 && q.length <= 80;
  const state = useApi<StorySummary[]>(ok ? `/stories/search?q=${encodeURIComponent(q)}` : null);
  useDocumentTitle(ok ? t.resultsFor(q) : t.searchTitle);

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">{ok ? t.resultsFor(q) : t.searchTitle}</h1>
        {!ok && <p className="page-intro">{t.searchHint}</p>}
      </header>
      {ok && (
        <Loadable state={state} rows={3}>
          {(items) => (items.length ? <StoryList stories={items} /> : <p className="empty-line">{t.noResults(q)}</p>)}
        </Loadable>
      )}
    </>
  );
}
