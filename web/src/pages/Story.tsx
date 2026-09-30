import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CoverageBar } from '../components/CoverageBar';
import { HeadlineList } from '../components/Headlines';
import { ShareButton } from '../components/ShareButton';
import { EmptyState, Loadable, Notice } from '../components/States';
import { StoryList, StoryMeta } from '../components/StoryRow';
import { TwoSides } from '../components/TwoSides';
import { Discussion } from '../components/Discussion';
import { ReportProblem } from '../components/ReportProblem';
import { useApi, useDocumentTitle } from '../hooks';
import { pick, storyTitle, useI18n } from '../i18n';
import { HeadlineRef, Lang, OutletRef, RelatedStory, StoryDetail } from '../types';

const CoverageChart = lazy(() => import('../components/CoverageChart'));

interface PressEntry {
  outlet: OutletRef;
  latest: HeadlineRef;
  count: number;
  note: string | null;
}

function Press({ lang, entries, story }: { lang: Lang; entries: PressEntry[]; story: StoryDetail }) {
  const { t, lang: ui, timeAgo } = useI18n();
  return (
    <div className={`press press--${lang}`}>
      <h3 className="press__title">
        {lang === 'en' ? t.englishPress : t.hindiPress}
        <span className="press__count">{t.outletsCount(entries.length)}</span>
      </h3>
      {entries.length === 0 ? (
        <p className="press__empty">{lang === 'en' ? t.onlyHindi : t.onlyEnglish}</p>
      ) : (
        <ul className="press__list">
          {entries.map((e) => (
            <li key={e.outlet.slug} className="outlet-card">
              <p className="outlet-card__name">
                {e.outlet.name}
                {e.outlet.mediaGroup && <span className="outlet-card__group">{t.sisterOf(e.outlet.mediaGroup)}</span>}
                {e.outlet.scope === 'international' && <span className="tag">{t.international}</span>}
              </p>
              <a className="outlet-card__headline" href={e.latest.url} target="_blank" rel="noopener noreferrer" lang={e.latest.language}>
                {e.latest.title}
              </a>
              {e.note ? (
                <p className="outlet-card__note" lang={ui}>
                  {e.note}
                </p>
              ) : (
                story.analysis && <p className="outlet-card__note outlet-card__note--muted">{t.noFramingYet}</p>
              )}
              <p className="outlet-card__time">{timeAgo(e.latest.publishedAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StoryView({ story }: { story: StoryDetail }) {
  const { t, lang, timeAgo } = useI18n();
  const title = storyTitle(story, lang);
  const other: Lang = lang === 'en' ? 'hi' : 'en';
  const a = story.analysis;
  useDocumentTitle(title.text);

  const press = useMemo(() => {
    const notes = new Map((a?.framing ?? []).map((f) => [f.outlet.slug, pick(f.text, lang)]));
    const byOutlet = new Map<string, PressEntry>();
    for (const h of story.articles) {
      const entry = byOutlet.get(h.outlet.slug);
      if (entry) entry.count += 1;
      else byOutlet.set(h.outlet.slug, { outlet: h.outlet, latest: h, count: 1, note: notes.get(h.outlet.slug) ?? null });
    }
    const all = [...byOutlet.values()].sort((x, y) => Number(!x.note) - Number(!y.note) || x.outlet.name.localeCompare(y.outlet.name));
    return { en: all.filter((e) => e.outlet.language === 'en'), hi: all.filter((e) => e.outlet.language === 'hi') };
  }, [story, a, lang]);

  const related = useApi<RelatedStory[]>(`/stories/${story.id}/related`);

  return (
    <article className="story">
      <Link className="back-link" to="/">
        {t.back}
      </Link>
      <CoverageBar outlets={story.outlets} size="lg" animate />
      <header className="story__head">
        <h1 className="story__title" lang={title.lang}>
          {title.text}
        </h1>
        {story.headline && (
          <p className="story__other" lang={other}>
            {story.headline[other]}
          </p>
        )}
        <div className="story__meta-row">
          <StoryMeta story={story} flag={!a} />
          <ShareButton title={title.text} />
        </div>
      </header>

      {story.summary && (
        <p className="story__summary" lang={lang}>
          {pick(story.summary, lang)}
        </p>
      )}
      {a && !a.sameEvent && <Notice tone="warn">{t.mayDiffer}</Notice>}
      {!a && <Notice>{t.pendingExplainer(story.outletCount)}</Notice>}

      {a?.debate && a.sameEvent && <TwoSides storyId={story.id} debate={a.debate} />}

      {a && (
        <section className="compare" aria-label={`${t.agree} / ${t.differ}`}>
          <div className="compare__col compare__col--agree">
            <h2 className="section-title">{t.agree}</h2>
            <ul className="points">
              {a.commonGround.map((p, i) => (
                <li key={i} lang={lang}>
                  {pick(p, lang)}
                </li>
              ))}
            </ul>
          </div>
          <div className="compare__col compare__col--differ">
            <h2 className="section-title">{t.differ}</h2>
            {a.differences.length === 0 ? (
              <p className="muted">{t.noDifferences}</p>
            ) : (
              <ul className="points">
                {a.differences.map((p, i) => (
                  <li key={i} lang={lang}>
                    {pick(p, lang)}
                  </li>
                ))}
              </ul>
            )}
            {a.factsDisputed && <p className="flag flag--block">{t.disputed}</p>}
          </div>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">{t.framing}</h2>
        <div className="press-grid">
          <Press lang="en" entries={press.en} story={story} />
          <Press lang="hi" entries={press.hi} story={story} />
        </div>
      </section>

      {story.timeline.length > 0 && (
        <section className="section">
          <h2 className="section-title">{t.timeline}</h2>
          <Suspense fallback={<div className="chart chart--placeholder" />}>
            <CoverageChart timeline={story.timeline} />
          </Suspense>
        </section>
      )}

      <section className="section">
        <details className="all-articles" open={story.articles.length <= 8}>
          <summary className="section-title">
            {t.everyArticle} <span className="muted">({story.articles.length})</span>
          </summary>
          <HeadlineList headlines={story.articles} showTime />
        </details>
      </section>

      <Discussion storyId={story.id} />

      {related.data && related.data.length > 0 && (
        <section className="section">
          <h2 className="section-title">{t.related}</h2>
          <StoryList stories={related.data.map((r) => r.story)} quotes={0} />
        </section>
      )}

      <ReportProblem storyId={story.id} />
      {a && <p className="ai-note">{t.aiNote(a.model, timeAgo(a.analyzedAt))}</p>}
    </article>
  );
}

export default function Story() {
  const { id } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const valid = id !== undefined && /^\d+$/.test(id);
  const state = useApi<StoryDetail>(valid ? `/stories/${id}` : null);

  // A story merged into another: show the surviving one under its own URL.
  useEffect(() => {
    if (state.data && String(state.data.id) !== id) navigate(`/story/${state.data.id}`, { replace: true });
  }, [state.data, id, navigate]);

  if (!valid || state.error?.status === 404) {
    return <EmptyState title={t.storyGone} body={t.storyGoneBody} />;
  }
  return (
    <Loadable state={state} rows={3}>
      {(story) => <StoryView story={story} />}
    </Loadable>
  );
}
