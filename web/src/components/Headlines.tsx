import { useState } from 'react';
import { apiSend } from '../api';
import { useI18n } from '../i18n';
import { flag, langGroup } from '../lang';
import { HeadlineRef } from '../types';

/** An original headline, credited to its outlet and linking to the source. */
export function HeadlineQuote({ headline, showTime = false }: { headline: HeadlineRef; showTime?: boolean }) {
  const { t, lang, timeAgo } = useI18n();
  const [shown, setShown] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  // Only headlines in another language than the reader's interface need translating.
  const canTranslate = headline.language !== lang;

  async function toggle() {
    if (shown !== null) return setShown(null);
    setState('loading');
    try {
      const { translations } = await apiSend<{ translations: string[] }>('POST', '/translate', {
        texts: [headline.title],
        target: lang,
      });
      setShown(translations[0]);
      setState('idle');
    } catch {
      setState('failed');
    }
  }

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
      {canTranslate && (
        <div className="quote__translate">
          {shown !== null && (
            <p className="quote__translation" lang={lang}>
              {shown} <span className="muted">({t.translatedNote})</span>
            </p>
          )}
          <button type="button" className="link-button" onClick={toggle} disabled={state === 'loading'}>
            {state === 'loading' ? t.translating : shown !== null ? t.showOriginal : t.translate}
          </button>
          {state === 'failed' && <span className="form-error"> {t.translateFailed}</span>}
        </div>
      )}
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
