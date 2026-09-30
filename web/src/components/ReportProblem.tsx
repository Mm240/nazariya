import { FormEvent, useState } from 'react';
import { apiSend } from '../api';
import { useI18n } from '../i18n';

const KINDS = ['wrong_grouping', 'wrong_summary', 'missing_side', 'unfair', 'bad_translation', 'broken_link', 'other'];

export function ReportProblem({ storyId }: { storyId: number }) {
  const { t } = useI18n();
  const [kind, setKind] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!kind) return;
    setState('sending');
    try {
      await apiSend('POST', `/stories/${storyId}/feedback`, { kind, note });
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  return (
    <details className="problem">
      <summary>{t.somethingWrong}</summary>
      {state === 'sent' ? (
        <p className="notice">{t.reportThanks}</p>
      ) : (
        <form onSubmit={submit} className="problem__form">
          <p className="muted">{t.problemIntro}</p>
          <fieldset className="problem__kinds">
            <legend className="visually-hidden">{t.somethingWrong}</legend>
            {KINDS.map((k) => (
              <label key={k} className="problem__kind">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                {t.problemKinds[k]}
              </label>
            ))}
          </fieldset>
          <label className="visually-hidden" htmlFor="problem-note">
            {t.problemNote}
          </label>
          <textarea
            id="problem-note"
            className="input"
            rows={2}
            maxLength={500}
            placeholder={t.problemNote}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="button" disabled={!kind || state === 'sending'}>
            {t.sendReport}
          </button>
          {state === 'failed' && <p className="form-error">{t.sendFailed}</p>}
        </form>
      )}
    </details>
  );
}
