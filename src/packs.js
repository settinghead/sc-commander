import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { PACKS_DIR, PACK_VOLUME_CACHE_DIR } from "./paths.js";

// Target mean volume in dBFS — voices are normalized to this level
const TARGET_MEAN_DB = -16;

/**
 * Analyze a WAV file's mean volume using ffmpeg volumedetect.
 * Returns mean_volume in dBFS, or null on failure.
 */
function analyzeVolume(wavPath) {
  try {
    const output = execSync(
      `ffmpeg -i "${wavPath}" -af volumedetect -f null /dev/null 2>&1`,
      { encoding: "utf-8", timeout: 10000 },
    );
    const match = output.match(/mean_volume:\s*([-\d.]+)\s*dB/);
    if (match) return parseFloat(match[1]);
  } catch {
    // ffmpeg not available or analysis failed
  }
  return null;
}

/**
 * Get volume offset in dB for a pack's voice file.
 * Caches result in ~/.voiceforge/pack-volume/<pack-id>.json.
 */
function getVolumeOffsetDb(voicePath, packId) {
  if (!voicePath || !existsSync(voicePath)) return 0;

  let stats;
  try {
    stats = statSync(voicePath);
  } catch {
    return 0;
  }

  const voiceKey = createHash("sha1").update(voicePath).digest("hex");

  // Check cache
  const cachePath = join(PACK_VOLUME_CACHE_DIR, `${packId || "_legacy"}.json`);
  try {
    const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
    if (
      cached.voiceKey === voiceKey &&
      cached.mtimeMs === Math.round(stats.mtimeMs) &&
      cached.size === stats.size &&
      typeof cached.offsetDb === "number"
    ) {
      return cached.offsetDb;
    }
  } catch {
    // no cache or invalid
  }

  // Analyze and cache
  const meanDb = analyzeVolume(voicePath);
  if (meanDb == null) return 0;

  const offsetDb = Math.round((TARGET_MEAN_DB - meanDb) * 10) / 10;
  try {
    mkdirSync(PACK_VOLUME_CACHE_DIR, { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        voiceKey,
        mtimeMs: Math.round(stats.mtimeMs),
        size: stats.size,
        meanDb,
        offsetDb,
      }) + "\n",
    );
  } catch {
    // best-effort caching
  }
  return offsetDb;
}

/**
 * Load a voice pack by id (from config.active_pack).
 * Returns { id, name, echo, voicePath, style, fallback_phrases }.
 * Falls back to legacy config.voice if no active_pack is set.
 */
export function loadPack(config) {
  let packId = config.active_pack;

  // Random mode: pick a random pack each time
  if (packId === "random") {
    const packs = listPacks();
    if (packs.length > 0) {
      packId = packs[Math.floor(Math.random() * packs.length)].id;
    } else {
      packId = null;
    }
  }

  // Legacy fallback: no active_pack configured
  if (!packId) {
    return {
      id: "_legacy",
      name: "Legacy",
      echo: true,
      voicePath: config.voice || "default.wav",
      volumeOffsetDb: 0,
      style: null,
      fallback_phrases: null,
    };
  }

  const packDir = join(PACKS_DIR, packId);
  const packJsonPath = join(packDir, "pack.json");

  let packData;
  try {
    packData = JSON.parse(readFileSync(packJsonPath, "utf-8"));
  } catch {
    // Pack not found or invalid — fall back to defaults
    return {
      id: packId,
      name: packId,
      echo: true,
      voicePath: config.voice || "default.wav",
      volumeOffsetDb: 0,
      style: null,
      fallback_phrases: null,
    };
  }

  // Resolve voice path: relative to pack dir, or fall back to config.voice
  let voicePath = config.voice || "default.wav";
  if (packData.voice) {
    const resolved = resolve(packDir, packData.voice);
    if (existsSync(resolved)) {
      voicePath = resolved;
    }
  }

  return {
    id: packId,
    name: packData.name || packId,
    echo: packData.echo !== false,
    voicePath,
    volumeOffsetDb: getVolumeOffsetDb(voicePath, packId),
    tts_params: packData.tts_params || null,
    audio_filter: packData.audio_filter || null,
    post_process: packData.post_process || null,
    style: packData.style || packData.system_prompt || null,
    examples: packData.examples || null,
    fallback_phrases: packData.fallback_phrases || null,
    overlay_colors: packData.overlay_colors || null,
  };
}

/**
 * List all available voice packs.
 * Returns [{ id, name }].
 */
export function listPacks() {
  const packs = [];
  let entries;
  try {
    entries = readdirSync(PACKS_DIR, { withFileTypes: true });
  } catch {
    return packs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packJsonPath = join(PACKS_DIR, entry.name, "pack.json");
    try {
      const data = JSON.parse(readFileSync(packJsonPath, "utf-8"));
      packs.push({ id: entry.name, name: data.name || entry.name });
    } catch {
      // skip invalid packs
    }
  }
  return packs;
}
