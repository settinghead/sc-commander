/**
 * VoiceForge — On-screen notification wrapper.
 *
 * - macOS: Custom Cocoa overlay via JXA (overlay.jxa) — gradient, icon, stacking.
 * - Windows/Linux: System notifications via node-notifier (native toasts / notify-send).
 * No-op when overlay is disabled in config.
 */

import { join, dirname } from "path";
import { existsSync, mkdirSync, rmdirSync, readdirSync, statSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_DIR = dirname(__dirname);
const JXA_SCRIPT = join(__dirname, "overlay.jxa");
const SLOT_DIR = "/tmp/voiceforge-popups";
const MAX_SLOTS = 5;
const STALE_MS = 60_000;

const OVERLAY_DEBUG = process.env.VOICEFORGE_OVERLAY_DEBUG === "1" || process.env.VOICEFORGE_OVERLAY_DEBUG === "true";
function overlayDebug(msg, ...args) {
  if (OVERLAY_DEBUG) console.error("[voiceforge overlay]", msg, ...args);
}

// Default gradient (dark charcoal)
const DEFAULT_COLORS = [[0.15, 0.15, 0.2], [0.1, 0.1, 0.15]];

/**
 * Acquire a slot for vertical stacking. Uses mkdir for race-safe locking.
 * Returns slot index (0-based) or -1 if all slots taken.
 */
function acquireSlot() {
  mkdirSync(SLOT_DIR, { recursive: true });

  // Clean stale slots first
  try {
    const entries = readdirSync(SLOT_DIR);
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.startsWith("slot-")) continue;
      try {
        const st = statSync(join(SLOT_DIR, entry));
        if (now - st.mtimeMs > STALE_MS) {
          rmdirSync(join(SLOT_DIR, entry));
        }
      } catch {
        // already removed
      }
    }
  } catch {
    // best-effort cleanup
  }

  // Try to acquire a slot
  for (let i = 0; i < MAX_SLOTS; i++) {
    const slotPath = join(SLOT_DIR, `slot-${i}`);
    try {
      mkdirSync(slotPath);
      return i;
    } catch {
      // slot taken, try next
    }
  }
  return -1;
}

/**
 * Release a slot after dismiss + buffer time.
 */
function releaseSlotAfter(slot, delaySecs) {
  const slotPath = join(SLOT_DIR, `slot-${slot}`);
  setTimeout(() => {
    try {
      rmdirSync(slotPath);
    } catch {
      // already removed
    }
  }, delaySecs * 1000);
}

/**
 * Resolve icon path for a pack. Looks for assets/{packId}.{png,jpg,gif}.
 */
function resolveIcon(packId) {
  if (!packId) return "";
  const exts = ["png", "jpg", "gif"];
  for (const ext of exts) {
    const p = join(SCRIPT_DIR, "assets", `${packId}.${ext}`);
    if (existsSync(p)) return p;
  }
  return "";
}

/**
 * Show an overlay notification.
 *
 * Fire-and-forget — spawns osascript detached and returns immediately.
 *
 * @param {string} phrase - The phrase to display
 * @param {object} opts
 * @param {string} opts.category - Event category
 * @param {string} opts.packName - Display name of the voice pack
 * @param {string} opts.packId - Pack identifier (for icon lookup)
 * @param {string} opts.prefix - Resolved prefix string
 * @param {object} opts.config - Loaded config object
 * @param {Array} [opts.overlayColors] - Gradient colors from pack
 */
export function showOverlay(phrase, { category, packName, packId, prefix, config, overlayColors } = {}) {
  overlayDebug("showOverlay called", { phrase: phrase?.slice(0, 40), platform: process.platform, configOverlay: config?.overlay });

  if (config && config.overlay === false) {
    overlayDebug("skip: overlay disabled in config");
    return;
  }

  const platform = process.platform;
  const style = config?.overlay_style || "custom";

  // Use system notification (node-notifier) when style is "system" or on non-darwin (no custom option there)
  const useSystem = style === "system" || platform === "win32" || platform === "linux";

  // Build subtitle and display phrase (shared)
  let subtitle = "";
  const parts = [];
  if (prefix) parts.push(prefix);
  if (packName) parts.push(packName.toUpperCase());
  subtitle = parts.join("  ·  ");
  let displayPhrase = phrase;
  if (prefix && phrase.startsWith(prefix + "; ")) {
    displayPhrase = phrase.slice(prefix.length + 2);
  }
  const iconPath = resolveIcon(packId);

  // --- System notification (node-notifier): Windows, Linux, or macOS when overlay_style === "system" ---
  if (useSystem) {
    try {
      const notifier = require("node-notifier");
      notifier.notify({
        title: subtitle || "VoiceForge",
        message: displayPhrase || phrase,
        icon: iconPath || undefined,
        sound: false,
      });
      overlayDebug("node-notifier sent");
    } catch (err) {
      overlayDebug("node-notifier failed", err?.message || err);
    }
    return;
  }

  // --- macOS only: custom JXA overlay (when overlay_style === "custom") ---
  if (platform !== "darwin") {
    overlayDebug("skip: unsupported platform");
    return;
  }

  if (!existsSync(JXA_SCRIPT)) {
    overlayDebug("skip: JXA script not found", JXA_SCRIPT);
    return;
  }
  overlayDebug("JXA script exists", JXA_SCRIPT);

  const dismissSecs = (config && config.overlay_dismiss) || 4;
  const colors = overlayColors || DEFAULT_COLORS;

  // Acquire stacking slot
  const slot = acquireSlot();
  if (slot < 0) {
    overlayDebug("skip: no free slot (all slots taken)");
    return;
  }
  overlayDebug("acquired slot", slot);

  // Spawn osascript detached
  const args = [
    "-l", "JavaScript",
    JXA_SCRIPT,
    displayPhrase,
    JSON.stringify(colors),
    iconPath,
    String(slot),
    String(dismissSecs),
    subtitle,
  ];
  overlayDebug("spawning osascript", args.slice(0, 4), "...");

  try {
    const child = spawn("osascript", args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    overlayDebug("osascript spawned pid", child.pid);
  } catch (err) {
    overlayDebug("osascript spawn failed", err?.message || err);
    // best-effort — don't break audio pipeline
  }

  // Schedule slot release after dismiss + 2s buffer
  releaseSlotAfter(slot, dismissSecs + 2);
}
