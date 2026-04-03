import fs from "node:fs";
import path from "node:path";
import { resolveTempDir } from "../storage/state-dir";
/**
 * Simple structured logger for the weixin adapter.
 * Writes JSON lines to a log file and optionally to console.
 * Replaces the openclaw-dependent logger.
 */
const LOG_DIR = resolveTempDir();
const SUBSYSTEM = "renx-code/weixin-adapter";
const LEVEL_IDS = {
    TRACE: 1,
    DEBUG: 2,
    INFO: 3,
    WARN: 4,
    ERROR: 5,
    FATAL: 6,
};
const DEFAULT_LOG_LEVEL = "INFO";
function resolveMinLevel() {
    const env = process.env.RENX_LOG_LEVEL?.toUpperCase();
    if (env && env in LEVEL_IDS)
        return LEVEL_IDS[env];
    return LEVEL_IDS[DEFAULT_LOG_LEVEL];
}
let minLevelId = resolveMinLevel();
/** Dynamically change the minimum log level at runtime. */
export function setLogLevel(level) {
    const upper = level.toUpperCase();
    if (!(upper in LEVEL_IDS)) {
        throw new Error(`Invalid log level: ${level}. Valid levels: ${Object.keys(LEVEL_IDS).join(", ")}`);
    }
    minLevelId = LEVEL_IDS[upper];
}
function toLocalISO(now) {
    const offsetMs = -now.getTimezoneOffset() * 60_000;
    const sign = offsetMs >= 0 ? "+" : "-";
    const abs = Math.abs(now.getTimezoneOffset());
    const offStr = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    return new Date(now.getTime() + offsetMs).toISOString().replace("Z", offStr);
}
function localDateKey(now) {
    return toLocalISO(now).slice(0, 10);
}
function resolveMainLogPath() {
    const dateKey = localDateKey(new Date());
    return path.join(LOG_DIR, `renx-weixin-${dateKey}.log`);
}
let logDirEnsured = false;
function buildLoggerName(accountId) {
    return accountId ? `${SUBSYSTEM}/${accountId}` : SUBSYSTEM;
}
function writeLog(level, message, accountId) {
    const levelId = LEVEL_IDS[level] ?? LEVEL_IDS.INFO;
    if (levelId < minLevelId)
        return;
    const now = new Date();
    const prefixedMessage = accountId ? `[${accountId}] ${message}` : message;
    const entry = JSON.stringify({
        logger: buildLoggerName(accountId),
        message: prefixedMessage,
        level,
        time: toLocalISO(now),
    });
    try {
        if (!logDirEnsured) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
            logDirEnsured = true;
        }
        fs.appendFileSync(resolveMainLogPath(), `${entry}\n`, "utf-8");
    }
    catch {
        // Best-effort; never block on logging failures.
    }
}
function createLogger(accountId) {
    return {
        info(message) { writeLog("INFO", message, accountId); },
        debug(message) { writeLog("DEBUG", message, accountId); },
        warn(message) { writeLog("WARN", message, accountId); },
        error(message) { writeLog("ERROR", message, accountId); },
        withAccount(id) { return createLogger(id); },
        getLogFilePath() { return resolveMainLogPath(); },
        close() { },
    };
}
export const logger = createLogger();
