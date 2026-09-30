import { Link } from 'react-router-dom';
import { pick, storyTitle, useI18n } from '../i18n';
import { countryName, flag } from '../lang';
import { StorySummary } from '../types';
import { CoverageBar } from './CoverageBar';
import { HeadlineList } from './Headlines';
import { VoteBar } from './SidePoll';
import { StoryImage } from './StoryImage';

export function StoryMeta({ story, flag: showFlag = true }: { story: StorySummary; flag?: boolean }) {
  const { t, timeAgo, lang } = useI18n();
  const countries = [...new Set(story.outlets.map((o) => o.country ?? 'IN'))];
  return (
    <p className="meta">
      {countries.length > 1 && (story.section === 'world' || story.outlets.filter((o) => (o.country ?? 'IN') !== 'IN').length >= 2) && (
        <span className="meta__flags" title={`${t.coveredFrom}: ${countries.map((c) => countryName(c, lang)).join(', ')}`}>
          {countries.map((c) => flag(c)).join(' ')}{' '}
        </span>
      )}
      {story.section === 'world' && <span className="tag tag--world">{t.worldTag}</span>}
      {t.coverage(story.coverage.en, story.coverage.hi, story.coverage.other)}, {t.updated(timeAgo(story.lastArticleAt))}
      {story.commentCount > 0 && <span className="meta__extra">, {t.commentsCount(story.commentCount)}</span>}
      {showFlag && story.factsDisputed && <span className="flag">{t.disputed}</span>}
    </p>
  );
}

/** Topic, "Breaking" (new and widely covered) and "Headline changed" badges. */
export function StoryBadges({ story }: { story: StorySummary }) {
  const { t } = useI18n();
  const fresh = Date.now() - Date.parse(story.firstSeenAt) < 3 * 3_600_000 && story.outletCount >= 3;
  if (!story.category && !fresh && !story.headlineEdited) return null;
  return (
    <p className="badges">
      {fresh && (
        <span className="badge badge--breaking">
          <span className="live-dot" aria-hidden="true" />
          {t.breaking}
        </span>
      )}
      {story.category && <span className="badge">{t.topics[story.category] ?? story.category}</span>}
      {story.headlineEdited && <span className="badge badge--edited">✎ {t.edited}</span>}
    </p>
  );
}

export function DebateLine({ story }: { story: StorySummary }) {
  const { t, lang } = useI18n();
  if (!story.debate) return null;
  return (
    <p className="debate-line">
      <span className="debate-tag">{t.debated}</span>
      <span lang={lang}>{pick(story.debate.question, lang)}</span>
      <span className="debate-count">{t.argumentCount(story.debate.forCount, story.debate.againstCount)}</span>
      {story.votes.for + story.votes.against + story.votes.unsure > 0 && (
        <span className="debate-votes">
          <VoteBar votes={story.votes} />
          {t.votesCount(story.votes.for + story.votes.against + story.votes.unsure)}
        </span>
      )}
    </p>
  );
}

export function StoryRow({ story, quotes = 2 }: { story: StorySummary; quotes?: number }) {
  const { lang } = useI18n();
  const title = storyTitle(story, lang);
  // Until a story is analysed its title *is* an original headline; don't quote it twice.
  const quoted = story.sampleHeadlines.filter((h) => h.url !== title.original?.url).slice(0, quotes);
  return (
    <article className={`row${story.image ? ' row--with-image' : ''}`}>
      <div className="row__body">
      <CoverageBar outlets={story.outlets} />
      <StoryBadges story={story} />
      <h3 className="row__title" lang={title.lang} dir="auto">
        <Link to={`/story/${story.id}`}>{title.text}</Link>
      </h3>
      <StoryMeta story={story} />
      <DebateLine story={story} />
      {quoted.length > 0 && <HeadlineList headlines={quoted} />}
      </div>
      <StoryImage image={story.image} size="thumb" />
    </article>
  );
}

export function StoryList({ stories, quotes = 2 }: { stories: StorySummary[]; quotes?: number }) {
  return (
    <div className="rows">
      {stories.map((s) => (
        <StoryRow key={s.id} story={s} quotes={quotes} />
      ))}
    </div>
  );
}
