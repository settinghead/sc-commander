#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Default: MLX on Apple Silicon, PyTorch elsewhere (CUDA/MPS/CPU)
if [[ "$(uname -m)" == "arm64" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
    export QWEN_TTS_RUNTIME=${QWEN_TTS_RUNTIME:-mlx}
else
    export QWEN_TTS_RUNTIME=${QWEN_TTS_RUNTIME:-pytorch}
fi

resolve_python() {
    if [[ -x "$SCRIPT_DIR/venv/bin/python" ]]; then
        printf '%s\n' "$SCRIPT_DIR/venv/bin/python"
        return 0
    fi
    if [[ -x "$SCRIPT_DIR/venv/bin/python3" ]]; then
        printf '%s\n' "$SCRIPT_DIR/venv/bin/python3"
        return 0
    fi
    if command -v python >/dev/null 2>&1; then
        command -v python
        return 0
    fi
    if command -v python3 >/dev/null 2>&1; then
        command -v python3
        return 0
    fi
    return 1
}

uv_bootstrap() {
    local uv_args=(run --with-requirements requirements.txt)
    if [[ "$QWEN_TTS_RUNTIME" == "mlx" ]] && [[ "$(uname -m)" == "arm64" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
        uv_args+=(--with-requirements requirements-mlx.txt)
    fi
    exec env QWEN_TTS_UV_BOOTSTRAPPED=1 uv "${uv_args[@]}" ./run.sh
}

if ! PYTHON_BIN="$(resolve_python)"; then
    if command -v uv >/dev/null 2>&1 && [[ "${QWEN_TTS_UV_BOOTSTRAPPED:-0}" != "1" ]]; then
        echo "==> No Python interpreter found. Bootstrapping with uv…"
        uv_bootstrap
    fi
    echo "Python environment not found."
    echo "Run ./setup.sh to create the local venv, or start with uv run ./run.sh."
    exit 1
fi

if ! "$PYTHON_BIN" -c "import fastapi, soundfile" >/dev/null 2>&1; then
    if command -v uv >/dev/null 2>&1 && [[ "${QWEN_TTS_UV_BOOTSTRAPPED:-0}" != "1" ]]; then
        echo "==> Python dependencies are missing for $PYTHON_BIN. Bootstrapping with uv…"
        uv_bootstrap
    fi
    echo "Python dependencies are missing for $PYTHON_BIN."
    echo "Run ./setup.sh, or use uv with requirements."
    exit 1
fi

MAX_RESTARTS=10
COOLDOWN=3
restarts=0

while true; do
    echo "==> Starting Qwen3-TTS server (restart #$restarts)…"
    QWEN_TTS_RUNTIME=${QWEN_TTS_RUNTIME:-mlx} "$PYTHON_BIN" server.py
    exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        echo "==> Server exited cleanly."
        break
    fi

    restarts=$((restarts + 1))
    if (( restarts >= MAX_RESTARTS )); then
        echo "==> Crashed $restarts times — giving up."
        exit 1
    fi

    echo "==> Server crashed (exit $exit_code). Restarting in ${COOLDOWN}s… ($restarts/$MAX_RESTARTS)"
    sleep "$COOLDOWN"
done
