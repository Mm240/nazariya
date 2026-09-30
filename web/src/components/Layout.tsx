import { FormEvent, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { API_URL, AUTHOR, REPO_URL } from '../config';
import { useSlashFocus } from '../hooks';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';

function Wordmark() {
  return (
    <Link to="/" className="wordmark" aria-label="Nazariya, home">
      <span className="wordmark__hi" lang="hi">नज़रिया</span>
      <span className="wordmark__en">Nazariya</span>
    </Link>
  );
}

function SearchBox() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const [q, setQ] = useState(pathname === '/search' ? (params.get('q') ?? '') : '');
  const ref = useSlashFocus<HTMLInputElement>();

  useEffect(() => {
    if (pathname !== '/search') setQ('');
  }, [pathname]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query.length >= 2) navigate(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <form className="search" role="search" onSubmit={submit}>
      <label htmlFor="site-search" className="visually-hidden">
        {t.searchLabel}
      </label>
      <svg aria-hidden="true" className="search__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        id="site-search"
        ref={ref}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.searchPlaceholder}
        minLength={2}
        maxLength={80}
        autoComplete="off"
      />
      <kbd className="search__kbd" aria-hidden="true">/</kbd>
    </form>
  );
}

function ThemeButton() {
  const { resolved, toggle } = useTheme();
  const { t } = useI18n();
  const label = resolved === 'dark' ? t.themeToLight : t.themeToDark;
  return (
    <button type="button" className="icon-button" onClick={toggle} aria-label={label} title={label}>
      {resolved === 'dark' ? (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
        </svg>
      )}
    </button>
  );
}

function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t.switchLanguage}>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
        EN
      </button>
      <button type="button" aria-pressed={lang === 'hi'} onClick={() => setLang('hi')} lang="hi">
        हिं
      </button>
    </div>
  );
}

function Header() {
  const { t } = useI18n();
  const links = [
    ['/', t.nav.top],
    ['/blindspots', t.nav.blindspots],
    ['/outlets', t.nav.outlets],
    ['/about', t.nav.about],
  ] as const;
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <div className="masthead__brand">
          <Wordmark />
          <p className="masthead__tagline">{t.tagline}</p>
        </div>
        <div className="masthead__tools">
          <SearchBox />
          <LanguageSwitch />
          <ThemeButton />
        </div>
      </div>
      <nav className="nav" aria-label="Main">
        <div className="nav__inner">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className="nav__link">
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <Wordmark />
          <p>{t.footerAbout}</p>
          <p className="footer__small">{t.footerBuilt(AUTHOR)}</p>
        </div>
        <nav className="footer__links" aria-label="Footer">
          <Link to="/">{t.nav.top}</Link>
          <Link to="/blindspots">{t.nav.blindspots}</Link>
          <Link to="/outlets">{t.nav.outlets}</Link>
          <Link to="/about">{t.nav.about}</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {t.sourceCode}
          </a>
          <a href={`${API_URL}/api/docs`} target="_blank" rel="noopener noreferrer">
            {t.apiDocs}
          </a>
        </nav>
      </div>
    </footer>
  );
}

export function Layout() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <Header />
      <main id="main" className="page" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
