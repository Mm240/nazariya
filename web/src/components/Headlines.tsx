import { useI18n } from '../i18n';
import { flag, langGroup } from '../lang';
import { HeadlineRef } from '../types';

/** An original headline, credited to its outlet and linking to the source. */
export function HeadlineQuote({ headline, showTime = false }: { headline: HeadlineRef; showTime?: boolean }) {
  const { timeAgo } = useI18n();
  return (
    <li className={`quote quote--${langGroup(headline.language)}`}>
      <span className="quote__outlet">
        {headline.outlet.country && headline.outlet.country !== 'IN' && (
          <span className="flag-emoji" aria-hidden="true">{flag(headline.outlet.country)} </span>
        )}
        {headline.outlet.name}
        {showTime && <span className="quote__time"> {timeAgo(headline.publishedAt)}</span>}
      </span>
      <a className="quote__text" href={headline.url} target="_blank" rel="noopener noreferrer" lang={headline.language} dir="auto">
        {headline.title}
      </a>
    </li>
  );
}

export function HeadlineList({ headlines, showTime = false }: { headlines: HeadlineRef[]; showTime?: boolean }) {
  return (
    <ul className="quotes">
      {headlines.map((h) => (
        <HeadlineQuote key={h.url} headline={h} showTime={showTime} />
      ))}
    </ul>
  );
}
