import { z } from "zod";
/** Weixin adapter configuration schema. */
export declare const WeixinConfigSchema: z.ZodObject<{
    /** Display name for this channel instance */
    name: z.ZodOptional<z.ZodString>;
    /** Enable/disable the channel */
    enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    /** iLink Bot API base URL */
    baseUrl: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    /** CDN base URL for media upload/download */
    cdnBaseUrl: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    /** Optional SKRouteTag */
    routeTag: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    baseUrl: string;
    cdnBaseUrl: string;
    name?: string | undefined;
    routeTag?: number | undefined;
}, {
    name?: string | undefined;
    enabled?: boolean | undefined;
    baseUrl?: string | undefined;
    cdnBaseUrl?: string | undefined;
    routeTag?: number | undefined;
}>;
export type WeixinConfig = z.infer<typeof WeixinConfigSchema>;
/** Per-account config overrides. */
export declare const WeixinAccountConfigSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    baseUrl: z.ZodOptional<z.ZodString>;
    cdnBaseUrl: z.ZodOptional<z.ZodString>;
    routeTag: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    enabled?: boolean | undefined;
    baseUrl?: string | undefined;
    cdnBaseUrl?: string | undefined;
    routeTag?: number | undefined;
}, {
    name?: string | undefined;
    enabled?: boolean | undefined;
    baseUrl?: string | undefined;
    cdnBaseUrl?: string | undefined;
    routeTag?: number | undefined;
}>;
export type WeixinAccountConfig = z.infer<typeof WeixinAccountConfigSchema>;
//# sourceMappingURL=config-schema.d.ts.map