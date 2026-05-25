# Qwen3-TTS (Voxlert TTS backend)

A FastAPI server that uses [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) for voice-cloned text-to-speech. Upload a short WAV reference plus transcript to create a `voice_id`, then synthesize speech with that voice.

## Installation

### Prerequisites

- **Python 3.13+**
- **16 GB RAM** minimum (32 GB recommended for 1.7B model)
- **~8 GB disk** for models + dependencies
- **Backend-specific:**
  - **MLX** (recommended on Mac): Apple Silicon (M1/M2/M3/M4)
  - **PyTorch + MPS**: Apple Silicon, macOS
  - **PyTorch + CUDA**: Linux or Windows with an NVIDIA GPU

### Quick start

The TTS server is a Python application that lives inside the Voxlert repository. If you installed Voxlert via `npm` or `npx`, you need to clone the repo first to get the server code:

```bash
git clone https://github.com/settinghead/voxlert.git
cd voxlert/cli/qwen3-tts-server
```

**macOS / Linux:** Run the setup script, then start the server:

```bash
# 1. Run first-time setup (venv, deps, model download)
./setup.sh

# 2. Start the server (MLX backend by default on Mac; see Backends below)
./run.sh

# Or run it from a uv-managed environment
uv run ./run.sh

# 3. Point Voxlert at it
voxlert config set tts_backend qwen
```

**Windows:** The scripts above are bash (e.g. `setup.sh`, `run.sh`). Use **WSL** or **Git Bash** to run them, or do the steps manually: create a venv, `pip install -r requirements.txt`, download the PyTorch models (see Troubleshooting → "Model not found"), then run `python server.py` with `QWEN_TTS_RUNTIME=pytorch` from `qwen3-tts-server`.

Generate speech directly:

```bash
VOICE_ID="$(
  curl -sS -X POST http://localhost:8100/voices \
    -F audio=@reference.wav \
    -F ref_text='大家好，欢迎来到课程。' \
    -F x_vector_only_mode=true |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["voice_id"])'
)"

curl -X POST http://localhost:8100/tts \
  -H 'Content-Type: application/json' \
  -d "{\"text\": \"这就是本模块要解决的核心问题。\", \"voice_id\": \"$VOICE_ID\", \"language\": \"Chinese\"}" \
  --output hello.wav
```

## Backends

| Backend | Best for | Runtime flag | Models |
|---------|----------|--------------|--------|
| **MLX** | Apple Silicon Macs (quantized, fast) | `QWEN_TTS_RUNTIME=mlx` (default on Mac) | Different 8-bit model; **downloaded automatically** when the server starts with MLX |
| **PyTorch + MPS** | Apple Silicon Macs (full precision) | `QWEN_TTS_RUNTIME=pytorch` on macOS | Same as CUDA — see below |
| **PyTorch + CUDA** | Linux/Windows with NVIDIA GPU | `QWEN_TTS_RUNTIME=pytorch` when CUDA is available | **Same** HuggingFace models as MPS; `./setup.sh` downloads them |

**PyTorch (MPS and CUDA)** use the same model checkpoints (`Qwen/Qwen3-TTS-12Hz-1.7B-Base` and optionally `0.6B`). No separate download for CUDA — run `./setup.sh` once; it downloads the PyTorch models and works on both Apple (MPS) and Linux/Windows (CUDA). **MLX** uses a different, quantized model and fetches it on first run.

The server chooses PyTorch device automatically: CUDA if available, else MPS (Apple), else CPU.

Example — run with PyTorch (MPS on Mac, or CUDA on Linux/Windows):

```bash
QWEN_TTS_RUNTIME=pytorch QWEN_TTS_MODEL=0.6B ./run.sh
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QWEN_TTS_RUNTIME` | `mlx` | Backend: `mlx` or `pytorch` |
| `QWEN_TTS_MLX_MODEL` | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit` | HuggingFace model ID for MLX |
| `QWEN_TTS_MODEL` | `1.7B` | PyTorch model size: `1.7B` or `0.6B` |
| `QWEN_TTS_TIMEOUT` | `600` | Per-request generation timeout in seconds |

## API endpoints

### `POST /voices`

Register a cloned voice from a reference WAV and transcript.

**Request:** multipart form data

| Field | Required | Notes |
|-------|----------|-------|
| `audio` | yes | Reference WAV/audio file |
| `ref_text` | yes | Transcript matching the reference audio |
| `x_vector_only_mode` | no | `true` uses speaker embedding only; `false` uses ICL/reference-code cloning |

For synthetic reference voices, prefer `x_vector_only_mode=true`. It keeps the
speaker color while avoiding the machine-generated cadence in the reference
clip.

**Response:**

```json
{"voice_id": "43b93e137986c16b"}
```

```bash
curl -X POST http://localhost:8100/voices \
  -F audio=@reference.wav \
  -F ref_text='大家好，欢迎来到课程。' \
  -F x_vector_only_mode=true
```

### `POST /tts`

Generate speech from text using a registered `voice_id`.

**Request:**

```json
{
  "text": "这就是本模块要解决的核心问题。",
  "voice_id": "43b93e137986c16b",
  "language": "Chinese",
  "temperature": 0.95,
  "subtalker_temperature": 0.95,
  "top_p": 1.0
}
```

**Response:** `audio/wav` (PCM 16-bit)

**Errors:** `404` if `voice_id` is not found, `504` if generation exceeds `QWEN_TTS_TIMEOUT_SECONDS` (default 600 s).

```bash
curl -X POST http://localhost:8100/tts \
  -H 'Content-Type: application/json' \
  -d '{"text": "这就是本模块要解决的核心问题。", "voice_id": "43b93e137986c16b", "language": "Chinese"}' \
  --output speech.wav
```

Supported PyTorch generation fields include `language`, `temperature`,
`top_k`, `top_p`, `repetition_penalty`, `subtalker_temperature`,
`subtalker_top_k`, `subtalker_top_p`, `max_new_tokens`, and
`non_streaming_mode`. The server defaults `language` to `Chinese`; callers
should still send it explicitly for production Chinese narration.

### `GET /health`

Returns server status, loaded model, runtime, and available voices.

```bash
curl http://localhost:8100/health | python3 -m json.tool
```

```json
{
    "model": "Qwen3-TTS-12Hz-1.7B-Base-8bit",
    "runtime": "mlx",
    "device": "apple-silicon-mlx",
    "voices": ["32230314c32ab3e5", "43b93e137986c16b", "..."]
}
```

`device` can be `apple-silicon-mlx`, `mps`, `cuda`, or `cpu`.

## Scripts reference

| Script | Purpose |
|--------|---------|
| `server.py` | FastAPI TTS server (the main application) |
| `run.sh` | Starts the server using `venv/bin/python`, `python`, or `python3` |
| `setup.sh` | First-time setup: creates or repairs `venv`, installs deps, downloads models |

## Voices

Uploaded voices live in `qwen3-tts-server/voices/`. Each voice directory contains:

- **`meta.json`** — metadata including `ref_text` and `x_vector_only_mode`
- **`voice.wav`** — a short reference audio clip of the target voice

The server reads all voices at startup and caches them. Only voices that have
both `voice.wav` and a non-empty `ref_text` in `meta.json` are loaded.

## Auto-start on boot

### macOS (LaunchAgent)

Create `~/Library/LaunchAgents/com.voxlert.qwen-tts.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.voxlert.qwen-tts</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/FULL/PATH/TO/cli/qwen3-tts-server/run.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOU/Library/Logs/qwen-tts.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOU/Library/Logs/qwen-tts.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
```

Replace `/FULL/PATH/TO/` and `/Users/YOU/` with real paths. Then load it:

```bash
# Load (starts immediately and on every future login)
launchctl load ~/Library/LaunchAgents/com.voxlert.qwen-tts.plist

# Unload
launchctl unload ~/Library/LaunchAgents/com.voxlert.qwen-tts.plist

# Check status
launchctl list | grep qwen-tts

# View logs
tail -f ~/Library/Logs/qwen-tts.log
```

**Note:** `run.sh` already restarts the server up to 10 times on crash, so the plist does not set `KeepAlive`. If the script itself exits (crash budget exhausted or clean shutdown), launchd will not re-launch it. To also let launchd restart the script after budget exhaustion, add `<key>KeepAlive</key><true/>` to the plist.

### Linux (systemd user service)

Create `~/.config/systemd/user/qwen-tts.service`:

```ini
[Unit]
Description=Qwen3-TTS server (Voxlert)
After=network.target

[Service]
Type=simple
ExecStart=/bin/bash /FULL/PATH/TO/cli/qwen3-tts-server/run.sh
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

Replace `/FULL/PATH/TO/` with the real path. Then enable it:

```bash
# Reload, enable (auto-start on login), and start now
systemctl --user daemon-reload
systemctl --user enable --now qwen-tts

# Check status
systemctl --user status qwen-tts

# View logs
journalctl --user -u qwen-tts -f

# Stop / disable
systemctl --user disable --now qwen-tts
```

**Note:** For the service to run without an active login session, enable lingering: `loginctl enable-linger $USER`.


## Troubleshooting

**Segfault or crash under concurrent requests**  
MLX and PyTorch MPS/CUDA are not fully thread-safe. The server serializes all inference behind a lock, but sending many requests in rapid succession can still cause memory pressure. Stick to one request at a time.

**Model not found (PyTorch backend)**  
The PyTorch backend looks for models in `models/Qwen3-TTS-12Hz-{size}-Base`. Run `./setup.sh` to download them, or manually:

```bash
python3 -c "
from huggingface_hub import snapshot_download
snapshot_download('Qwen/Qwen3-TTS-12Hz-1.7B-Base', local_dir='models/Qwen3-TTS-12Hz-1.7B-Base')
"
```

**MPS not available**  
Ensure you're on Apple Silicon with a recent macOS. Check with:

```bash
python3 -c "import torch; print(torch.backends.mps.is_available())"
```

**CUDA not used on Linux/Windows**  
Ensure PyTorch is installed with CUDA support and a GPU is available:

```bash
python3 -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

**MLX model download fails**  
The MLX backend auto-downloads from HuggingFace on first run. If you're behind a proxy, set `HF_HUB_OFFLINE=0` and ensure `huggingface_hub` can reach the internet.

**Voice not showing in /health**
The voice needs both `voice.wav` and a non-empty `ref_text` field in
`voices/<voice_id>/meta.json`. Prefer registering voices through `POST /voices`
so the server creates the correct metadata and model-specific prompt cache.
