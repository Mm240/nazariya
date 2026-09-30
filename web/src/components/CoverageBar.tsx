import { CSSProperties } from 'react';
import { useI18n } from '../i18n';
import { langGroup } from '../lang';
import { OutletRef } from '../types';

interface Props {
  outlets: OutletRef[];
  size?: 'sm' | 'md' | 'lg';
  /** Draw the segments in, left to right. Used once per page, on its main story. */
  animate?: boolean;
}

/**
 * The shirorekha: in Devanagari, letters hang from a horizontal stroke. Here a
 * story's title hangs from a bar with one segment per outlet that covered it,
 * English in cobalt and Hindi in raspberry.
 */
export function CoverageBar({ outlets, size = 'sm', animate = false }: Props) {
  const { t } = useI18n();
  const en = outlets.filter((o) => o.language === 'en').length;
  const hi = outlets.filter((o) => o.language === 'hi').length;
  const other = outlets.length - en - hi;
  return (
    <div
      className={`bar bar--${size}${animate ? ' bar--draw' : ''}`}
      style={{ '--n': outlets.length } as CSSProperties}
      role="img"
      aria-label={t.coverageLabel(en, hi, other)}
    >
      {outlets.map((o, i) => (
        <span
          key={o.slug}
          className={`bar__seg bar__seg--${langGroup(o.language)}`}
          style={{ '--i': i } as CSSProperties}
          title={`${o.name} (${o.language})`}
        />
      ))}
    </div>
  );
}
