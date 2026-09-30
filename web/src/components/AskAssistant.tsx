import { FormEvent, useRef, useState } from 'react';
import { ApiError, apiSend } from '../api';
import { useI18n } from '../i18n';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** Questions and answers live only in this page; the API stores nothing. */
export function AskAssistant({ storyId }: { storyId: number }) {
  const { t, lang } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const message = question.trim();
    if (!message || busy) return;
    setQuestion('');
    setError('');
    setBusy(true);
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    try {
      const { reply } = await apiSend<{ reply: string }>('POST', `/stories/${storyId}/chat`, {
        history: turns.slice(-10),
        message,
        lang,
      });
      setTurns((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t.askLimit : t.askFailed);
    } finally {
      setBusy(false);
      window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'nearest' }), 0);
    }
  }

  return (
    <section className="section ask">
      <h2 className="section-title">{t.askTitle}</h2>
      <p className="muted">{t.askIntro}</p>
      {turns.length > 0 && (
        <div className="ask__log" aria-live="polite">
          {turns.map((turn, i) => (
            <p key={i} className={`ask__turn ask__turn--${turn.role}`} lang={lang}>
              <strong>{turn.role === 'user' ? t.askYou : t.askBot}: </strong>
              {turn.content}
            </p>
          ))}
          {busy && <p className="muted">{t.askThinking}</p>}
          <div ref={endRef} />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <form className="ask__form" onSubmit={ask}>
        <label className="visually-hidden" htmlFor="ask-input">
          {t.askTitle}
        </label>
        <input
          id="ask-input"
          className="input"
          maxLength={500}
          placeholder={t.askPlaceholder}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="button" disabled={busy || !question.trim()}>
          {t.askSend}
        </button>
        {turns.length > 0 && (
          <button type="button" className="link-button" onClick={() => setTurns([])}>
            {t.askClear}
          </button>
        )}
      </form>
      <p className="ai-note">{t.askNote}</p>
    </section>
  );
}
