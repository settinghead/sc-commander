import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.js";

const DEFAULT_QWEN_URL = "http://127.0.0.1:8100";
const DEFAULT_SPECS = "qwen_tts.synthesize_segment";

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function isUnchainAppRoot(candidate) {
  if (!candidate) return false;
  return (
    existsSync(join(candidate, "package.json")) &&
    existsSync(join(candidate, "scripts", "workers", "portable-livestack-worker.ts"))
  );
}

export function resolveUnchainRoot({ explicitRoot, env = process.env, cwd = process.cwd() } = {}) {
  const candidates = [
    explicitRoot,
    env.UNCHAIN_ROOT,
    join(cwd, "unchain"),
    cwd,
    join(homedir(), "unchain", "unchain"),
    join(homedir(), "unchain"),
    "/home/ubuntu/unchain/unchain",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const root = resolve(candidate);
    if (isUnchainAppRoot(root)) return root;
  }

  return null;
}

export function buildLivestackWorkerLaunch({
  args = [],
  config = {},
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const explicitRoot = optionValue(args, "--unchain-root");
  const unchainRoot = resolveUnchainRoot({ explicitRoot, env, cwd });
  if (!unchainRoot) {
    throw new Error(
      "Unable to find the Unchain app root. Pass --unchain-root or set UNCHAIN_ROOT.",
    );
  }

  const qwenUrl =
    optionValue(args, "--qwen-url") ||
    env.QWEN_TTS_URL ||
    config.qwen_tts_url ||
    DEFAULT_QWEN_URL;
  const specs = optionValue(args, "--specs") || env.UNCHAIN_WORKER_SPECS || DEFAULT_SPECS;
  const hostId = optionValue(args, "--host-id") || env.UNCHAIN_HOST_ID || null;

  const workerEnv = {
    ...env,
    UNCHAIN_WORKER_SPECS: specs,
    QWEN_TTS_URL: qwenUrl,
  };
  if (hostId) workerEnv.UNCHAIN_HOST_ID = hostId;

  return {
    command: "npm",
    args: ["run", "worker:portable-livestack"],
    cwd: unchainRoot,
    env: workerEnv,
    displayEnv: {
      UNCHAIN_WORKER_SPECS: workerEnv.UNCHAIN_WORKER_SPECS,
      QWEN_TTS_URL: workerEnv.QWEN_TTS_URL,
      ...(workerEnv.UNCHAIN_HOST_ID ? { UNCHAIN_HOST_ID: workerEnv.UNCHAIN_HOST_ID } : {}),
      ...(workerEnv.UNCHAIN_OBJECT_STORE ? { UNCHAIN_OBJECT_STORE: workerEnv.UNCHAIN_OBJECT_STORE } : {}),
      ...(workerEnv.ALIYUN_OSS_BUCKET ? { ALIYUN_OSS_BUCKET: workerEnv.ALIYUN_OSS_BUCKET } : {}),
      ...(workerEnv.ALIYUN_OSS_REGION ? { ALIYUN_OSS_REGION: workerEnv.ALIYUN_OSS_REGION } : {}),
    },
  };
}

export const livestackWorkerCommand = {
  name: "livestack-worker",
  aliases: ["worker"],
  help: [
    "  voxlert livestack-worker         Start the Qwen TTS Livestack sidecar worker",
    "  voxlert worker --dry-run         Print the worker launch plan without starting it",
  ],
  skipSetupWizard: true,
  skipUpgradeCheck: false,
  async run(context) {
    const args = context.args.slice(1);
    const config = loadConfig(process.cwd());
    const launch = buildLivestackWorkerLaunch({ args, config });

    if (hasFlag(args, "--dry-run")) {
      console.log(JSON.stringify({
        command: launch.command,
        args: launch.args,
        cwd: launch.cwd,
        env: launch.displayEnv,
      }, null, 2));
      return;
    }

    console.log(`Starting Unchain Livestack worker in ${launch.cwd}`);
    console.log(`Qwen TTS URL: ${launch.displayEnv.QWEN_TTS_URL}`);
    console.log(`Worker specs: ${launch.displayEnv.UNCHAIN_WORKER_SPECS}`);

    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      stdio: "inherit",
    });

    const exitCode = await new Promise((resolveExit) => {
      child.on("exit", (code, signal) => {
        if (signal) {
          resolveExit(128);
          return;
        }
        resolveExit(code ?? 0);
      });
      child.on("error", (error) => {
        console.error(error.message);
        resolveExit(1);
      });
    });

    process.exit(exitCode);
  },
};
