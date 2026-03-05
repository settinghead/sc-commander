/**
 * VoiceForge hook handler for OpenClaw.
 *
 * Translates OpenClaw hook events into VoiceForge-compatible JSON
 * and spawns `voiceforge hook` with the translated event on stdin.
 *
 * Must export a default async function — OpenClaw loads hooks via
 * `await import()` and calls the default export with the event object.
 */

import { spawn } from "child_process";
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const OPENCLAW_DEBUG_LOG = join(homedir(), ".voiceforge", "openclaw-debug.log");
function debugLog(msg, data) {
  try {
    mkdirSync(join(homedir(), ".voiceforge"), { recursive: true });
    const line = data !== undefined
      ? `[${new Date().toISOString()}] [openclaw-handler] ${msg} ${JSON.stringify(data)}\n`
      : `[${new Date().toISOString()}] [openclaw-handler] ${msg}\n`;
    appendFileSync(OPENCLAW_DEBUG_LOG, line);
  } catch {
    // best-effort
  }
}

// OpenClaw event type:action -> VoiceForge hook_event_name
const EVENT_MAP: Record<string, string> = {
  "command:stop": "Stop",
  "command:new": "SessionStart",
  "command:reset": "SessionStart",
  "message:received": "UserPromptSubmit",
};

const handler = async (event: {
  type: string;
  action: string;
  sessionKey?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}) => {
  const key = `${event.type}:${event.action}`;
  debugLog("handler invoked", { key, type: event.type, action: event.action });
  const hookEventName = EVENT_MAP[key];
  if (!hookEventName) {
    debugLog("handler skip: no mapping for event", { key });
    return;
  }

  const translated: Record<string, unknown> = {
    hook_event_name: hookEventName,
    source: "openclaw",
  };

  if (event.context?.cwd) {
    translated.cwd = event.context.cwd;
  }

  // For stop events, pass session content for LLM context
  if (key === "command:stop" && event.context?.sessionEntry) {
    translated.last_assistant_message = event.context.sessionEntry;
  }

  // For message events, pass user content
  if (key === "message:received" && event.context?.content) {
    translated.last_assistant_message = event.context.content;
  }

  debugLog("spawning voiceforge hook", { translated });
  // Spawn `voiceforge hook` with translated event on stdin (fire-and-forget)
  const child = spawn("voiceforge", ["hook"], {
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
  });

  child.on("error", (err) => {
    debugLog("voiceforge spawn error", { message: err.message, code: (err as NodeJS.ErrnoException).code });
  });

  child.stdin.write(JSON.stringify(translated));
  child.stdin.end();
  child.unref();
  debugLog("voiceforge hook spawned, stdin ended");
};

export default handler;
