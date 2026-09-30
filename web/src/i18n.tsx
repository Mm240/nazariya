import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { load, save } from './storage';
import { Bilingual, HeadlineRef, Lang, StorySummary } from './types';

const en = {
  skip: 'Skip to content',
  tagline: 'Same news. Different story.',
  nav: { top: 'Top stories', blindspots: 'Blindspots', outlets: 'Outlets', about: 'How it works' },
  searchLabel: 'Search headlines',
  searchPlaceholder: 'Search headlines',
  switchLanguage: 'हिंदी में पढ़ें',
  themeToDark: 'Switch to dark mode',
  themeToLight: 'Switch to light mode',

  intro: (outlets: number, _en: number, _hi: number, countries = 1) =>
    `${outlets} newsrooms in ${countries} ${countries === 1 ? 'country' : 'countries'}, from India's English and Hindi press to both sides of world conflicts, read every 15 minutes. Headlines about the same event are put side by side so you can see where coverage agrees and where it doesn't.`,
  introFallback:
    'English and Hindi newsrooms, read every 15 minutes. Headlines about the same event are put side by side so you can see where coverage agrees and where it doesn’t.',
  lastUpdated: (time: string) => `Last checked ${time}.`,
  mostCovered: 'Most covered right now',
  howHeadlined: 'How it was headlined',
  allStories: 'All stories',
  bothLanguages: 'In both languages',
  moreStories: 'Show more stories',
  noMore: 'That’s everything from the last two days.',
  readStory: 'Compare the coverage',

  outletsCount: (n: number) => (n === 1 ? '1 outlet' : `${n} outlets`),
  coverage: (en: number, hi: number, other = 0) => {
    const n = en + hi + other;
    const parts = [en ? `${en} English` : '', hi ? `${hi} Hindi` : '', other ? `${other} in other languages` : ''].filter(Boolean);
    if (parts.length > 1) return `${n} outlets (${parts.join(', ')})`;
    const noun = n === 1 ? 'outlet' : 'outlets';
    return en ? `${n} English ${noun}` : hi ? `${n} Hindi ${noun}` : `${n} ${noun} in other languages`;
  },
  updated: (time: string) => `updated ${time}`,
  coverageLabel: (en: number, hi: number, other = 0) =>
    `Covered by ${en} English, ${hi} Hindi and ${other} other-language outlets`,
  notAnalyzed: 'Comparison not written yet',
  disputed: 'Outlets report conflicting facts',

  live: 'Live',
  newStories: 'New stories just came in.',
  showNew: 'Show them',

  claimsTitle: 'Who claims what',
  claimsIntro:
    'Each claim, who makes it, and which outlets carry it. The status reflects sourcing only: Nazariya does not decide which side is right.',
  claimedBy: 'Claimed by',
  carriedBy: 'Carried by',
  status: {
    confirmed: 'Confirmed by independent sources',
    one_sided: 'One side’s claim',
    disputed: 'Disputed: sources contradict each other',
  } as Record<string, string>,
  ownership: { private: 'Private', public: 'Public broadcaster', state: 'State media' } as Record<string, string>,
  otherPress: 'Other languages',
  basedIn: (country: string) => `Based in ${country}`,

  twoSides: 'Two sides',
  forSide: 'For',
  againstSide: 'Against',
  forHint: 'Arguments for, as reported',
  againstHint: 'Arguments against, as reported',
  oneSided: 'No outlet in this story reported an argument on this side.',
  twoSidesNote:
    'Arguments are taken only from what these outlets published, each credited to its source. Nothing is added to balance the sides.',
  debated: 'Debated',
  argumentCount: (f: number, a: number) => `${f} for, ${a} against`,
  versus: 'vs',

  // sections
  sectionAll: 'All news',
  sectionIndia: 'India',
  sectionWorld: 'World',
  worldTag: 'World',
  international: 'International',
  mostDebated: 'Most debated',
  mostDebatedIntro: 'Stories where the coverage carries real arguments on both sides. Read them, then pick one.',
  pickSide: 'Pick a side',
  votesCount: (n: number) => (n === 1 ? '1 vote' : `${n} votes`),
  commentsCount: (n: number) => (n === 1 ? '1 comment' : `${n} comments`),

  // poll
  whereStand: 'Where do you stand?',
  voteFor: 'For',
  voteAgainst: 'Against',
  voteUnsure: 'Not sure',
  yourVote: 'Your vote',
  changeVote: 'You can change your vote any time.',
  readersSaid: (n: number) => (n === 1 ? 'Readers so far: 1 vote' : `Readers so far: ${n} votes`),
  pollNote: 'This is a reader poll, not a survey: it shows what visitors to this page think.',

  // discussion
  discussion: 'Discussion',
  guidelines: 'Be civil and stay on the story. No links, no personal attacks, no hate. Comments reported by three readers are hidden.',
  yourName: 'Name (optional)',
  yourComment: 'Your comment',
  commentPlaceholder: 'What stood out to you in how this was covered?',
  postComment: 'Post comment',
  posting: 'Posting…',
  newest: 'Newest',
  top: 'Top',
  noComments: 'No comments yet. Start the discussion.',
  upvote: 'Upvote',
  report: 'Report',
  reported: 'Reported',
  hiddenAfterReports: 'Thanks. It has been hidden for review.',
  tooFast: 'You’re posting quickly. Wait a minute and try again.',
  charsLeft: (n: number) => `${n} characters left`,

  // problem reports
  somethingWrong: 'Something wrong on this page?',
  askTitle: 'Ask about this story',
  askIntro: 'Confused? Ask a question and the AI assistant will explain, using only what the outlets reported.',
  askPlaceholder: 'e.g. Why do the outlets disagree?',
  askSend: 'Ask',
  askThinking: 'Thinking…',
  askFailed: 'The assistant could not answer right now. Please try again.',
  askLimit: 'Too many questions for now. Please wait a minute.',
  askClear: 'Clear chat',
  askNote: 'AI-written from the coverage above; it can make mistakes.',
  askYou: 'You',
  askBot: 'Assistant',
  translate: 'Translate',
  translating: 'Translating…',
  showOriginal: 'Show original',
  translateFailed: 'Could not translate.',
  translatedNote: 'AI translation',
  problemIntro: 'Tell us what to fix. Reports go to the maintainer and help improve the grouping and summaries.',
  problemKinds: {
    wrong_grouping: 'These articles are about different events',
    wrong_summary: 'The summary or comparison is inaccurate',
    missing_side: 'A side of the story is missing',
    unfair: 'The framing notes feel unfair to an outlet',
    bad_translation: 'The Hindi or English text reads badly',
    broken_link: 'A link is broken',
    other: 'Something else',
  } as Record<string, string>,
  problemNote: 'Details (optional)',
  sendReport: 'Send report',
  reportThanks: 'Thanks. Your report has been sent.',

  // moderation
  moderation: 'Moderation',
  adminToken: 'Admin token',
  openQueue: 'Open queue',
  openReports: 'Open problem reports',
  recentComments: 'Recent comments',
  hide: 'Hide',
  restore: 'Restore',
  remove: 'Delete',
  resolve: 'Mark fixed',
  hiddenLabel: 'Hidden',
  wrongToken: 'That token didn’t work.',
  nothingOpen: 'Nothing open.',
  sendFailed: 'That didn’t go through. Check your connection and try again.',

  topics: {
    all: 'All news', india: 'India', world: 'World', politics: 'Politics', business: 'Business',
    sports: 'Sports', entertainment: 'Entertainment', technology: 'Tech', science: 'Science',
    health: 'Health', crime: 'Crime',
  } as Record<string, string>,
  breaking: 'Breaking',
  edited: 'Headline changed',
  imageCredit: (outlet: string) => `Photo: ${outlet}`,
  leaningTitle: 'Who leans which way',
  leaningIntro: 'Each outlet’s own headline and excerpt, sorted by which side of the question it leans to.',
  leanFor: 'Leans for',
  leanAgainst: 'Leans against',
  leanNeutral: 'Just reporting',
  allCoverage: 'All coverage',
  editsTitle: 'Headlines that changed',
  editsIntro: 'Outlets sometimes rewrite a headline after publishing. Nazariya keeps every version it saw.',
  editsNone: '',
  firstReported: (outlet: string, time: string) => `First reported by ${outlet}, ${time}.`,
  languageFollowed: (language: string, outlet: string, gap: string) => `First in ${language}: ${outlet}, ${gap} later.`,
  duration: (minutes: number) =>
    minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim(),

  // story page
  back: 'All stories',
  otherLanguageTitle: 'हिंदी में',
  agree: 'What everyone reports',
  differ: 'Where coverage differs',
  noDifferences: 'Coverage is essentially the same across outlets.',
  framing: 'How each outlet framed it',
  framingByCountry: 'How each country’s media told it',
  coveredFrom: 'Covered from',
  englishPress: 'English press',
  hindiPress: 'Hindi press',
  noFramingYet: 'Joined after the comparison was written.',
  everyArticle: 'Every article',
  readAt: (outlet: string) => `Read at ${outlet}`,
  timeline: 'Coverage over time',
  timelineNote: 'Articles published per hour, by language.',
  related: 'Related stories',
  share: 'Share',
  copied: 'Link copied',
  mayDiffer:
    'These articles may describe different events: the automatic grouping could be wrong here, so the comparison is less reliable.',
  pendingExplainer: (n: number) =>
    `A side-by-side comparison is written once at least 3 outlets cover a story. ${n} ${n === 1 ? 'has' : 'have'} so far. Meanwhile, here is what each one published.`,
  aiNote: (model: string, time: string) =>
    `Written by an AI model (${model}) ${time}, using only these headlines and short excerpts. It can be wrong; read the original reporting before you rely on it.`,
  sisterOf: (group: string) => `${group} group`,
  storyGone: 'This story is no longer here',
  storyGoneBody: 'Stories are kept for 14 days, and sometimes two are merged into one.',

  // blindspots
  blindspotsTitle: 'Blindspots',
  blindspotsIntro: (n: number) =>
    `Stories that at least ${n} outlets in one language covered, and not a single outlet in the other. Where one press looks, and the other doesn’t.`,
  onlyHindi: 'Only in the Hindi press',
  onlyEnglish: 'Only in the English press',
  onlyHindiNote: 'English outlets haven’t covered these.',
  onlyEnglishNote: 'Hindi outlets haven’t covered these.',
  noBlindspots: 'Nothing right now: both presses are covering the same stories.',
  seeBlindspots: 'See all blindspots',

  // outlets
  outletsTitle: 'Who we read',
  outletsIntro:
    'Every outlet is read through its public RSS feed. We store the headline, a short excerpt and the link, never the full article. Outlets are not rated or labelled: the point is to compare what they published.',
  colOutlet: 'Outlet',
  colGroup: 'Media group',
  colLast24: 'Last 24 hours',
  colLatest: 'Latest article',
  articles: (n: number) => (n === 1 ? '1 article' : `${n} articles`),
  quiet: 'No articles lately',

  // search
  searchTitle: 'Search',
  resultsFor: (q: string) => `Stories matching “${q}”`,
  noResults: (q: string) => `No story from the last 14 days matches “${q}”. Try a person, a place or a single word.`,
  searchHint: 'Type at least two letters. Search covers original headlines in both languages.',

  // states
  waking: 'Waking the server. Free hosting sleeps when nobody visits; this can take up to a minute.',
  loadFailed: 'The stories didn’t load. The server didn’t answer.',
  tryAgain: 'Try again',
  emptyHome: 'No stories yet. New stories arrive every 15 minutes; check back shortly.',
  notFoundTitle: 'This page doesn’t exist',
  notFoundBody: 'The link may be mistyped, or the page may have moved.',
  goHome: 'Go to top stories',

  // footer
  footerAbout:
    'An open-source project that compares how English and Hindi media cover the same news. Summaries are AI-written; every headline links to its source.',
  footerBuilt: (name: string) => `Built by ${name}.`,
  sourceCode: 'Source code',
  apiDocs: 'API',
};

type Strings = typeof en;

const hi: Strings = {
  skip: 'सीधे सामग्री पर जाएँ',
  tagline: 'ख़बर एक, नज़रिए अनेक।',
  nav: { top: 'मुख्य ख़बरें', blindspots: 'अनदेखी ख़बरें', outlets: 'मीडिया संस्थान', about: 'यह कैसे काम करता है' },
  searchLabel: 'ख़बरें खोजें',
  searchPlaceholder: 'ख़बरें खोजें',
  switchLanguage: 'Read in English',
  themeToDark: 'डार्क मोड चालू करें',
  themeToLight: 'लाइट मोड चालू करें',

  intro: (outlets, _en, _hi, countries = 1) =>
    `${countries} देशों के ${outlets} न्यूज़रूम, भारत के अंग्रेज़ी और हिंदी मीडिया से लेकर दुनिया के संघर्षों के दोनों पक्षों तक, हर 15 मिनट में पढ़े जाते हैं। एक ही घटना की ख़बरें साथ-साथ रखी जाती हैं, ताकि आप देख सकें कि कवरेज कहाँ मिलती है और कहाँ अलग होती है।`,
  introFallback:
    'अंग्रेज़ी और हिंदी न्यूज़रूम, हर 15 मिनट में पढ़े जाते हैं। एक ही घटना की ख़बरें साथ-साथ रखी जाती हैं, ताकि आप देख सकें कि कवरेज कहाँ मिलती है और कहाँ अलग होती है।',
  lastUpdated: (time) => `पिछली जाँच ${time}।`,
  mostCovered: 'इस समय सबसे ज़्यादा कवरेज',
  howHeadlined: 'किसने क्या हेडलाइन दी',
  allStories: 'सभी ख़बरें',
  bothLanguages: 'दोनों भाषाओं में',
  moreStories: 'और ख़बरें दिखाएँ',
  noMore: 'पिछले दो दिनों की सभी ख़बरें यही हैं।',
  readStory: 'कवरेज की तुलना देखें',

  outletsCount: (n) => `${n} संस्थान`,
  coverage: (en, hi, other = 0) => {
    const parts = [en ? `${en} अंग्रेज़ी` : '', hi ? `${hi} हिंदी` : '', other ? `${other} अन्य भाषाएँ` : ''].filter(Boolean);
    return parts.length > 1 ? `${en + hi + other} संस्थान (${parts.join(', ')})` : `${parts[0] ?? ''} संस्थान`;
  },
  updated: (time) => `${time} अपडेट`,
  coverageLabel: (en, hi, other = 0) => `${en} अंग्रेज़ी, ${hi} हिंदी और ${other} अन्य भाषाओं के संस्थानों ने कवर किया`,
  notAnalyzed: 'तुलना अभी लिखी नहीं गई',
  disputed: 'तथ्यों पर संस्थान एकमत नहीं',

  live: 'लाइव',
  newStories: 'नई ख़बरें आई हैं।',
  showNew: 'दिखाएँ',

  claimsTitle: 'कौन क्या दावा कर रहा है',
  claimsIntro:
    'हर दावा, उसे करने वाला पक्ष, और उसे छापने वाले संस्थान। स्थिति सिर्फ़ स्रोतों पर आधारित है: नज़रिया यह तय नहीं करता कि कौन सही है।',
  claimedBy: 'दावा करने वाला',
  carriedBy: 'छापने वाले',
  status: {
    confirmed: 'स्वतंत्र स्रोतों से पुष्टि',
    one_sided: 'एक पक्ष का दावा',
    disputed: 'विवादित: स्रोत एक-दूसरे से अलग',
  },
  ownership: { private: 'निजी', public: 'सार्वजनिक प्रसारक', state: 'सरकारी मीडिया' },
  otherPress: 'अन्य भाषाएँ',
  basedIn: (country) => `${country} में स्थित`,

  twoSides: 'दो पक्ष',
  forSide: 'पक्ष में',
  againstSide: 'विपक्ष में',
  forHint: 'पक्ष के तर्क, जैसा छपा',
  againstHint: 'विपक्ष के तर्क, जैसा छपा',
  oneSided: 'इस ख़बर के किसी संस्थान ने इस पक्ष का कोई तर्क नहीं छापा।',
  twoSidesNote:
    'तर्क सिर्फ़ इन्हीं संस्थानों की छपी ख़बरों से लिए गए हैं, हर तर्क अपने स्रोत के साथ। पक्षों को बराबर दिखाने के लिए कुछ जोड़ा नहीं गया।',
  debated: 'बहस',
  argumentCount: (f, a) => `${f} पक्ष में, ${a} विपक्ष में`,
  versus: 'बनाम',

  sectionAll: 'सभी ख़बरें',
  sectionIndia: 'देश',
  sectionWorld: 'दुनिया',
  worldTag: 'दुनिया',
  international: 'अंतरराष्ट्रीय',
  mostDebated: 'सबसे ज़्यादा बहस',
  mostDebatedIntro: 'वे ख़बरें जिनकी कवरेज में दोनों पक्षों के असली तर्क हैं। पढ़िए, फिर अपना पक्ष चुनिए।',
  pickSide: 'पक्ष चुनें',
  votesCount: (n) => `${n} वोट`,
  commentsCount: (n) => `${n} टिप्पणियाँ`,

  whereStand: 'आप किस तरफ़ हैं?',
  voteFor: 'पक्ष में',
  voteAgainst: 'विपक्ष में',
  voteUnsure: 'पक्का नहीं',
  yourVote: 'आपका वोट',
  changeVote: 'आप कभी भी अपना वोट बदल सकते हैं।',
  readersSaid: (n) => `अब तक पाठकों के ${n} वोट`,
  pollNote: 'यह पाठकों का पोल है, सर्वे नहीं: यह बताता है कि इस पेज पर आने वाले क्या सोचते हैं।',

  discussion: 'चर्चा',
  guidelines: 'शालीन रहें और ख़बर पर बात करें। कोई लिंक नहीं, कोई निजी हमला नहीं, कोई नफ़रत नहीं। तीन पाठकों की रिपोर्ट के बाद टिप्पणी छिप जाती है।',
  yourName: 'नाम (वैकल्पिक)',
  yourComment: 'आपकी टिप्पणी',
  commentPlaceholder: 'इस ख़बर की कवरेज में आपको क्या ख़ास लगा?',
  postComment: 'टिप्पणी भेजें',
  posting: 'भेजी जा रही है…',
  newest: 'नई',
  top: 'लोकप्रिय',
  noComments: 'अभी कोई टिप्पणी नहीं। चर्चा शुरू करें।',
  upvote: 'पसंद',
  report: 'रिपोर्ट करें',
  reported: 'रिपोर्ट हो गई',
  hiddenAfterReports: 'धन्यवाद। इसे समीक्षा के लिए छिपा दिया गया है।',
  tooFast: 'आप बहुत जल्दी पोस्ट कर रहे हैं। एक मिनट रुककर फिर कोशिश करें।',
  charsLeft: (n) => `${n} अक्षर बाक़ी`,

  somethingWrong: 'इस पेज पर कुछ ग़लत है?',
  askTitle: 'इस ख़बर के बारे में पूछें',
  askIntro: 'उलझन में हैं? सवाल पूछें, AI सहायक सिर्फ़ वही समझाएगा जो आउटलेट्स ने रिपोर्ट किया।',
  askPlaceholder: 'जैसे: आउटलेट्स में मतभेद क्यों है?',
  askSend: 'पूछें',
  askThinking: 'सोच रहा है…',
  askFailed: 'सहायक अभी जवाब नहीं दे सका। कृपया फिर कोशिश करें।',
  askLimit: 'अभी बहुत सवाल हो गए। कृपया एक मिनट रुकें।',
  askClear: 'चैट साफ़ करें',
  askNote: 'ऊपर की कवरेज से AI ने लिखा; इसमें ग़लती हो सकती है।',
  askYou: 'आप',
  askBot: 'सहायक',
  translate: 'अनुवाद',
  translating: 'अनुवाद हो रहा है…',
  showOriginal: 'मूल दिखाएँ',
  translateFailed: 'अनुवाद नहीं हो सका।',
  translatedNote: 'AI अनुवाद',
  problemIntro: 'बताइए क्या ठीक करना है। रिपोर्ट मेंटेनर तक जाती है और समूह व सारांश बेहतर बनाने में मदद करती है।',
  problemKinds: {
    wrong_grouping: 'ये लेख अलग-अलग घटनाओं के हैं',
    wrong_summary: 'सारांश या तुलना ग़लत है',
    missing_side: 'ख़बर का एक पक्ष ग़ायब है',
    unfair: 'किसी संस्थान के बारे में टिप्पणी अनुचित लगती है',
    bad_translation: 'हिंदी या अंग्रेज़ी पाठ ठीक नहीं पढ़ा जाता',
    broken_link: 'कोई लिंक काम नहीं करता',
    other: 'कुछ और',
  },
  problemNote: 'विवरण (वैकल्पिक)',
  sendReport: 'रिपोर्ट भेजें',
  reportThanks: 'धन्यवाद। आपकी रिपोर्ट भेज दी गई है।',

  moderation: 'मॉडरेशन',
  adminToken: 'एडमिन टोकन',
  openQueue: 'कतार खोलें',
  openReports: 'खुली रिपोर्टें',
  recentComments: 'हाल की टिप्पणियाँ',
  hide: 'छिपाएँ',
  restore: 'वापस लाएँ',
  remove: 'हटाएँ',
  resolve: 'ठीक हो गया',
  hiddenLabel: 'छिपी हुई',
  wrongToken: 'यह टोकन काम नहीं किया।',
  nothingOpen: 'कुछ बाक़ी नहीं।',
  sendFailed: 'यह नहीं भेजा जा सका। कनेक्शन जाँचें और फिर कोशिश करें।',

  topics: {
    all: 'सभी ख़बरें', india: 'देश', world: 'दुनिया', politics: 'राजनीति', business: 'कारोबार',
    sports: 'खेल', entertainment: 'मनोरंजन', technology: 'टेक', science: 'विज्ञान', health: 'सेहत', crime: 'अपराध',
  },
  breaking: 'ताज़ा',
  edited: 'हेडलाइन बदली गई',
  imageCredit: (outlet) => `फ़ोटो: ${outlet}`,
  leaningTitle: 'कौन किस तरफ़ झुका',
  leaningIntro: 'हर संस्थान का अपना शीर्षक और अंश, इस हिसाब से कि वह सवाल के किस पक्ष की ओर झुकता है।',
  leanFor: 'पक्ष की ओर',
  leanAgainst: 'विपक्ष की ओर',
  leanNeutral: 'सिर्फ़ ख़बर',
  allCoverage: 'पूरी कवरेज',
  editsTitle: 'जो हेडलाइन बदलीं',
  editsIntro: 'संस्थान कभी-कभी छापने के बाद हेडलाइन बदल देते हैं। नज़रिया हर देखा गया संस्करण रखता है।',
  editsNone: '',
  firstReported: (outlet, time) => `सबसे पहले ${outlet} ने ख़बर दी, ${time}।`,
  languageFollowed: (language, outlet, gap) => `${language} में सबसे पहले: ${outlet}, ${gap} बाद।`,
  duration: (minutes) =>
    minutes < 60 ? `${minutes} मिनट` : `${Math.floor(minutes / 60)} घंटे ${minutes % 60 ? `${minutes % 60} मिनट` : ''}`.trim(),

  back: 'सभी ख़बरें',
  otherLanguageTitle: 'In English',
  agree: 'जिस पर सभी सहमत हैं',
  differ: 'कवरेज में अंतर',
  noDifferences: 'सभी संस्थानों की कवरेज लगभग एक जैसी है।',
  framing: 'किसने कैसे दिखाया',
  framingByCountry: 'हर देश के मीडिया ने कैसे बताया',
  coveredFrom: 'कहाँ से कवरेज',
  englishPress: 'अंग्रेज़ी मीडिया',
  hindiPress: 'हिंदी मीडिया',
  noFramingYet: 'तुलना लिखे जाने के बाद जुड़ा।',
  everyArticle: 'सभी लेख',
  readAt: (outlet) => `${outlet} पर पढ़ें`,
  timeline: 'समय के साथ कवरेज',
  timelineNote: 'हर घंटे प्रकाशित लेख, भाषा के अनुसार।',
  related: 'संबंधित ख़बरें',
  share: 'शेयर करें',
  copied: 'लिंक कॉपी हो गया',
  mayDiffer:
    'संभव है ये लेख अलग-अलग घटनाओं के हों: स्वचालित समूह बनाने में यहाँ चूक हो सकती है, इसलिए यह तुलना कम भरोसेमंद है।',
  pendingExplainer: (n) =>
    `कम से कम 3 संस्थानों के कवर करने पर तुलना लिखी जाती है। अभी तक ${n} ने कवर किया है। तब तक देखिए, किसने क्या छापा।`,
  aiNote: (model, time) =>
    `यह एक AI मॉडल (${model}) ने ${time} केवल इन शीर्षकों और छोटे अंशों से लिखा है। इसमें ग़लती हो सकती है; भरोसा करने से पहले मूल रिपोर्ट ज़रूर पढ़ें।`,
  sisterOf: (group) => `${group} समूह`,
  storyGone: 'यह ख़बर अब उपलब्ध नहीं है',
  storyGoneBody: 'ख़बरें 14 दिन तक रखी जाती हैं, और कभी-कभी दो ख़बरें एक में मिला दी जाती हैं।',

  blindspotsTitle: 'अनदेखी ख़बरें',
  blindspotsIntro: (n) =>
    `वे ख़बरें जिन्हें एक भाषा के कम से कम ${n} संस्थानों ने कवर किया, पर दूसरी भाषा के किसी भी संस्थान ने नहीं। जहाँ एक मीडिया की नज़र है, दूसरे की नहीं।`,
  onlyHindi: 'सिर्फ़ हिंदी मीडिया में',
  onlyEnglish: 'सिर्फ़ अंग्रेज़ी मीडिया में',
  onlyHindiNote: 'अंग्रेज़ी संस्थानों ने इन्हें कवर नहीं किया।',
  onlyEnglishNote: 'हिंदी संस्थानों ने इन्हें कवर नहीं किया।',
  noBlindspots: 'अभी कोई नहीं: दोनों भाषाओं का मीडिया एक जैसी ख़बरें दिखा रहा है।',
  seeBlindspots: 'सभी अनदेखी ख़बरें देखें',

  outletsTitle: 'हम किसे पढ़ते हैं',
  outletsIntro:
    'हर संस्थान को उसकी सार्वजनिक RSS फ़ीड से पढ़ा जाता है। हम सिर्फ़ शीर्षक, छोटा अंश और लिंक रखते हैं, पूरा लेख कभी नहीं। संस्थानों को रेटिंग या लेबल नहीं दिया जाता: मक़सद यह तुलना करना है कि उन्होंने क्या छापा।',
  colOutlet: 'संस्थान',
  colGroup: 'मीडिया समूह',
  colLast24: 'पिछले 24 घंटे',
  colLatest: 'ताज़ा लेख',
  articles: (n) => `${n} लेख`,
  quiet: 'हाल में कोई लेख नहीं',

  searchTitle: 'खोज',
  resultsFor: (q) => `“${q}” से मिलती ख़बरें`,
  noResults: (q) => `पिछले 14 दिनों की कोई ख़बर “${q}” से नहीं मिलती। किसी व्यक्ति, जगह या एक शब्द से खोजें।`,
  searchHint: 'कम से कम दो अक्षर लिखें। खोज दोनों भाषाओं के मूल शीर्षकों में होती है।',

  waking: 'सर्वर जगाया जा रहा है। मुफ़्त होस्टिंग खाली रहने पर सो जाती है; इसमें एक मिनट तक लग सकता है।',
  loadFailed: 'ख़बरें लोड नहीं हुईं। सर्वर से जवाब नहीं मिला।',
  tryAgain: 'फिर कोशिश करें',
  emptyHome: 'अभी कोई ख़बर नहीं। हर 15 मिनट में नई ख़बरें आती हैं; थोड़ी देर में फिर देखें।',
  notFoundTitle: 'यह पेज मौजूद नहीं है',
  notFoundBody: 'हो सकता है लिंक ग़लत लिखा हो, या पेज हट गया हो।',
  goHome: 'मुख्य ख़बरों पर जाएँ',

  footerAbout:
    'एक ओपन-सोर्स प्रोजेक्ट जो दिखाता है कि अंग्रेज़ी और हिंदी मीडिया एक ही ख़बर को कैसे दिखाते हैं। सारांश AI से लिखे गए हैं; हर शीर्षक अपने स्रोत से जुड़ा है।',
  footerBuilt: (name) => `${name} द्वारा बनाया गया।`,
  sourceCode: 'सोर्स कोड',
  apiDocs: 'API',
};

const STRINGS: Record<Lang, Strings> = { en, hi };

interface I18nValue {
  lang: Lang;
  t: Strings;
  setLang: (lang: Lang) => void;
  timeAgo: (iso: string) => string;
  formatNumber: (n: number) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (load('lang') === 'hi' ? 'hi' : 'en'));

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nValue>(() => {
    const rtf = new Intl.RelativeTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { numeric: 'auto' });
    const nf = new Intl.NumberFormat(lang === 'hi' ? 'hi-IN' : 'en-IN');
    return {
      lang,
      t: STRINGS[lang],
      setLang: (next) => {
        save('lang', next);
        setLangState(next);
      },
      timeAgo: (iso) => {
        const seconds = (Date.parse(iso) - Date.now()) / 1000;
        for (const [unit, size] of UNITS) {
          if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
        }
        return rtf.format(0, 'minute');
      },
      formatNumber: (n) => nf.format(n),
    };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}

export function pick(text: Bilingual, lang: Lang): string {
  return text[lang] || text.en || text.hi;
}

/** The title to show for a story: the neutral AI headline if written, else the newest original headline. */
export function storyTitle(story: StorySummary, lang: Lang): { text: string; lang: string; original?: HeadlineRef } {
  if (story.headline) return { text: pick(story.headline, lang), lang };
  const lead = story.leadHeadline;
  return lead ? { text: lead.title, lang: lead.language, original: lead } : { text: '', lang };
}
