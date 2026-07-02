// Guarded localStorage access for environments without storage (tests, SSR).

export function readStoredNumber(key: string, fallback: number): number {
  if (typeof localStorage === 'undefined') return fallback;
  const parsed = parseFloat(localStorage.getItem(key) ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readStoredBool(key: string): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'true';
}

export function writeStored(key: string, value: string | number | boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, String(value));
  }
}
