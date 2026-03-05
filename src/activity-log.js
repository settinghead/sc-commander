/**
 * Activity log: appends lines to ~/.voiceforge/voiceforge.log with retention.
 * Keeps last 30 days and 5MB total (LRU: drop oldest when over limit).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { STATE_DIR, MAIN_LOG_FILE } from "./paths.js";

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

// Parse timestamp from "[2024-01-15T12:00:00.000Z] ..."
function parseLineTime(line) {
  const m = line.match(/^\[([^\]]+)\]/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? null : t;
}

/**
 * Append a line to the activity log. Trims to 30 days and 5MB before appending.
 * No-op if config.logging === false.
 * @param {string} line - Full line including newline (e.g. "[ISO] source=cursor event=Stop category=task.complete phrase=...\n")
 * @param {{ logging?: boolean }} config - Config; only writes when logging !== false
 */
export function appendLog(line, config) {
  if (config && config.logging === false) return;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const now = Date.now();
    const cutoff = now - MAX_AGE_MS;
    let content = "";
    if (existsSync(MAIN_LOG_FILE)) {
      content = readFileSync(MAIN_LOG_FILE, "utf-8");
    }
    const lines = content ? content.split("\n").filter((l) => l.length > 0) : [];
    const withNewlines = lines.map((l) => l + "\n");
    const withinAge = withNewlines.filter((ln) => {
      const t = parseLineTime(ln);
      return t != null && t >= cutoff;
    });
    const newLine = line.endsWith("\n") ? line : line + "\n";
    const newBytes = Buffer.byteLength(newLine, "utf-8");
    let bytes = newBytes;
    const kept = [];
    for (let i = withinAge.length - 1; i >= 0; i--) {
      const ln = withinAge[i];
      const b = Buffer.byteLength(ln, "utf-8");
      if (bytes + b > MAX_BYTES) break;
      kept.unshift(ln);
      bytes += b;
    }
    kept.push(newLine);
    writeFileSync(MAIN_LOG_FILE, kept.join(""), "utf-8");
  } catch {
    // best-effort
  }
}
