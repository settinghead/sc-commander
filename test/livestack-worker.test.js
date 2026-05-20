import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLivestackWorkerLaunch } from "../src/commands/livestack-worker.js";

function createUnchainRoot() {
  const root = mkdtempSync(join(tmpdir(), "voxlert-unchain-root-"));
  mkdirSync(join(root, "scripts", "workers"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: {} }));
  writeFileSync(join(root, "scripts", "workers", "portable-livestack-worker.ts"), "");
  return root;
}

test("builds a Qwen TTS Livestack worker launch plan", () => {
  const unchainRoot = createUnchainRoot();
  const launch = buildLivestackWorkerLaunch({
    args: [
      "--unchain-root",
      unchainRoot,
      "--qwen-url",
      "http://127.0.0.1:18080",
      "--host-id",
      "zz-tower0",
      "--runtime",
      "cuda",
      "--device",
      "rtx-4090",
      "--model-id",
      "qwen3-tts",
      "--prompt-cache-version",
      "cache-v1",
    ],
    env: {},
    config: {},
  });

  assert.equal(launch.command, "npm");
  assert.deepEqual(launch.args, ["run", "worker:portable-livestack"]);
  assert.equal(launch.cwd, unchainRoot);
  assert.equal(launch.env.UNCHAIN_WORKER_SPECS, "qwen_tts.synthesize_segment,qwen_tts.synthesize_batch");
  assert.equal(launch.env.QWEN_TTS_URL, "http://127.0.0.1:18080");
  assert.equal(launch.env.UNCHAIN_HOST_ID, "zz-tower0");
  assert.deepEqual(JSON.parse(launch.env.UNCHAIN_WORKER_CAPABILITIES), [{
    kind: "qwen-tts",
    hostId: "zz-tower0",
    slots: 1,
    leaseTtlSeconds: 300,
    labels: {
      provider: "qwen",
      runtime: "cuda",
      device: "rtx-4090",
      model: "qwen3-tts",
      promptCacheVersion: "cache-v1",
    },
    localService: {
      baseUrl: "http://127.0.0.1:18080",
      healthPath: "/health",
    },
  }]);
  assert.equal(launch.env.QWEN_TTS_MODEL_ID, "qwen3-tts");
  assert.equal(launch.env.QWEN_TTS_PROMPT_CACHE_VERSION, "cache-v1");
});

test("uses environment worker settings when no CLI override is provided", () => {
  const unchainRoot = createUnchainRoot();
  const launch = buildLivestackWorkerLaunch({
    args: [],
    env: {
      UNCHAIN_ROOT: unchainRoot,
      UNCHAIN_WORKER_SPECS: "qwen_tts.synthesize_segment,qwen_tts.synthesize_batch",
      QWEN_TTS_URL: "http://localhost:8101",
      UNCHAIN_OBJECT_STORE: "aliyun-oss",
      LIVESTACK_GATEWAY_URL: "http://gateway.local",
      LIVESTACK_VAULT_SERVER_URL: "vault.internal:50504",
    },
    config: {},
  });

  assert.equal(
    launch.env.UNCHAIN_WORKER_SPECS,
    "qwen_tts.synthesize_segment,qwen_tts.synthesize_batch",
  );
  assert.equal(launch.env.QWEN_TTS_URL, "http://localhost:8101");
  assert.equal(
    launch.env.UNCHAIN_WORKER_CAPABILITIES,
    JSON.stringify([{
      kind: "qwen-tts",
      hostId: "voxlert-qwen-tts",
      slots: 1,
      leaseTtlSeconds: 300,
      labels: { provider: "qwen" },
      localService: {
        baseUrl: "http://localhost:8101",
        healthPath: "/health",
      },
    }]),
  );
  assert.equal(launch.displayEnv.UNCHAIN_OBJECT_STORE, "aliyun-oss");
  assert.equal(launch.displayEnv.LIVESTACK_GATEWAY_URL, "http://gateway.local");
  assert.equal(launch.displayEnv.LIVESTACK_VAULT_SERVER_URL, "vault.internal:50504");
});

test("preserves explicit worker capabilities from the environment", () => {
  const unchainRoot = createUnchainRoot();
  const capabilities = JSON.stringify([{
    kind: "qwen-tts",
    hostId: "xc-mac-studio",
    slots: 1,
    labels: { runtime: "mlx" },
  }]);
  const launch = buildLivestackWorkerLaunch({
    args: [],
    env: {
      UNCHAIN_ROOT: unchainRoot,
      UNCHAIN_WORKER_CAPABILITIES: capabilities,
    },
    config: {},
  });

  assert.equal(launch.env.UNCHAIN_WORKER_CAPABILITIES, capabilities);
});
