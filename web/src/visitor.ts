import { load, save } from './storage';

let memoryId: string | null = null;

/** A random id for this browser, so votes and upvotes count once. Not tied to any person. */
export function visitorId(): string {
  const saved = load('visitor');
  if (saved) return saved;
  if (!memoryId) {
    memoryId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    save('visitor', memoryId); // if storage is blocked, the id lasts for this visit only
  }
  return memoryId;
}
