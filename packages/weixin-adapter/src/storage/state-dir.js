import os from "node:os";
import path from "node:path";
/**
 * Resolve the state directory for renx-code weixin adapter.
 * Replaces openclaw's resolveStateDir / resolvePreferredOpenClawTmpDir.
 */
export function resolveStateDir() {
    return (process.env.RENX_STATE_DIR?.trim() ||
        process.env.OPENCLAW_STATE_DIR?.trim() ||
        path.join(os.homedir(), ".renx-code"));
}
/**
 * Resolve the temp directory for logs and transient files.
 */
export function resolveTempDir() {
    return (process.env.RENX_TEMP_DIR?.trim() ||
        path.join(resolveStateDir(), "tmp"));
}
