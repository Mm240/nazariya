import { Link } from 'react-router-dom';
import { pick, storyTitle, useI18n } from '../i18n';
import { StorySummary } from '../types';
import { CoverageBar } from './CoverageBar';
import { HeadlineList } from './Headlines';
import { VoteBar } from './SidePoll';

export function StoryMeta({ story, flag = true }: { story: StorySummary; flag?: boolean }) {
  const { t, timeAgo } = useI18n();
  return (
    <p className="meta">
      {story.section === 'world' && <span className="tag tag--world">{t.worldTag}</span>}
      {t.coverage(story.coverage.en, story.coverage.hi)}, {t.updated(timeAgo(story.lastArticleAt))}
      {story.commentCount > 0 && <span className="meta__extra">, {t.commentsCount(story.commentCount)}</span>}
      {flag && story.factsDisputed && <span className="flag">{t.disputed}</span>}
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
    <article className="row">
      <CoverageBar outlets={story.outlets} />
      <h3 className="row__title" lang={title.lang}>
        <Link to={`/story/${story.id}`}>{title.text}</Link>
      </h3>
      <StoryMeta story={story} />
      <DebateLine story={story} />
      {quoted.length > 0 && <HeadlineList headlines={quoted} />}
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
