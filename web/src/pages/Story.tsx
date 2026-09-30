import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CoverageBar } from '../components/CoverageBar';
import { HeadlineList } from '../components/Headlines';
import { ShareButton } from '../components/ShareButton';
import { EmptyState, Loadable, Notice } from '../components/States';
import { StoryList, StoryMeta } from '../components/StoryRow';
import { TwoSides } from '../components/TwoSides';
import { AskAssistant } from '../components/AskAssistant';
import { Discussion } from '../components/Discussion';
import { ClaimsBoard } from '../components/ClaimsBoard';
import { countryName, flag, langGroup, languageName } from '../lang';
import { ReportProblem } from '../components/ReportProblem';
import { StoryImage } from '../components/StoryImage';
import { StoryBadges } from '../components/StoryRow';
import { OutletChip } from '../components/ClaimsBoard';
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

function Press({
  lang,
  entries,
  story,
  heading,
  grid = false,
}: {
  /** Colour of the column: a language group, or 'country' when grouping world stories by country. */
  lang: 'en' | 'hi' | 'other' | 'country';
  entries: PressEntry[];
  story: StoryDetail;
  heading?: string;
  /** Lay the cards out in columns (for the single "all coverage" list). */
  grid?: boolean;
}) {
  const { t, lang: ui, timeAgo } = useI18n();
  return (
    <div className={`press press--${lang}`}>
      <h3 className="press__title">
        {heading ?? (lang === 'en' ? t.englishPress : lang === 'hi' ? t.hindiPress : t.otherPress)}
        <span className="press__count">{t.outletsCount(entries.length)}</span>
      </h3>
      {entries.length === 0 ? (
        <p className="press__empty">{lang === 'en' ? t.onlyHindi : t.onlyEnglish}</p>
      ) : (
        <ul className={`press__list${grid ? ' press__list--grid' : ''}`}>
          {entries.map((e) => (
            <li key={e.outlet.slug} className="outlet-card">
              <p className="outlet-card__name">
                {e.outlet.name}
                {e.outlet.mediaGroup && <span className="outlet-card__group">{t.sisterOf(e.outlet.mediaGroup)}</span>}
                {lang !== 'country' && e.outlet.country && e.outlet.country !== 'IN' && (
                  <span className="outlet-card__group" title={t.basedIn(countryName(e.outlet.country, ui))}>
                    {flag(e.outlet.country)} {countryName(e.outlet.country, ui)}
                  </span>
                )}
                {e.outlet.ownership && e.outlet.ownership !== 'private' && (
                  <span className={`tag tag--${e.outlet.ownership}`}>{t.ownership[e.outlet.ownership]}</span>
                )}
                {(lang === 'other' || (lang === 'country' && e.outlet.language !== 'en')) && (
                  <span className="tag">{languageName(e.outlet.language, ui)}</span>
                )}
              </p>
              <a className="outlet-card__headline" href={e.latest.url} target="_blank" rel="noopener noreferrer" lang={e.latest.language} dir="auto">
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

function FirstReports({ story }: { story: StoryDetail }) {
  const { t, lang, timeAgo } = useI18n();
  const [first, ...others] = story.firstReports;
  if (!first || story.outletCount < 2) return null;
  const minutes = (iso: string) => Math.round((Date.parse(iso) - Date.parse(first.publishedAt)) / 60000);
  return (
    <p className="first-reports">
      <span className="first-reports__mark" aria-hidden="true">⏱</span>
      {t.firstReported(first.outlet.name, timeAgo(first.publishedAt))}{' '}
      {others
        .filter((o) => minutes(o.publishedAt) >= 5)
        .slice(0, 3)
        .map((o) => (
          <span key={o.language}>{t.languageFollowed(languageName(o.language, lang), o.outlet.name, t.duration(minutes(o.publishedAt)))} </span>
        ))}
    </p>
  );
}

/** Debated stories: outlets sorted by which side their own coverage leans to. */
function Leanings({ story }: { story: StoryDetail }) {
  const { t, lang } = useI18n();
  const stances = story.analysis?.stances ?? [];
  const latest = new Map<string, HeadlineRef>();
  for (const h of story.articles) if (!latest.has(h.outlet.slug)) latest.set(h.outlet.slug, h);
  const columns = [
    { key: 'for', title: t.leanFor },
    { key: 'against', title: t.leanAgainst },
    { key: 'neutral', title: t.leanNeutral },
  ] as const;
  return (
    <section className="section leanings" aria-labelledby="leanings-title">
      <h2 id="leanings-title" className="section-title">
        {t.leaningTitle}
      </h2>
      <p className="muted leanings__intro">
        {story.analysis?.debate && <strong lang={lang}>{pick(story.analysis.debate.question, lang)} </strong>}
        {t.leaningIntro}
      </p>
      <div className="leanings__grid">
        {columns.map((col) => {
          const items = stances.filter((s) => s.stance === col.key);
          return (
            <div key={col.key} className={`leaning leaning--${col.key}`}>
              <h3 className="leaning__title">
                {col.title} <span className="press__count">{t.outletsCount(items.length)}</span>
              </h3>
              <ul className="leaning__list">
                {items.map((s) => {
                  const h = latest.get(s.outlet.slug);
                  return (
                    <li key={s.outlet.slug} className="outlet-card">
                      <p className="outlet-card__name">
                        <OutletChip outlet={s.outlet} />
                      </p>
                      {h && (
                        <a className="outlet-card__headline" href={h.url} target="_blank" rel="noopener noreferrer" lang={h.language} dir="auto">
                          {h.title}
                        </a>
                      )}
                      <p className="outlet-card__note" lang={lang}>
                        {pick(s.reason, lang)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HeadlineEdits({ story }: { story: StoryDetail }) {
  const { t, timeAgo } = useI18n();
  if (story.headlineEdits.length === 0) return null;
  return (
    <section className="section edits" aria-labelledby="edits-title">
      <h2 id="edits-title" className="section-title">
        ✎ {t.editsTitle}
      </h2>
      <p className="muted edits__intro">{t.editsIntro}</p>
      <ul className="edits__list">
        {story.headlineEdits.map((e, i) => (
          <li key={i} className="edit">
            <p className="edit__meta">
              <OutletChip outlet={e.outlet} /> <span className="muted">{timeAgo(e.seenAt)}</span>
            </p>
            <p className="edit__old" dir="auto">
              <del>{e.oldTitle}</del>
            </p>
            <p className="edit__new" dir="auto">
              <a href={e.url} target="_blank" rel="noopener noreferrer">
                {e.newTitle}
              </a>
            </p>
          </li>
        ))}
      </ul>
    </section>
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
    // World stories are compared country by country (each side's media); Indian stories by language.
    const byCountry = new Map<string, PressEntry[]>();
    for (const e of all) {
      const c = e.outlet.country ?? 'IN';
      byCountry.set(c, [...(byCountry.get(c) ?? []), e]);
    }
    const countries = [...byCountry.entries()].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]));
    return {
      all,
      en: all.filter((e) => langGroup(e.outlet.language) === 'en'),
      hi: all.filter((e) => langGroup(e.outlet.language) === 'hi'),
      other: all.filter((e) => langGroup(e.outlet.language) === 'other'),
      countries,
      // Compare by country when the story is international news or at least two foreign outlets cover it.
      compareCountries:
        countries.length >= 2 &&
        (story.section === 'world' || all.filter((e) => (e.outlet.country ?? 'IN') !== 'IN').length >= 2),
    };
  }, [story, a, lang]);

  const related = useApi<RelatedStory[]>(`/stories/${story.id}/related`);

  return (
    <article className="story">
      <Link className="back-link" to="/">
        {t.back}
      </Link>
      <CoverageBar outlets={story.outlets} size="lg" animate />
      <StoryImage image={story.image} size="hero" />
      <header className="story__head">
        <StoryBadges story={story} />
        <h1 className="story__title" lang={title.lang} dir="auto">
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
      <FirstReports story={story} />
      {a && !a.sameEvent && <Notice tone="warn">{t.mayDiffer}</Notice>}
      {!a && <Notice>{t.pendingExplainer(story.outletCount)}</Notice>}

      {a && a.sameEvent && a.claims.length > 0 && <ClaimsBoard claims={a.claims} />}

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

      {a && a.sameEvent && a.debate && a.stances.length > 0 && <Leanings story={story} />}

      <section className="section">
        <h2 className="section-title">{press.compareCountries ? t.framingByCountry : t.allCoverage}</h2>
        {press.compareCountries ? (
          <div className="press-grid press-grid--countries">
            {press.countries.map(([code, entries]) => (
              <Press
                key={code}
                lang="country"
                entries={entries}
                story={story}
                heading={`${flag(code)} ${countryName(code, lang)}`}
              />
            ))}
          </div>
        ) : (
          <Press lang="country" entries={press.all} story={story} heading={t.outletsCount(press.all.length)} grid />
        )}
      </section>

      <HeadlineEdits story={story} />

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

      <AskAssistant storyId={story.id} />

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
