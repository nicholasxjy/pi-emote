import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLayeredConfig } from "../src/config.ts";

function sandbox(t: any) {
  const root = mkdtempSync(join(tmpdir(), "pi-emote-config-"));
  const home = process.env.HOME;
  process.env.HOME = root;
  t.after(() => {
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    rmSync(root, { recursive: true, force: true });
  });
  const extDir = join(root, "extension");
  const cwd = join(root, "project");
  const write = (dir: string, config: object) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  };
  return { root, extDir, cwd, write };
}

test("layout defaults to the existing layout and rejects invalid values", (t) => {
  const { extDir, cwd, write } = sandbox(t);
  assert.equal(loadLayeredConfig(extDir, cwd).config.layout, "default");

  const warnings: string[] = [];
  t.mock.method(console, "error", (message: string) => warnings.push(message));
  write(extDir, { layout: "invalid" });
  assert.equal(loadLayeredConfig(extDir, cwd).config.layout, "default");
  assert.match(warnings[0], /Invalid layout/);
});

test("layout follows extension, user, and project priority", (t) => {
  const { root, extDir, cwd, write } = sandbox(t);
  write(extDir, { layout: "side", size: 12 });
  assert.equal(loadLayeredConfig(extDir, cwd).config.layout, "side");

  write(join(root, ".pi", "agent", "extensions", "pi-emote"), { layout: "default" });
  assert.equal(loadLayeredConfig(extDir, cwd).config.layout, "default");

  write(join(cwd, ".pi", "extensions", "pi-emote"), { layout: "side" });
  const { config } = loadLayeredConfig(extDir, cwd);
  assert.equal(config.layout, "side");
  assert.equal(config.size, 12);
});
