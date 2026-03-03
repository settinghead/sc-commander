#!/usr/bin/env node
/**
 * VoiceForge - Game character voice notifications for Claude Code.
 *
 * Generates contextual 2-8 word phrases via OpenRouter LLM,
 * speaks them through a local Chatterbox TTS server.
 */

import { basename } from "path";
import { appendFileSync, mkdirSync } from "fs";
import { loadConfig, EVENT_MAP, CONTEXTUAL_EVENTS, FALLBACK_PHRASES } from "./config.js";
import { extractContext, generatePhraseLlm } from "./llm.js";
import { speakPhrase } from "./audio.js";
import { STATE_DIR, LOG_FILE } from "./paths.js";

function logFallback(eventName, reason, detail) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const ts = new Date().toISOString();
    const line = detail
      ? `[${ts}] event=${eventName} reason=${reason} detail=${typeof detail === "string" ? detail : JSON.stringify(detail)}\n`
      : `[${ts}] event=${eventName} reason=${reason}\n`;
    appendFileSync(LOG_FILE, line);
  } catch {
    // best-effort logging
  }
}

async function main() {
  // Read event data from stdin
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let eventData;
  try {
    eventData = JSON.parse(input);
  } catch {
    return;
  }

  const config = loadConfig();
  if (config.enabled === false) return;

  const eventName = eventData.hook_event_name || "";
  const category = EVENT_MAP[eventName];
  if (!category) return;

  // Check if category is enabled
  const categories = config.categories || {};
  if (categories[category] === false) return;

  // Extract project name from cwd
  const cwd = eventData.cwd || "";
  const projectName = cwd ? basename(cwd) : "";

  // For contextual events, try LLM phrase generation
  let phrase = null;
  if (CONTEXTUAL_EVENTS.has(eventName)) {
    const context = extractContext(eventData);
    if (context) {
      phrase = await generatePhraseLlm(context, config);
    }
  }

  // Fall back to predefined phrases
  if (!phrase) {
    const phrases = FALLBACK_PHRASES[category] || ["Standing by"];
    phrase = phrases[Math.floor(Math.random() * phrases.length)];
  }

  // Prepend project name as prefix
  if (projectName) {
    phrase = `${projectName}, ${phrase}`;
  }

  await speakPhrase(phrase, config);
}

main();
