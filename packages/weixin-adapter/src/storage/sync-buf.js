import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "./state-dir";
/** Resolve the sync buf file path for an account. */
export function getSyncBufFilePath(accountId) {
    return path.join(resolveStateDir(), "weixin", "accounts", `${accountId}.sync.json`);
}
/** Load the persisted getUpdates buffer. */
export function loadGetUpdatesBuf(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return undefined;
        const raw = fs.readFileSync(filePath, "utf-8").trim();
        if (!raw)
            return undefined;
        const parsed = JSON.parse(raw);
        return parsed.get_updates_buf || undefined;
    }
    catch {
        return undefined;
    }
}
/** Persist the getUpdates buffer. */
export function saveGetUpdatesBuf(filePath, buf) {
    try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({ get_updates_buf: buf }, null, 2), "utf-8");
    }
    catch (err) {
        // Best-effort
    }
}
