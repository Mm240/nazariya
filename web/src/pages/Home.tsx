import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CoverageBar } from '../components/CoverageBar';
import { HeadlineList } from '../components/Headlines';
import { Loadable } from '../components/States';
import { LiveUpdates } from '../components/LiveUpdates';
import { VoteBar } from '../components/SidePoll';
import { DebateLine, StoryBadges, StoryList, StoryMeta } from '../components/StoryRow';
import { StoryImage } from '../components/StoryImage';
import { invalidateCache } from '../api';
import { useApi, useDocumentTitle } from '../hooks';
import { pick, storyTitle, useI18n } from '../i18n';
import { Blindspots, Stats, StoryList as StoryListData, StorySummary } from '../types';

const PAGE = 12;

const TOPICS = [
  'all', 'india', 'world', 'politics', 'business', 'sports', 'entertainment', 'technology', 'science', 'health',
] as const;
type Topic = (typeof TOPICS)[number];

/** India / World are geographic sections; the rest are topics. */
function topicQuery(topic: Topic): string {
  if (topic === 'all') return '';
  return topic === 'india' || topic === 'world' ? `&section=${topic}` : `&category=${topic}`;
}
const MAX = 48; // the API returns at most 50 per request

function Intro() {
  const { t, timeAgo } = useI18n();
  const stats = useApi<Stats>('/stats');
  const s = stats.data;
  return (
    <section className="intro">
      <p className="intro__text">{s ? t.intro(s.outlets.total, s.outlets.en, s.outlets.hi, s.outlets.countries) : t.introFallback}</p>
      {s?.lastRun && (
        <p className="intro__meta">
          <span className="live-pill">
            <span className="live-dot" aria-hidden="true" />
            {t.live}
          </span>
          {t.lastUpdated(timeAgo(s.lastRun.finishedAt))}
        </p>
      )}
    </section>
  );
}

function Hero({ story }: { story: StorySummary }) {
  const { t, lang } = useI18n();
  const title = storyTitle(story, lang);
  const other = lang === 'en' ? 'hi' : 'en';
  return (
    <section className="hero" aria-labelledby="hero-title">
      <p className="hero__kicker">{t.mostCovered}</p>
      <CoverageBar outlets={story.outlets} size="lg" animate />
      <StoryImage image={story.image} size="hero" />
      <div className="hero__grid">
        <div className="hero__main">
          <StoryBadges story={story} />
          <h2 id="hero-title" className="hero__title" lang={title.lang} dir="auto">
            <Link to={`/story/${story.id}`}>{title.text}</Link>
          </h2>
          {story.headline && (
            <p className="hero__other" lang={other}>
              {story.headline[other]}
            </p>
          )}
          {story.summary && (
            <p className="hero__summary" lang={lang}>
              {pick(story.summary, lang)}
            </p>
          )}
          <StoryMeta story={story} />
          <DebateLine story={story} />
          <Link className="button button--primary" to={`/story/${story.id}`}>
            {t.readStory}
          </Link>
        </div>
        {story.sampleHeadlines.length > 1 && (
          <div className="hero__quotes">
            <h3 className="subhead">{t.howHeadlined}</h3>
            <HeadlineList headlines={story.sampleHeadlines.filter((h) => h.url !== title.original?.url)} showTime />
          </div>
        )}
      </div>
    </section>
  );
}

function MostDebated({ version }: { version: number }) {
  const { t, lang } = useI18n();
  const state = useApi<StoryListData>(`/stories?debated=true&limit=8${version ? `&v=${version}` : ''}`);
  const items = state.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="debated" aria-labelledby="debated-title">
      <div className="debated__head">
        <h2 id="debated-title" className="section-title">
          {t.mostDebated}
        </h2>
        <p className="muted">{t.mostDebatedIntro}</p>
      </div>
      <div className="debated__track">
        {items.map((s) => {
          const total = s.votes.for + s.votes.against + s.votes.unsure;
          return (
            <Link key={s.id} to={`/story/${s.id}`} className="debate-card">
              <span className="debate-card__vs" aria-hidden="true">
                {t.versus}
              </span>
              <span className="debate-card__question" lang={lang}>
                {s.debate ? pick(s.debate.question, lang) : ''}
              </span>
              <span className="debate-card__foot">
                <VoteBar votes={s.votes} />
                <span>{total ? t.votesCount(total) : t.pickSide}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function BlindspotPreview() {
  const { t } = useI18n();
  const state = useApi<Blindspots>('/stories/blindspots');
  const b = state.data;
  if (!b || (b.onlyHindi.length === 0 && b.onlyEnglish.length === 0)) return null;
  return (
    <aside className="rail" aria-labelledby="rail-title">
      <h2 id="rail-title" className="rail__title">
        {t.blindspotsTitle}
      </h2>
      <p className="rail__intro">{t.blindspotsIntro(b.minOutlets)}</p>
      {b.onlyHindi.length > 0 && (
        <>
          <h3 className="subhead subhead--hi">{t.onlyHindi}</h3>
          <StoryList stories={b.onlyHindi.slice(0, 3)} quotes={0} />
        </>
      )}
      {b.onlyEnglish.length > 0 && (
        <>
          <h3 className="subhead subhead--en">{t.onlyEnglish}</h3>
          <StoryList stories={b.onlyEnglish.slice(0, 3)} quotes={0} />
        </>
      )}
      <Link className="text-link" to="/blindspots">
        {t.seeBlindspots}
      </Link>
    </aside>
  );
}

export default function Home() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<'all' | 'both-languages'>('all');
  const [topic, setTopic] = useState<Topic>('all');
  const [limit, setLimit] = useState(PAGE);
  // Bumped when new stories arrive; the extra query parameter also skips the API's 60-second cache.
  const [version, setVersion] = useState(0);
  const state = useApi<StoryListData>(`/stories?limit=${limit}&filter=${filter}${topicQuery(topic)}${version ? `&v=${version}` : ''}`, true);
  useDocumentTitle(undefined);

  function choose(next: typeof filter) {
    setFilter(next);
    setLimit(PAGE);
  }

  function chooseTopic(next: Topic) {
    setTopic(next);
    setLimit(PAGE);
  }

  return (
    <>
      <LiveUpdates
        onRefresh={() => {
          invalidateCache();
          setVersion(Date.now());
        }}
      />
      <Intro key={version} />
      <Loadable state={state} rows={5}>
        {(data) => {
          if (data.items.length === 0 && filter === 'all' && topic === 'all')
            return <p className="empty-line">{t.emptyHome}</p>;
          const [lead, ...rest] = data.items;
          const showHero = filter === 'all' && topic === 'all' && lead;
          const list = showHero ? rest : data.items;
          return (
            <>
              {showHero && <Hero story={lead} />}
              <MostDebated version={version} />
              <div className="home-grid">
                <section aria-label={t.nav.top}>
                  <div className="filters">
                    <div className="tabs tabs--topics" role="group">
                      {TOPICS.map((k) => (
                        <button key={k} type="button" aria-pressed={topic === k} onClick={() => chooseTopic(k)}>
                          {t.topics[k]}
                        </button>
                      ))}
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={filter === 'both-languages'}
                        onChange={(e) => choose(e.target.checked ? 'both-languages' : 'all')}
                      />
                      <span className="toggle__track" aria-hidden="true" />
                      {t.bothLanguages}
                    </label>
                  </div>
                  {data.items.length === 0 && <p className="empty-line">{t.noMore}</p>}
                  <StoryList stories={list} />
                  {data.items.length >= limit && limit < MAX ? (
                    <button
                      type="button"
                      className="button more"
                      disabled={state.loading}
                      onClick={() => setLimit((n) => Math.min(n + PAGE, MAX))}
                    >
                      {t.moreStories}
                    </button>
                  ) : (
                    <p className="empty-line">{t.noMore}</p>
                  )}
                </section>
                <BlindspotPreview />
              </div>
            </>
          );
        }}
      </Loadable>
    </>
  );
}
