import { pick, useI18n } from '../i18n';
import { Argument, Bilingual } from '../types';
import { SidePoll } from './SidePoll';
import { OutletChip } from './ClaimsBoard';

function Side({ kind, points }: { kind: 'for' | 'against'; points: Argument[] }) {
  const { t, lang } = useI18n();
  return (
    <div className={`side side--${kind}`}>
      <h3 className="side__title">
        <span className="side__mark" aria-hidden="true">
          {kind === 'for' ? '+' : '−'}
        </span>
        {kind === 'for' ? t.forSide : t.againstSide}
        <span className="side__hint">{kind === 'for' ? t.forHint : t.againstHint}</span>
      </h3>
      {points.length === 0 ? (
        <p className="side__empty">{t.oneSided}</p>
      ) : (
        <ul className="side__list">
          {points.map((p, i) => (
            <li key={i} className="argument">
              <p lang={lang}>{pick(p.text, lang)}</p>
              <p className="argument__sources">
                {p.outlets.map((o) => (
                  <OutletChip key={o.slug} outlet={o} />
                ))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TwoSides({
  storyId,
  debate,
}: {
  storyId: number;
  debate: { question: Bilingual; for: Argument[]; against: Argument[] };
}) {
  const { t, lang } = useI18n();
  return (
    <section className="two-sides" aria-labelledby="two-sides-title">
      <p id="two-sides-title" className="two-sides__label">
        {t.twoSides}
      </p>
      <h2 className="two-sides__question" lang={lang}>
        {pick(debate.question, lang)}
      </h2>
      <div className="two-sides__grid">
        <Side kind="for" points={debate.for} />
        <span className="two-sides__vs" aria-hidden="true">
          {t.versus}
        </span>
        <Side kind="against" points={debate.against} />
      </div>
      <p className="two-sides__note">{t.twoSidesNote}</p>
      <SidePoll storyId={storyId} />
    </section>
  );
}
