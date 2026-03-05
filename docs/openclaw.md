# OpenClaw Integration

VoiceForge can notify you when [OpenClaw](https://openclaw.dev) agent runs complete — especially useful for long-running tasks. A spoken phrase is generated from the run context and played through your configured VoiceForge voice and TTS backend.

This integration uses an **OpenClaw plugin** (not a gateway hook). The plugin subscribes to the `agent_end` lifecycle event and spawns `voiceforge hook` with a `Stop` event so you hear a character voice when each run finishes.

## Prerequisites

- **VoiceForge** installed and configured: run `voiceforge setup` (or use an existing config at `~/.voiceforge/config.json`).
- **OpenClaw** gateway running.
- **`voiceforge` on PATH** for the process that runs the gateway (so the plugin can spawn `voiceforge hook`). If you installed VoiceForge with `npm install -g @settinghead/voiceforge`, ensure the global bin directory is on the PATH used by the gateway.

## Installation

### From the VoiceForge repo

If you have the VoiceForge repository (e.g. a git clone):

```bash
openclaw plugins install /path/to/voiceforge/openclaw-plugin
```

To link instead of copy (for development):

```bash
openclaw plugins install -l /path/to/voiceforge/openclaw-plugin
```

Restart the OpenClaw gateway after installing. The plugin is enabled by default.

### From npm (if published)

If a package like `@settinghead/voiceforge-openclaw` is published:

```bash
openclaw plugins install @settinghead/voiceforge-openclaw
```

## Configuration

- **VoiceForge config** is shared: `~/.voiceforge/config.json` (or `voiceforge config path`). Use `voiceforge setup` or `voiceforge config set` to change voice pack, LLM, TTS, volume, and categories. No separate config for the plugin.

- **Plugin config** (optional) lives under OpenClaw’s config, e.g. `plugins.entries.voiceforge.config` in `~/.openclaw/openclaw.json`:

  | Field                | Type    | Default | Description                                                                 |
  |----------------------|---------|---------|-----------------------------------------------------------------------------|
  | `enabled`            | boolean | `true`  | Master switch: set to `false` to stop the plugin from calling VoiceForge.  |
  | `minDurationSeconds` | number  | `0`     | Only notify for runs that lasted at least this many seconds (0 = always).  |

Example: notify only for runs longer than 30 seconds:

```json
"plugins": {
  "entries": {
    "voiceforge": {
      "enabled": true,
      "config": {
        "minDurationSeconds": 30
      }
    }
  }
}
```

Restart the gateway after changing plugin config.

## How it works

1. An OpenClaw agent run completes (success, error, or timeout).
2. The plugin’s `agent_end` handler runs.
3. If `enabled` is not `false` and (if set) the run duration is at least `minDurationSeconds`, the plugin builds a payload with the last assistant message and workspace path (when available).
4. It spawns `voiceforge hook` with stdin: `{ "hook_event_name": "Stop", "source": "openclaw", "last_assistant_message": "...", "cwd": "..." }`.
5. VoiceForge runs its usual pipeline: LLM phrase (or fallback) → TTS → playback. Activity is logged to `~/.voiceforge/voiceforge.log` with `source=openclaw`.

## Uninstall

- Disable the plugin: `openclaw plugins disable voiceforge` (or set `plugins.entries.voiceforge.enabled` to `false` in config), then restart the gateway.
- Remove the plugin: delete or uninstall the plugin from `~/.openclaw/extensions/voiceforge` (or run `openclaw plugins uninstall` if supported). Restart the gateway.

VoiceForge config and CLI are unchanged; only the OpenClaw integration is removed.

## Troubleshooting

- **No voice when a run completes**
  - Ensure `voiceforge` is on the PATH of the user/process that runs the OpenClaw gateway. Test with `which voiceforge` in the same environment.
  - Check that VoiceForge is enabled and the `task.complete` category is not disabled: `voiceforge config` and `voiceforge config set categories.task.complete true` if needed.
  - Confirm the plugin is enabled: `openclaw plugins list` should show the voiceforge plugin as enabled.

- **Debug logging**
  - Hook debug lines (including plugin spawns) are written to `~/.voiceforge/hook-debug.log`. Use `tail -f ~/.voiceforge/hook-debug.log` while triggering an agent run to see whether the plugin runs and what payload it sends.
  - Activity log: `tail -f ~/.voiceforge/voiceforge.log` to see lines with `source=openclaw` when VoiceForge processes an event.

- **Plugin not loading**
  - Restart the OpenClaw gateway after installing or updating the plugin.
  - Ensure `openclaw.plugin.json` and `index.ts` (or the entry file) are present in the plugin directory.
