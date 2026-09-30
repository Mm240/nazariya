import { Loadable } from '../components/States';
import { StoryList } from '../components/StoryRow';
import { useApi, useDocumentTitle } from '../hooks';
import { useI18n } from '../i18n';
import { Blindspots as BlindspotsData } from '../types';

export default function Blindspots() {
  const { t } = useI18n();
  const state = useApi<BlindspotsData>('/stories/blindspots');
  useDocumentTitle(t.blindspotsTitle);
  return (
    <>
      <header className="page-head">
        <h1 className="page-title">{t.blindspotsTitle}</h1>
        <p className="page-intro">{t.blindspotsIntro(state.data?.minOutlets ?? 3)}</p>
      </header>
      <Loadable state={state} rows={4}>
        {(b) =>
          b.onlyHindi.length === 0 && b.onlyEnglish.length === 0 ? (
            <p className="empty-line">{t.noBlindspots}</p>
          ) : (
            <div className="split">
              <section className="split__col split__col--hi">
                <h2 className="section-title">{t.onlyHindi}</h2>
                <p className="muted">{t.onlyHindiNote}</p>
                {b.onlyHindi.length ? <StoryList stories={b.onlyHindi} /> : <p className="empty-line">{t.noBlindspots}</p>}
              </section>
              <section className="split__col split__col--en">
                <h2 className="section-title">{t.onlyEnglish}</h2>
                <p className="muted">{t.onlyEnglishNote}</p>
                {b.onlyEnglish.length ? <StoryList stories={b.onlyEnglish} /> : <p className="empty-line">{t.noBlindspots}</p>}
              </section>
            </div>
          )
        }
      </Loadable>
    </>
  );
}
