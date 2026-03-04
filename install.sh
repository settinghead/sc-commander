#!/usr/bin/env bash
set -euo pipefail

# VoiceForge Installer
# Installs VoiceForge hooks into Claude Code

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.claude/hooks/voiceforge"
SKILL_DIR="$HOME/.claude/skills/voiceforge-config"
SETTINGS_FILE="$HOME/.claude/settings.json"

echo "=== VoiceForge Installer ==="
echo ""

# --- Prerequisites ---
if [[ "$(uname)" != "Darwin" ]]; then
    echo "WARNING: VoiceForge uses 'afplay' for audio playback (macOS only)."
    echo "On Linux, edit config to use paplay/pw-play instead."
    echo ""
fi

if ! command -v node &>/dev/null; then
    echo "ERROR: node is required but not found."
    exit 1
fi

# --- Detect fresh install vs update ---
if [[ -d "$INSTALL_DIR" ]]; then
    echo "Detected existing installation — updating..."
    IS_UPDATE=true
else
    echo "Fresh installation..."
    IS_UPDATE=false
fi

# --- Copy files ---
mkdir -p "$INSTALL_DIR/src"
cp "$REPO_DIR/src/"*.js "$INSTALL_DIR/src/"
cp "$REPO_DIR/package.json" "$INSTALL_DIR/"
cp "$REPO_DIR/voiceforge.sh" "$INSTALL_DIR/"
cp "$REPO_DIR/config.default.json" "$INSTALL_DIR/"
cp "$REPO_DIR/uninstall.sh" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/voiceforge.sh"
chmod +x "$INSTALL_DIR/uninstall.sh"
chmod +x "$INSTALL_DIR/src/voiceforge.js"

# --- Copy packs ---
if [[ -d "$REPO_DIR/packs" ]]; then
    # Copy pack.json files (voice.wav files are user-provided, don't overwrite)
    for pack_dir in "$REPO_DIR/packs"/*/; do
        pack_name="$(basename "$pack_dir")"
        mkdir -p "$INSTALL_DIR/packs/$pack_name"
        cp "$pack_dir/pack.json" "$INSTALL_DIR/packs/$pack_name/" 2>/dev/null || true
        # Copy voice.wav only if it exists in repo and not already installed
        if [[ -f "$pack_dir/voice.wav" ]] && [[ ! -f "$INSTALL_DIR/packs/$pack_name/voice.wav" ]]; then
            cp "$pack_dir/voice.wav" "$INSTALL_DIR/packs/$pack_name/"
        fi
    done
    echo "  Copied voice packs to $INSTALL_DIR/packs"
fi

echo "  Copied core files to $INSTALL_DIR"

# --- Install npm dependencies ---
echo "  Installing dependencies..."
cd "$INSTALL_DIR" && npm install --production --silent 2>/dev/null
cd "$REPO_DIR"

# --- Config (backfill on update) ---
if [[ "$IS_UPDATE" == true ]] && [[ -f "$INSTALL_DIR/config.json" ]]; then
    node -e "
const fs = require('fs');
const defaults = JSON.parse(fs.readFileSync('$INSTALL_DIR/config.default.json', 'utf-8'));
const current = JSON.parse(fs.readFileSync('$INSTALL_DIR/config.json', 'utf-8'));
let changed = false;
for (const [k, v] of Object.entries(defaults)) {
    if (!(k in current)) {
        current[k] = v;
        changed = true;
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v) &&
               typeof current[k] === 'object' && current[k] !== null && !Array.isArray(current[k])) {
        for (const [sk, sv] of Object.entries(v)) {
            if (!(sk in current[k])) {
                current[k][sk] = sv;
                changed = true;
            }
        }
    }
}
if (changed) {
    fs.writeFileSync('$INSTALL_DIR/config.json', JSON.stringify(current, null, 2) + '\n');
    console.log('  Backfilled new config keys into existing config.json');
} else {
    console.log('  Existing config.json is up to date');
}
"
fi

# --- Cache directory ---
mkdir -p "$INSTALL_DIR/cache"

# --- Run setup wizard ---
echo ""
echo "Launching setup wizard..."
echo ""
node "$INSTALL_DIR/src/cli.js" setup --from-install-sh

echo ""
echo "To reconfigure: node $INSTALL_DIR/src/cli.js setup"
echo "To uninstall:   bash $INSTALL_DIR/uninstall.sh"
