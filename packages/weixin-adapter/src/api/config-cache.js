import { getConfig } from "./api";
import { logger } from "../util/logger";
const CACHE_TTL_MS = 5 * 60_000;
/**
 * Caches per-user config (typing_ticket) to avoid excessive getConfig calls.
 */
export class WeixinConfigManager {
    cache = new Map();
    apiOpts;
    log;
    constructor(apiOpts, log) {
        this.apiOpts = apiOpts;
        this.log = log ?? (() => { });
    }
    async getForUser(userId, contextToken) {
        const cached = this.cache.get(userId);
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
            return { typingTicket: cached.typingTicket };
        }
        try {
            const resp = await getConfig({
                baseUrl: this.apiOpts.baseUrl,
                token: this.apiOpts.token,
                ilinkUserId: userId,
                contextToken,
            });
            const entry = {
                typingTicket: resp.typing_ticket,
                fetchedAt: Date.now(),
            };
            this.cache.set(userId, entry);
            return { typingTicket: resp.typing_ticket };
        }
        catch (err) {
            logger.warn(`getConfig failed for user=${userId}: ${String(err)}`);
            return { typingTicket: cached?.typingTicket };
        }
    }
}
