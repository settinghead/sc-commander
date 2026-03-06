import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_CLI_DIR = join(__dirname, "..");

function createCliFixture() {
  const root = mkdtempSync(join(tmpdir(), "voiceforge-cli-test-"));
  const cliDir = join(root, "cli");
  const homeDir = join(root, "home");

  mkdirSync(cliDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(join(homeDir, ".voiceforge"), { recursive: true });

  for (const entry of ["src", "packs", "package.json", "config.default.json"]) {
    cpSync(join(REPO_CLI_DIR, entry), join(cliDir, entry), { recursive: true });
  }

  cpSync(
    join(REPO_CLI_DIR, "config.default.json"),
    join(cliDir, "config.json"),
  );

  symlinkSync(join(REPO_CLI_DIR, "node_modules"), join(cliDir, "node_modules"), "dir");

  return { cliDir, homeDir };
}

function runCli(fixture, args, options = {}) {
  return spawnSync("node", ["src/cli.js", ...args], {
    cwd: fixture.cliDir,
    env: {
      ...process.env,
      HOME: fixture.homeDir,
    },
    encoding: "utf-8",
    ...options,
  });
}

function readConfig(fixture) {
  return JSON.parse(readFileSync(join(fixture.cliDir, "config.json"), "utf-8"));
}

test("prints version", () => {
  const fixture = createCliFixture();
  const result = runCli(fixture, ["--version"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(result.stderr, "");
});

test("config set persists values in the CLI config file", () => {
  const fixture = createCliFixture();

  const setResult = runCli(fixture, ["config", "set", "volume", "75"]);
  assert.equal(setResult.status, 0);
  assert.match(setResult.stdout, /Set volume = 75/);

  const config = readConfig(fixture);
  assert.equal(config.volume, 75);

  const showResult = runCli(fixture, ["config", "show"]);
  assert.equal(showResult.status, 0);
  assert.match(showResult.stdout, /"volume": 75/);
});

test("pack list and pack show reflect the active pack", () => {
  const fixture = createCliFixture();

  const setResult = runCli(fixture, ["config", "set", "active_pack", "sc2-adjutant"]);
  assert.equal(setResult.status, 0);

  const listResult = runCli(fixture, ["pack", "list"]);
  assert.equal(listResult.status, 0);
  assert.match(listResult.stdout, /sc2-adjutant .* \(active\)/);

  const showResult = runCli(fixture, ["pack", "show"]);
  assert.equal(showResult.status, 0);

  const pack = JSON.parse(showResult.stdout);
  assert.equal(pack.id, "sc2-adjutant");
  assert.equal(pack.name, "StarCraft 2 Adjutant");
});

test("pack use random updates config without invoking the audio pipeline", () => {
  const fixture = createCliFixture();

  const result = runCli(fixture, ["pack", "use", "random"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Switched to pack: Random/);

  const config = readConfig(fixture);
  assert.equal(config.active_pack, "random");
});
