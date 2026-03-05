/**
 * VoiceForge OpenClaw plugin.
 *
 * Registers agent_end lifecycle hook and spawns `voiceforge hook` with
 * Stop + source: "openclaw" when an agent run completes, so users get
 * voice notifications (especially for long-running tasks).
 *
 * Requires: VoiceForge installed and `voiceforge` on PATH when the gateway runs.
 */

import { spawn } from "child_process";
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HOOK_DEBUG_LOG = join(homedir(), ".voiceforge", "hook-debug.log");

function debugLog(msg, data) {
  try {
    mkdirSync(join(homedir(), ".voiceforge"), { recursive: true });
    const line =
      data !== undefined
        ? `[${new Date().toISOString()}] [voiceforge-plugin] ${msg} ${JSON.stringify(data)}\n`
        : `[${new Date().toISOString()}] [voiceforge-plugin] ${msg}\n`;
    appendFileSync(HOOK_DEBUG_LOG, line);
  } catch {
    // best-effort
  }
}

export default function register(api) {
  api.on(
    "agent_end",
    async (event, ctx) => {
      const config = api.config?.plugins?.entries?.voiceforge?.config ?? {};
      if (config.enabled === false) return;

      const minDurationSeconds = Number(config.minDurationSeconds) || 0;
      const startedAt = event?.startedAt ?? event?.context?.startedAt;
      const endedAt = event?.endedAt ?? event?.context?.endedAt;
      if (
        minDurationSeconds > 0 &&
        typeof startedAt === "number" &&
        typeof endedAt === "number"
      ) {
        const durationMs = endedAt - startedAt;
        if (durationMs < minDurationSeconds * 1000) return;
      }

      let lastAssistantMessage = "";
      const messages = event?.messages ?? event?.context?.messages ?? [];
      if (Array.isArray(messages) && messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last?.content ?? last?.text) {
          lastAssistantMessage = String(last.content ?? last.text).slice(0, 2000);
        }
      }
      if (!lastAssistantMessage && event?.context?.sessionEntry) {
        lastAssistantMessage = String(event.context.sessionEntry).slice(0, 2000);
      }

      const cwd =
        event?.context?.workspaceDir ??
        event?.context?.workspace ??
        ctx?.workspaceDir ??
        ctx?.workspace ??
        "";

      const payload = {
        hook_event_name: "Stop",
        source: "openclaw",
        cwd: typeof cwd === "string" ? cwd : "",
        last_assistant_message: lastAssistantMessage || undefined,
      };

      try {
        debugLog("agent_end: spawning voiceforge hook", payload);
      } catch {
        // ignore
      }

      const child = spawn("voiceforge", ["hook"], {
        stdio: ["pipe", "ignore", "ignore"],
        detached: true,
      });

      child.on("error", (err) => {
        debugLog("voiceforge spawn error", {
          message: err.message,
          code: err.code,
        });
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
      child.unref();
    },
    { priority: 0 }
  );
}
