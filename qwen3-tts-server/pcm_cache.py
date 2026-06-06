"""Disk-backed LRU cache for streaming TTS PCM output (s16le mono).

The `/tts/stream` endpoint (MLX) re-synthesizes on every request — even for an
identical phrase in the same voice. This caches the produced PCM keyed by
(text, voice_id) so a repeat request skips the GPU entirely. Unlike the
in-memory `cache.py` (which only the non-streaming `/tts` uses), this is
disk-backed and survives restarts, and it is shared across every client/device
hitting this engine.

Bounded by total bytes (LRU). A small JSON manifest persists the index. Disable
with QWEN_TTS_PCM_CACHE=0; tune with QWEN_TTS_PCM_CACHE_MAX_BYTES and
QWEN_TTS_PCM_CACHE_DIR.
"""

import hashlib
import json
import os
import threading
from collections import OrderedDict
from pathlib import Path

_ENABLED = os.environ.get("QWEN_TTS_PCM_CACHE", "1") != "0"
_MAX_BYTES = int(os.environ.get("QWEN_TTS_PCM_CACHE_MAX_BYTES", str(512 * 1024 * 1024)))
_DIR = Path(os.environ.get(
    "QWEN_TTS_PCM_CACHE_DIR", str(Path.home() / ".cache" / "qwen-tts-pcm")))

_lock = threading.Lock()
_index: "OrderedDict[str, dict]" = OrderedDict()  # key -> {"bytes": int, "sr": int}
_total = 0
_loaded = False


def _key(text: str, voice_id: str) -> str:
    h = hashlib.sha256()
    h.update((voice_id or "").encode("utf-8"))
    h.update(b"\x00")
    h.update((text or "").encode("utf-8"))
    return h.hexdigest()


def _manifest_path() -> Path:
    return _DIR / "manifest.json"


def _load_locked() -> None:
    global _total, _loaded
    if _loaded:
        return
    _loaded = True
    try:
        _DIR.mkdir(parents=True, exist_ok=True)
        mp = _manifest_path()
        if mp.exists():
            data = json.loads(mp.read_text())
            for k, v in data.items():
                _index[k] = {"bytes": int(v["bytes"]), "sr": int(v["sr"])}
                _total += int(v["bytes"])
    except Exception as e:  # noqa: BLE001 — cache is best-effort
        print(f"[pcm_cache] load failed: {e}")


def _save_locked() -> None:
    try:
        _manifest_path().write_text(json.dumps(dict(_index)))
    except Exception as e:  # noqa: BLE001
        print(f"[pcm_cache] save failed: {e}")


def get(text: str, voice_id: str):
    """Return (sample_rate, pcm_bytes) on a hit, else None."""
    if not _ENABLED:
        return None
    with _lock:
        _load_locked()
        k = _key(text, voice_id)
        meta = _index.get(k)
        if meta is None:
            return None
        f = _DIR / f"{k}.pcm"
        if not f.exists():
            _index.pop(k, None)
            return None
        try:
            data = f.read_bytes()
        except Exception:  # noqa: BLE001
            return None
        _index.move_to_end(k)
        return meta["sr"], data


def put(text: str, voice_id: str, sample_rate: int, data: bytes) -> None:
    """Store fully-synthesized PCM. No-op if already cached or on I/O error."""
    if not _ENABLED or not data:
        return
    global _total
    with _lock:
        _load_locked()
        k = _key(text, voice_id)
        if k in _index:
            return
        f = _DIR / f"{k}.pcm"
        try:
            f.write_bytes(data)
        except Exception as e:  # noqa: BLE001
            print(f"[pcm_cache] write failed: {e}")
            return
        _index[k] = {"bytes": len(data), "sr": int(sample_rate)}
        _total += len(data)
        while _total > _MAX_BYTES and _index:
            ok, ov = next(iter(_index.items()))
            _index.pop(ok, None)
            _total -= ov["bytes"]
            try:
                (_DIR / f"{ok}.pcm").unlink()
            except Exception:  # noqa: BLE001
                pass
        _save_locked()
