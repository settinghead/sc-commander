import { createInterface } from "readline";
import select from "@inquirer/select";
import { loadConfig, saveConfig } from "../config.js";
import { showOverlay } from "../overlay.js";
import { listPacks, loadPack } from "../packs.js";
import { generatePhrase } from "../llm.js";
import { speakPhrase } from "../audio.js";

export async function testPipeline(text, pack) {
  if (!text) {
    console.error("Usage: voxlert test \"<text>\"");
    process.exit(1);
  }

  const config = loadConfig(process.cwd());
  const activePack = pack || loadPack(config);

  console.log(`Input: ${text}`);
  console.log(`Pack: ${activePack.name} (${activePack.id}), echo: ${activePack.echo !== false}`);
  console.log("Generating phrase via LLM...");

  const result = await generatePhrase(text, config, activePack.style, activePack.llm_temperature, activePack.examples);

  let phrase;
  if (result.phrase) {
    phrase = result.phrase;
    console.log(`LLM phrase: ${phrase}`);
    if (result.usage) {
      console.log(`Tokens: ${result.usage.total_tokens || 0} (${result.usage.prompt_tokens || 0} prompt + ${result.usage.completion_tokens || 0} completion)`);
    }
  } else {
    console.log(`LLM failed (${result.fallbackReason}), using raw text as phrase.`);
    phrase = text;
  }

  console.log("Sending to TTS...");
  showOverlay(phrase, {
    category: "notification",
    packName: activePack.name,
    packId: activePack.id || (config.active_pack || "sc1-kerrigan-infested"),
    prefix: "Test",
    config,
    overlayColors: activePack.overlay_colors,
  });
  await speakPhrase(phrase, config, activePack);
  console.log("Done.");
}

export function packList() {
  const packs = listPacks();
  const config = loadConfig(process.cwd());
  const active = config.active_pack || "";
  if (packs.length === 0) {
    console.log("No voice packs found.");
    return;
  }
  const randomMarker = active === "random" ? " (active)" : "";
  console.log(`  random — Random (picks a different voice each time)${randomMarker}`);
  for (const pack of packs) {
    const marker = pack.id === active ? " (active)" : "";
    console.log(`  ${pack.id} — ${pack.name}${marker}`);
  }
}

export function packShow() {
  const config = loadConfig(process.cwd());
  console.log(JSON.stringify(loadPack(config), null, 2));
}

export async function greetWithVoice() {
  const config = loadConfig(process.cwd());
  const pack = loadPack(config);
  await testPipeline(`You have chosen '${pack.name}' as the new voice. It is now activated.`, pack);
}

export async function packUse(packId) {
  if (!packId) {
    console.error("Usage: voxlert pack use <pack-id>");
    process.exit(1);
  }
  if (packId === "random") {
    const config = loadConfig(process.cwd());
    config.active_pack = "random";
    saveConfig(config);
    console.log("Switched to pack: Random (picks a different voice each time)");
    return;
  }
  const packs = listPacks();
  const match = packs.find((pack) => pack.id === packId);
  if (!match) {
    console.error(`Pack "${packId}" not found. Available packs:`);
    console.error("  random — Random (picks a different voice each time)");
    for (const pack of packs) console.error(`  ${pack.id} — ${pack.name}`);
    process.exit(1);
  }
  const config = loadConfig(process.cwd());
  config.active_pack = packId;
  saveConfig(config);
  console.log(`Switched to pack: ${match.name} (${packId})`);
  await greetWithVoice();
}

export async function voicePick() {
  const packs = listPacks();
  if (packs.length === 0) {
    console.log("No voice packs found.");
    return;
  }

  const config = loadConfig(process.cwd());
  const active = config.active_pack || "";
  const choices = [
    {
      name: active === "random" ? "Random (active)" : "Random",
      value: "random",
      description: "Picks a different voice each time",
    },
    ...packs.map((pack) => ({
      name: pack.id === active ? `${pack.name} (active)` : pack.name,
      value: pack.id,
      description: pack.id,
    })),
  ];

  const chosen = await select({
    message: "Select a voice pack",
    choices,
    default: active || undefined,
  });

  if (chosen === active) {
    const selectedPack = packs.find((pack) => pack.id === chosen);
    const label = chosen === "random" ? "Random" : selectedPack.name;
    console.log(`Already using: ${label}`);
    return;
  }

  config.active_pack = chosen;
  saveConfig(config);
  if (chosen === "random") {
    console.log("Switched to: Random");
  } else {
    const match = packs.find((pack) => pack.id === chosen);
    console.log(`Switched to: ${match.name} (${chosen})`);
  }
  await greetWithVoice();
}

export function askLine(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
