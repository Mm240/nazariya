import { Link } from 'react-router-dom';
import { API_URL, REPO_URL } from '../config';
import { useApi, useDocumentTitle } from '../hooks';
import { useI18n } from '../i18n';
import { Lang, Stats } from '../types';

const COPY: Record<Lang, {
  title: string;
  intro: string;
  steps: { title: string; body: string }[];
  principlesTitle: string;
  principles: { title: string; body: string }[];
  limitsTitle: string;
  limits: string[];
  liveTitle: string;
  live: (s: Stats) => string[];
  stackTitle: string;
  stack: [string, string][];
  code: string;
}> = {
  en: {
    title: 'How it works',
    intro:
      'Nazariya (नज़रिया) means perspective. It exists because the same event can read very differently depending on which newsroom, and which language, you get it from.',
    steps: [
      {
        title: 'Read',
        body: 'Every 15 minutes a scheduled job reads the public RSS feeds of English and Hindi outlets. It keeps only the headline, a short excerpt and the link.',
      },
      {
        title: 'Group',
        body: 'Each headline becomes a vector with a multilingual embedding model trained so that a sentence and its translation land close together. Headlines about the same event, in either language, are grouped into one story; a slightly lower bar applies across languages, and near-duplicate stories are merged.',
      },
      {
        title: 'Compare',
        body: 'Once at least three outlets cover a story, an AI model reads their headlines and excerpts side by side and writes, in both languages, what they agree on, where they differ, how each outlet framed it and, when the story is a real dispute, the arguments for and against. Every argument must come from the coverage and is credited to the outlets that carried it; nothing is invented to balance the sides.',
      },
      {
        title: 'Show',
        body: 'An API serves the stories to this site. Every claim points back to the original headlines, one click away.',
      },
    ],
    principlesTitle: 'Principles',
    principles: [
      { title: 'No labels', body: 'Outlets are never rated left, right or biased. Readers see what was published and decide.' },
      { title: 'Both sides, only if reported', body: 'For and against lists only arguments the outlets actually carried. When one side is missing from the coverage, the page says so.' },
      { title: 'Source first', body: 'Every headline links to its publisher. Nazariya stores no full articles.' },
      { title: 'Both languages, equal footing', body: 'Hindi coverage is compared with English coverage directly, not as a translation afterthought.' },
    ],
    limitsTitle: 'What it can’t do',
    limits: [
      'It compares headlines and short excerpts, not full articles, so it sees emphasis and wording rather than everything an article says.',
      'Automatic grouping sometimes joins two different events or splits one. Story pages say so when the AI thinks the articles don’t match.',
      'AI summaries can be wrong. They are labelled, dated and always sit next to the original headlines.',
      'Choosing which outlets to follow is an editorial decision. The list spans ownership groups and editorial positions, and is public.',
      'Feeds break or change without notice; the outlets page shows which ones have gone quiet.',
    ],
    liveTitle: 'Right now',
    live: (s) => [
      `${s.articles24h} articles read in the last 24 hours, from ${s.outlets.total} outlets.`,
      `${s.activeStories} stories covered by two or more outlets; ${s.crossLanguageStories} of them in both languages.`,
      s.ai.averageCostPerAnalysisUsd !== null
        ? `${s.ai.analyses24h} AI comparisons written today, at about $${s.ai.averageCostPerAnalysisUsd.toFixed(4)} each.`
        : 'No AI comparisons written in the last 24 hours.',
    ],
    stackTitle: 'Under the hood',
    stack: [
      ['Pipeline', 'Python, feedparser, fastembed (paraphrase-multilingual-MiniLM-L12-v2), online clustering with numpy, Claude for comparisons; runs on GitHub Actions'],
      ['Database', 'PostgreSQL with pgvector (HNSW index for related stories), hosted on Neon'],
      ['API', 'NestJS and TypeScript, response caching, rate limiting, OpenAPI docs'],
      ['Site', 'React, TypeScript, Vite and Recharts, in English and Hindi'],
    ],
    code: 'Read the code and the evaluation method',
  },
  hi: {
    title: 'यह कैसे काम करता है',
    intro:
      'नज़रिया यानी देखने का ढंग। एक ही घटना अलग-अलग न्यूज़रूम में, और अलग-अलग भाषा में, बिल्कुल अलग तरह से पढ़ी जा सकती है। यह साइट उसी फ़र्क़ को सामने रखती है।',
    steps: [
      {
        title: 'पढ़ना',
        body: 'हर 15 मिनट में एक तय प्रक्रिया अंग्रेज़ी और हिंदी संस्थानों की सार्वजनिक RSS फ़ीड पढ़ती है। वह सिर्फ़ शीर्षक, छोटा अंश और लिंक रखती है।',
      },
      {
        title: 'समूह बनाना',
        body: 'हर शीर्षक को एक बहुभाषी एम्बेडिंग मॉडल से वेक्टर में बदला जाता है, जिसे इस तरह प्रशिक्षित किया गया है कि कोई वाक्य और उसका अनुवाद पास-पास आएँ। एक ही घटना के शीर्षक, किसी भी भाषा में, एक ख़बर में जोड़े जाते हैं; भाषाओं के बीच मिलान की सीमा थोड़ी नरम रखी जाती है, और लगभग एक जैसी ख़बरें मिला दी जाती हैं।',
      },
      {
        title: 'तुलना',
        body: 'जब कम से कम तीन संस्थान किसी ख़बर को कवर करते हैं, एक AI मॉडल उनके शीर्षक और अंश साथ रखकर दोनों भाषाओं में लिखता है कि वे किस पर सहमत हैं, कहाँ अलग हैं, हर संस्थान ने ख़बर को कैसे पेश किया और, अगर मुद्दा विवाद का है, तो पक्ष और विपक्ष के तर्क। हर तर्क कवरेज से ही लिया जाता है और उसे छापने वाले संस्थानों के नाम के साथ दिखाया जाता है; पक्षों को बराबर दिखाने के लिए कुछ गढ़ा नहीं जाता।',
      },
      {
        title: 'दिखाना',
        body: 'एक API इन ख़बरों को इस साइट तक पहुँचाता है। हर बात मूल शीर्षकों से जुड़ी है, बस एक क्लिक दूर।',
      },
    ],
    principlesTitle: 'सिद्धांत',
    principles: [
      { title: 'कोई लेबल नहीं', body: 'किसी संस्थान को वामपंथी, दक्षिणपंथी या पक्षपाती नहीं कहा जाता। पाठक देखें कि क्या छपा, और ख़ुद तय करें।' },
      { title: 'दोनों पक्ष, जैसा छपा', body: 'पक्ष और विपक्ष में सिर्फ़ वही तर्क होते हैं जो संस्थानों ने छापे। अगर कवरेज से एक पक्ष ग़ायब है, तो पेज यही बताता है।' },
      { title: 'स्रोत पहले', body: 'हर शीर्षक अपने प्रकाशक से जुड़ा है। नज़रिया कोई पूरा लेख नहीं रखता।' },
      { title: 'दोनों भाषाएँ बराबर', body: 'हिंदी कवरेज की तुलना अंग्रेज़ी से सीधे होती है, अनुवाद के बाद की सोच की तरह नहीं।' },
    ],
    limitsTitle: 'यह क्या नहीं कर सकता',
    limits: [
      'यह पूरे लेख नहीं, शीर्षक और छोटे अंशों की तुलना करता है, इसलिए यह ज़ोर और शब्दों का चुनाव देखता है, लेख की हर बात नहीं।',
      'स्वचालित समूह कभी दो अलग घटनाओं को जोड़ देता है या एक को बाँट देता है। जब AI को लगता है कि लेख मेल नहीं खाते, ख़बर के पेज पर यह लिखा होता है।',
      'AI के सारांश ग़लत हो सकते हैं। उन पर लेबल और समय लिखा होता है, और वे हमेशा मूल शीर्षकों के साथ दिखते हैं।',
      'कौन से संस्थान पढ़े जाएँ, यह एक संपादकीय फ़ैसला है। सूची अलग-अलग स्वामित्व और संपादकीय रुख़ वाले संस्थानों को शामिल करती है, और सार्वजनिक है।',
      'फ़ीड बिना बताए टूट या बदल सकती हैं; संस्थानों वाला पेज दिखाता है कि कौन सी फ़ीड चुप है।',
    ],
    liveTitle: 'इस समय',
    live: (s) => [
      `पिछले 24 घंटों में ${s.outlets.total} संस्थानों के ${s.articles24h} लेख पढ़े गए।`,
      `${s.activeStories} ख़बरें दो या अधिक संस्थानों ने कवर कीं; इनमें से ${s.crossLanguageStories} दोनों भाषाओं में।`,
      s.ai.averageCostPerAnalysisUsd !== null
        ? `आज ${s.ai.analyses24h} AI तुलनाएँ लिखी गईं, हर एक लगभग $${s.ai.averageCostPerAnalysisUsd.toFixed(4)} में।`
        : 'पिछले 24 घंटों में कोई AI तुलना नहीं लिखी गई।',
    ],
    stackTitle: 'तकनीक',
    stack: [
      ['पाइपलाइन', 'Python, feedparser, fastembed (paraphrase-multilingual-MiniLM-L12-v2), numpy से ऑनलाइन क्लस्टरिंग, तुलना के लिए Claude; GitHub Actions पर चलती है'],
      ['डेटाबेस', 'PostgreSQL और pgvector (संबंधित ख़बरों के लिए HNSW इंडेक्स), Neon पर'],
      ['API', 'NestJS और TypeScript, रिस्पॉन्स कैशिंग, रेट लिमिटिंग, OpenAPI दस्तावेज़'],
      ['साइट', 'React, TypeScript, Vite और Recharts, अंग्रेज़ी और हिंदी में'],
    ],
    code: 'कोड और मूल्यांकन का तरीका देखें',
  },
};

export default function About() {
  const { lang, t } = useI18n();
  const c = COPY[lang];
  const stats = useApi<Stats>('/stats');
  useDocumentTitle(c.title);

  return (
    <article className="about">
      <header className="page-head">
        <h1 className="page-title">{c.title}</h1>
        <p className="page-intro">{c.intro}</p>
      </header>

      <ol className="steps">
        {c.steps.map((s, i) => (
          <li key={s.title} className="step">
            <span className="step__num" aria-hidden="true">
              {i + 1}
            </span>
            <h2 className="step__title">{s.title}</h2>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>

      {stats.data && (
        <section className="section live">
          <h2 className="section-title">{c.liveTitle}</h2>
          <ul className="points">
            {c.live(stats.data).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">{c.principlesTitle}</h2>
        <div className="principles">
          {c.principles.map((p) => (
            <div key={p.title} className="principle">
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">{c.limitsTitle}</h2>
        <ul className="points">
          {c.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="section">
        <h2 className="section-title">{c.stackTitle}</h2>
        <dl className="stack">
          {c.stack.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="about__links">
          <a className="button button--primary" href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {c.code}
          </a>
          <a className="button" href={`${API_URL}/api/docs`} target="_blank" rel="noopener noreferrer">
            {t.apiDocs}
          </a>
          <Link className="text-link" to="/outlets">
            {t.nav.outlets}
          </Link>
        </p>
      </section>
    </article>
  );
}
