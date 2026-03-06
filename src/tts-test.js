import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import confirm from "@inquirer/confirm";
import select from "@inquirer/select";
import { playFile } from "./audio.js";
import { loadPack } from "./packs.js";
import { CACHE_DIR } from "./paths.js";
import { printStatus, printSuccess, printWarning } from "./setup-ui.js";

const TTS_TEST_PHRASE = "Voxlert TTS check. If you hear this voice, your setup is working.";

export const QWEN_DOCS_URL = "https://github.com/settinghead/voxlert/blob/main/qwen3-tts-server/README.md";
export const CHATTERBOX_DOCS_URL = "https://github.com/settinghead/voxlert/blob/main/docs/chatterbox-tts.md";

function getRequestFunction(url) {
  const urlObj = new URL(url);
  return urlObj.protocol === "https:" ? httpsRequest : httpRequest;
}

function getTtsEndpoint(config, backend) {
  const base = backend === "qwen"
    ? (config.qwen_tts_url || "http://localhost:8100")
    : (config.chatterbox_url || "http://localhost:8004");
  return `${base}/tts`;
}

export function getTtsDocsUrl(backend) {
  return backend === "qwen" ? QWEN_DOCS_URL : CHATTERBOX_DOCS_URL;
}

export function getTtsLabel(backend) {
  return backend === "qwen" ? "Qwen TTS" : "Chatterbox";
}

export function getTtsChoices(currentBackend) {
  return [
    {
      name: currentBackend === "qwen"
        ? "Qwen TTS (recommended, current, more natural voice, port 8100)"
        : "Qwen TTS (recommended, more natural voice, port 8100)",
      value: "qwen",
    },
    {
      name: currentBackend === "chatterbox"
        ? "Chatterbox (current, port 8004)"
        : "Chatterbox (port 8004)",
      value: "chatterbox",
    },
  ];
}

export function probeTtsBackend(config, backend, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const healthUrl = backend === "qwen"
      ? `${config.qwen_tts_url || "http://localhost:8100"}/health`
      : `${config.chatterbox_url || "http://localhost:8004"}/health`;

    let urlObj;
    try {
      urlObj = new URL(healthUrl);
    } catch {
      return resolve(false);
    }

    const reqFn = urlObj.protocol === "https:" ? httpsRequest : httpRequest;
    const req = reqFn(urlObj, { method: "GET", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function requestTtsAudio(config, backend, pack) {
  return new Promise((resolve) => {
    const endpoint = getTtsEndpoint(config, backend);
    const body = backend === "qwen"
      ? { text: TTS_TEST_PHRASE, pack_id: pack.id || "_default" }
      : {
          text: TTS_TEST_PHRASE,
          voice_mode: "predefined",
          predefined_voice_id: pack.voicePath || config.voice || "default.wav",
          output_format: "wav",
          ...(pack.tts_params || {}),
        };
    const payload = JSON.stringify(body);

    let reqFn;
    try {
      reqFn = getRequestFunction(endpoint);
    } catch {
      return resolve(null);
    }

    const req = reqFn(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: backend === "qwen" ? 30000 : 8000,
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return resolve(null);
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", () => resolve(null));
      },
    );

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

export async function runTtsSample(config, backend) {
  const pack = loadPack(config);
  const outPath = join(CACHE_DIR, `setup-tts-test-${Date.now()}.wav`);

  try {
    const audio = await requestTtsAudio(config, backend, pack);
    if (!audio || audio.length === 0) {
      return false;
    }
    writeFileSync(outPath, audio);
    await playFile(outPath, config.volume ?? 0.5);
    return true;
  } catch {
    return false;
  } finally {
    if (existsSync(outPath)) {
      try {
        unlinkSync(outPath);
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

export async function chooseTtsBackend(config, { qwenUp, chatterboxUp }) {
  if (qwenUp && chatterboxUp) {
    return select({
      message: "Both TTS servers detected. Which one to use? Qwen TTS is recommended for a more natural voice.",
      choices: getTtsChoices(config.tts_backend),
      default: config.tts_backend || "qwen",
    });
  }

  if (qwenUp) {
    printSuccess("Using Qwen TTS.");
    return "qwen";
  }

  if (chatterboxUp) {
    printSuccess("Using Chatterbox.");
    return "chatterbox";
  }

  return select({
    message: "Choose the TTS backend you are setting up. Qwen TTS is recommended for a more natural voice.",
    choices: getTtsChoices(config.tts_backend),
    default: config.tts_backend || "qwen",
  });
}

export async function verifyTtsSetup(config, backend) {
  const label = getTtsLabel(backend);
  const docsUrl = getTtsDocsUrl(backend);

  while (true) {
    console.log("");
    process.stdout.write(`  Checking ${label}... `);
    const backendUp = await probeTtsBackend(config, backend);
    console.log(backendUp ? "detected!" : "not running");

    if (!backendUp) {
      printWarning(`${label} is not running yet. Finish that setup and come back here to try again.`);
      printStatus(`${label} docs`, docsUrl);
      console.log("");
      await confirm({
        message: `Press enter after ${label} is running to test again.`,
        default: true,
      });
      continue;
    }

    process.stdout.write(`  Testing ${label} audio... `);
    const ok = await runTtsSample(config, backend);
    console.log(ok ? "played." : "failed.");

    if (!ok) {
      printWarning(`The ${label} test failed. Keep the docs open, fix the server, and try again.`);
      printStatus(`${label} docs`, docsUrl);
      console.log("");
      await confirm({
        message: `Press enter to retry the ${label} test.`,
        default: true,
      });
      continue;
    }

    const heardVoice = await select({
      message: `Did you hear the ${label} voice test?`,
      choices: [
        { name: "Yes", value: true },
        { name: "No", value: false },
      ],
      default: true,
    });

    if (heardVoice) {
      printSuccess(`${label} verified.`);
      return;
    }

    printWarning("No workaround here. Keep troubleshooting and retry until you hear the voice.");
    printStatus(`${label} docs`, docsUrl);
    console.log("");
    await confirm({
      message: "Press enter to play the test again.",
      default: true,
    });
  }
}
