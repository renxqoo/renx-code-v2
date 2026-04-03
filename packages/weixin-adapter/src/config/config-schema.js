import { z } from "zod";
/** Weixin adapter configuration schema. */
export const WeixinConfigSchema = z.object({
    /** Display name for this channel instance */
    name: z.string().optional(),
    /** Enable/disable the channel */
    enabled: z.boolean().optional().default(true),
    /** iLink Bot API base URL */
    baseUrl: z.string().optional().default("https://ilinkai.weixin.qq.com"),
    /** CDN base URL for media upload/download */
    cdnBaseUrl: z.string().optional().default("https://novac2c.cdn.weixin.qq.com/c2c"),
    /** Optional SKRouteTag */
    routeTag: z.number().optional(),
});
/** Per-account config overrides. */
export const WeixinAccountConfigSchema = z.object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    baseUrl: z.string().optional(),
    cdnBaseUrl: z.string().optional(),
    routeTag: z.number().optional(),
});
