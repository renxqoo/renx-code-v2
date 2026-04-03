/**
 * Caches per-user config (typing_ticket) to avoid excessive getConfig calls.
 */
export declare class WeixinConfigManager {
    private cache;
    private apiOpts;
    private log;
    constructor(apiOpts: {
        baseUrl: string;
        token?: string;
    }, log?: (msg: string) => void);
    getForUser(userId: string, contextToken?: string): Promise<{
        typingTicket?: string;
    }>;
}
//# sourceMappingURL=config-cache.d.ts.map