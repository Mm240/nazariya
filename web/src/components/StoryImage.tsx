import { useState } from 'react';
import { useI18n } from '../i18n';
import { StorySummary } from '../types';

/**
 * The picture an outlet published with its article, shown credited and linked to the source.
 * Hotlinked (never copied); hidden quietly if the publisher's server refuses it.
 */
export function StoryImage({ image, size = 'card' }: { image: StorySummary['image']; size?: 'card' | 'hero' | 'thumb' }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  if (!image || failed) return null;
  return (
    <figure className={`story-image story-image--${size}`}>
      <a href={image.articleUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        <img
          src={image.url}
          alt=""
          loading={size === 'hero' ? 'eager' : 'lazy'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </a>
      {size !== 'thumb' && <figcaption>{t.imageCredit(image.outlet)}</figcaption>}
    </figure>
  );
}
