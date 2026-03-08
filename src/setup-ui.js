import { getProvider } from "./providers.js";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clear: "\x1b[2J",
  home: "\x1b[H",
};

const LOGO_LINES = [
  "██╗   ██╗ ██████╗ ██╗  ██╗██╗     ███████╗██████╗ ████████╗",
  "██║   ██║██╔═══██╗╚██╗██╔╝██║     ██╔════╝██╔══██╗╚══██╔══╝",
  "██║   ██║██║   ██║ ╚███╔╝ ██║     █████╗  ██████╔╝   ██║   ",
  "╚██╗ ██╔╝██║   ██║ ██╔██╗ ██║     ██╔══╝  ██╔══██╗   ██║   ",
  " ╚████╔╝ ╚██████╔╝██╔╝ ██╗███████╗███████╗██║  ██║   ██║   ",
  "  ╚═══╝   ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝   ",
];

function color(text, code) {
  return `${code}${text}${ANSI.reset}`;
}

function useFancyUi() {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb");
}

function rgb(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function interpolate(a, b, t) {
  return Math.round(a + (b - a) * t);
}

const LOGO_GRADIENT_STOPS = [
  [88, 196, 255],
  [116, 140, 255],
  [178, 92, 255],
  [255, 64, 196],
  [255, 82, 120],
  [255, 64, 196],
  [178, 92, 255],
  [116, 140, 255],
  [88, 196, 255],
];

function sampleLogoGradient(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const segments = LOGO_GRADIENT_STOPS.length - 1;
  const scaled = clamped * segments;
  const index = Math.min(Math.floor(scaled), segments - 1);
  const local = scaled - index;
  const eased = 0.5 - (Math.cos(local * Math.PI) / 2);
  const [r1, g1, b1] = LOGO_GRADIENT_STOPS[index];
  const [r2, g2, b2] = LOGO_GRADIENT_STOPS[index + 1];
  return [
    interpolate(r1, r2, eased),
    interpolate(g1, g2, eased),
    interpolate(b1, b2, eased),
  ];
}

function animatedLogoLine(text, phase = 0, shimmerIndex = -1) {
  if (!useFancyUi()) return text;
  const chars = [...text];
  const last = Math.max(chars.length - 1, 1);
  return chars.map((ch, index) => {
    if (ch === " ") return ch;
    const raw = (index / last) + phase;
    const wrapped = raw - Math.floor(raw);
    let [r, g, b] = sampleLogoGradient(wrapped);
    if (Math.abs(index - shimmerIndex) <= 1) {
      r = Math.min(255, r + 70);
      g = Math.min(255, g + 70);
      b = Math.min(255, b + 70);
    }
    return `${rgb(r, g, b)}${ANSI.bold}${ch}${ANSI.reset}`;
  }).join("") + ANSI.reset;
}

function centerLine(text, width = 59) {
  const padding = Math.max(0, Math.floor((width - text.length) / 2));
  return `${" ".repeat(padding)}${text}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCurrentConfig(config, installedPlatforms) {
  const provider = getProvider(config.llm_backend || "openrouter");
  const providerLabel = config.llm_api_key
    ? `${provider ? provider.name : (config.llm_backend || "openrouter")} (${config.llm_model || provider?.defaultModel || "default"})`
    : "Fallback only";
  const ttsLabel = config.tts_backend || "qwen";
  const voiceLabel = config.active_pack || "sc1-kerrigan-infested";
  const platforms = installedPlatforms.filter(Boolean);
  return [
    `${color("Current", ANSI.dim)} ${providerLabel}`,
    `${color("Voice", ANSI.dim)}   ${voiceLabel}`,
    `${color("TTS", ANSI.dim)}     ${ttsLabel}`,
    `${color("Hooks", ANSI.dim)}   ${platforms.length > 0 ? platforms.join(", ") : "None"}`,
  ];
}

function renderLogoFrame(config, installedPlatforms, shimmerStep = -1) {
  const current = formatCurrentConfig(config, installedPlatforms).map((line) => `  ${line}`);
  const rule = color("┈".repeat(59), ANSI.dim);
  const glow = color("SYNTHETIC VOICE NOTIFICATIONS FOR AGENT WORKFLOWS", ANSI.cyan);
  const logo = LOGO_LINES.map((line, index) => {
    const shimmerIndex = shimmerStep >= 0 ? shimmerStep - index * 3 : -1;
    const phase = shimmerStep >= 0 ? shimmerStep * 0.015 + index * 0.02 : index * 0.02;
    return centerLine(animatedLogoLine(line, phase, shimmerIndex), 59);
  });
  return [
    "",
    rule,
    ...logo,
    centerLine(glow, 59),
    rule,
    "",
    ...current,
    "",
  ].join("\n");
}

export async function printSetupHeader(config, installedPlatforms) {
  if (!useFancyUi()) {
    console.log("");
    console.log(color("=== Voxlert Setup ===", ANSI.bold));
    console.log("");
    for (const line of formatCurrentConfig(config, installedPlatforms)) {
      console.log(`  ${line}`);
    }
    console.log("");
    return;
  }

  process.stdout.write(ANSI.hideCursor);
  try {
    const frames = Array.from({ length: 16 }, (_, index) => 4 + index * 6);
    for (const shimmerStep of frames) {
      process.stdout.write(ANSI.clear + ANSI.home + renderLogoFrame(config, installedPlatforms, shimmerStep));
      await sleep(125);
    }
    process.stdout.write(ANSI.clear + ANSI.home + renderLogoFrame(config, installedPlatforms));
  } finally {
    process.stdout.write(ANSI.showCursor);
  }
}

export function printStep(number, title) {
  console.log(color(`Step ${number}/6: ${title}`, ANSI.bold));
  console.log("");
}

export function printStatus(label, value) {
  console.log(`  ${color(label, ANSI.dim)} ${value}`);
}

export function printSuccess(message) {
  console.log(`  ${color("OK", ANSI.green)} ${message}`);
}

export function printWarning(message) {
  console.log(`  ${color("->", ANSI.yellow)} ${message}`);
}

export function highlight(text) {
  return color(text, ANSI.cyan);
}
