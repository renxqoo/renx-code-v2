/** Session expired errcode returned by iLink server. */
export declare const SESSION_EXPIRED_ERRCODE = -14;
/** Mark a session as paused (expired). */
export declare function pauseSession(accountId: string): void;
/** Check if a session is currently paused. */
export declare function isSessionPaused(accountId: string): boolean;
/** Assert that the session for the given account is active. */
export declare function assertSessionActive(accountId: string): void;
/** Get remaining pause time in ms. */
export declare function getRemainingPauseMs(accountId: string): number;
//# sourceMappingURL=session-guard.d.ts.map