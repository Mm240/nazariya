import { pick, useI18n } from '../i18n';
import { countryName, flag } from '../lang';
import { Claim, OutletRef } from '../types';

const ORDER: Claim['status'][] = ['disputed', 'one_sided', 'confirmed'];
const ICON: Record<Claim['status'], string> = { confirmed: '●', one_sided: '◐', disputed: '◑' };

export function OutletChip({ outlet }: { outlet: OutletRef }) {
  const { t, lang } = useI18n();
  const where = countryName(outlet.country, lang);
  return (
    <span
      className={`chip chip--${outlet.language === 'en' || outlet.language === 'hi' ? outlet.language : 'other'}`}
      title={[where && t.basedIn(where), outlet.ownership && t.ownership[outlet.ownership]].filter(Boolean).join(' · ')}
    >
      {outlet.country && <span aria-hidden="true">{flag(outlet.country)} </span>}
      {outlet.name}
      {outlet.ownership === 'state' && <span className="chip__state"> {t.ownership.state}</span>}
    </span>
  );
}

/** Who claims what: every claim with its source, carriers and sourcing status. */
export function ClaimsBoard({ claims }: { claims: Claim[] }) {
  const { t, lang } = useI18n();
  const sorted = [...claims].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  return (
    <section className="section claims" aria-labelledby="claims-title">
      <h2 id="claims-title" className="section-title">
        {t.claimsTitle}
      </h2>
      <p className="muted claims__intro">{t.claimsIntro}</p>
      <ul className="claims__list">
        {sorted.map((c, i) => (
          <li key={i} className={`claim claim--${c.status}`}>
            <p className="claim__status">
              <span aria-hidden="true">{ICON[c.status]}</span> {t.status[c.status]}
            </p>
            <p className="claim__text" lang={lang}>
              {pick(c.claim, lang)}
            </p>
            <p className="claim__by">
              <span className="muted">{t.claimedBy}:</span> <strong lang={lang}>{pick(c.claimedBy, lang)}</strong>
            </p>
            <p className="claim__sources">
              <span className="muted">{t.carriedBy}:</span>
              {c.outlets.map((o) => (
                <OutletChip key={o.slug} outlet={o} />
              ))}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
