// Preferences are a convenience; private browsing or blocked storage must not break the site.
export function load(key: string): string | null {
  try {
    return window.localStorage.getItem(`nazariya:${key}`);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(`nazariya:${key}`, value);
  } catch {
    /* ignore */
  }
}
