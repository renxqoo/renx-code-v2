/** Session expired errcode returned by iLink server. */
export const SESSION_EXPIRED_ERRCODE = -14;

const pauseStore = new Map<string, number>();
const PAUSE_DURATION_MS = 5 * 60_000; // 5 minutes

/** Mark a session as paused (expired). */
export function pauseSession(accountId: string): void {
  pauseStore.set(accountId, Date.now() + PAUSE_DURATION_MS);
}

/** Check if a session is currently paused. */
export function isSessionPaused(accountId: string): boolean {
  const resumeAt = pauseStore.get(accountId);
  if (!resumeAt) return false;
  if (Date.now() >= resumeAt) {
    pauseStore.delete(accountId);
    return false;
  }
  return true;
}

/** Assert that the session for the given account is active. */
export function assertSessionActive(accountId: string): void {
  if (isSessionPaused(accountId)) {
    throw new Error(`Session for account ${accountId} is paused (expired). Please re-login.`);
  }
}

/** Get remaining pause time in ms. */
export function getRemainingPauseMs(accountId: string): number {
  const resumeAt = pauseStore.get(accountId);
  if (!resumeAt) return 0;
  return Math.max(0, resumeAt - Date.now());
}
