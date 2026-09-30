import { Loadable } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { useI18n } from '../i18n';
import { Lang, OutletActivity } from '../types';

function OutletTable({ lang, outlets, max }: { lang: Lang; outlets: OutletActivity[]; max: number }) {
  const { t, timeAgo } = useI18n();
  return (
    <section className={`section outlets outlets--${lang}`}>
      <h2 className="section-title">
        {lang === 'en' ? t.englishPress : t.hindiPress} <span className="muted">({outlets.length})</span>
      </h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t.colOutlet}</th>
              <th scope="col">{t.colGroup}</th>
              <th scope="col">{t.colLast24}</th>
              <th scope="col">{t.colLatest}</th>
            </tr>
          </thead>
          <tbody>
            {outlets.map((o) => (
              <tr key={o.slug}>
                <th scope="row">
                  {o.homepage ? (
                    <a href={o.homepage} target="_blank" rel="noopener noreferrer">
                      {o.name}
                    </a>
                  ) : (
                    o.name
                  )}
                  {o.scope === 'international' && <span className="tag">{t.international}</span>}
                </th>
                <td className="muted">{o.mediaGroup ?? ''}</td>
                <td>
                  <span className="activity">
                    <span className="activity__bar" style={{ width: `${max ? (o.articles24h / max) * 100 : 0}%` }} />
                  </span>
                  <span className="activity__label">{t.articles(o.articles24h)}</span>
                </td>
                <td className="muted">{o.lastArticleAt ? timeAgo(o.lastArticleAt) : t.quiet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Outlets() {
  const { t } = useI18n();
  const state = useApi<OutletActivity[]>('/outlets');
  useDocumentTitle(t.outletsTitle);
  return (
    <>
      <header className="page-head">
        <h1 className="page-title">{t.outletsTitle}</h1>
        <p className="page-intro">{t.outletsIntro}</p>
      </header>
      <Loadable state={state} rows={4}>
        {(outlets) => {
          const max = Math.max(0, ...outlets.map((o) => o.articles24h));
          return (
            <>
              <OutletTable lang="en" outlets={outlets.filter((o) => o.language === 'en')} max={max} />
              <OutletTable lang="hi" outlets={outlets.filter((o) => o.language === 'hi')} max={max} />
            </>
          );
        }}
      </Loadable>
    </>
  );
}
