import { mapDebate, mapFraming, outletsOf, pickSampleHeadlines } from './story.mapper';
import { HeadlineRef, Lang } from './story.types';

function h(slug: string, language: Lang): HeadlineRef {
  return {
    title: `${slug} headline`,
    url: `https://${slug}.example`,
    language,
    publishedAt: '2026-09-29T10:00:00Z',
    outlet: { slug, name: slug.toUpperCase(), language, mediaGroup: null },
  };
}

describe('pickSampleHeadlines', () => {
  it('alternates languages, better-covered language first', () => {
    const picked = pickSampleHeadlines([h('a', 'en'), h('b', 'hi'), h('c', 'hi'), h('d', 'hi'), h('e', 'en')]);
    expect(picked.map((x) => x.outlet.slug)).toEqual(['b', 'a', 'c', 'e']);
  });

  it('handles a single language and short lists', () => {
    expect(pickSampleHeadlines([h('a', 'en')]).length).toBe(1);
    expect(pickSampleHeadlines([]).length).toBe(0);
  });
});

describe('outletsOf / mapFraming', () => {
  it('orders English outlets first and drops framing for unknown outlets', () => {
    const outlets = outletsOf([h('zeta', 'hi'), h('beta', 'en'), h('alpha', 'en'), h('beta', 'en')]);
    expect(outlets.map((o) => o.slug)).toEqual(['alpha', 'beta', 'zeta']);
    const framing = mapFraming(
      {
        same_event: true, facts_disputed: false,
        neutral_headline: { en: '', hi: '' }, summary: { en: '', hi: '' },
        common_ground: [], differences: [],
        outlet_framing: [{ outlet: 'beta', en: 'e', hi: 'h' }, { outlet: 'ghost', en: 'e', hi: 'h' }],
      },
      outlets,
    );
    expect(framing).toEqual([{ outlet: outlets[1], text: { en: 'e', hi: 'h' } }]);
  });
});

describe('mapDebate', () => {
  it('resolves outlets and drops arguments from outlets outside the story', () => {
    const outlets = outletsOf([h('alpha', 'en'), h('gamma', 'hi')]);
    const content = {
      same_event: true, facts_disputed: false,
      neutral_headline: { en: '', hi: '' }, summary: { en: '', hi: '' },
      common_ground: [], differences: [], outlet_framing: [],
      debate: {
        question: { en: 'Should it pass?', hi: 'क्या पास होना चाहिए?' },
        for: [{ en: 'Yes', hi: 'हाँ', outlets: ['alpha', 'ghost'] }],
        against: [{ en: 'No', hi: 'नहीं', outlets: ['ghost'] }],
      },
    };
    const debate = mapDebate(content, outlets)!;
    expect(debate.for[0].outlets.map((o) => o.slug)).toEqual(['alpha']);
    expect(debate.against).toEqual([]);
    expect(mapDebate({ ...content, debate: null }, outlets)).toBeNull();
  });
});
