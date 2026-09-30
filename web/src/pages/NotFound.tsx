import { EmptyState } from '../components/States';
import { useDocumentTitle } from '../hooks';
import { useI18n } from '../i18n';

export default function NotFound() {
  const { t } = useI18n();
  useDocumentTitle(t.notFoundTitle);
  return <EmptyState title={t.notFoundTitle} body={t.notFoundBody} />;
}
