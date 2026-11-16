import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { EMOTE_STATES } from "../src/types.ts";
import { discoverFrames } from "../src/emotes.ts";
import { AsciiRenderer } from "../src/render_ascii.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const root = fileURLToPath(new URL("..", import.meta.url));

test("all built-in image sets cover every stage with valid PNG frames", () => {
  for (const set of ["default", "red", "aza_choi", "aza_choi_nobg", "test"]) {
    const frames = discoverFrames(join(root, "emotes", set));
    for (const state of EMOTE_STATES) {
      const frameSet = frames.get(state);
      assert.ok(frameSet?.files.length, `${set}/${state} is missing`);
      for (const base64 of frameSet.base64Cache.values()) {
        const png = Buffer.from(base64, "base64");
        assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${set}/${state}`);
        assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
      }
      if (["success", ...EMOTE_STATES.slice(10)].includes(state)) {
        assert.ok(new Set(frameSet.base64Cache.values()).size >= 2, `${set}/${state} needs distinct animation frames`);
      }
    }
  }
});

test("all built-in ASCII sets render every stage, including fallback rendering", () => {
  for (const set of ["ascii", "ascii-bear", "ascii-bot", "default"]) {
    const renderer = new AsciiRenderer();
    renderer.loadFrames(join(root, "emotes", set), root);
    for (const state of EMOTE_STATES) {
      assert.ok(renderer.getCycleFrameCount(state) > 0, `${set}/${state}`);
      assert.equal(renderer.showCycleFrame(state, 0), true, `${set}/${state}`);
      const frame = renderer.getRenderedFrame();
      assert.equal(frame?.kind, "text");
      if (frame?.kind === "text") {
        assert.ok(frame.lines.every((line) => line.length > 0));
        if (["success", ...EMOTE_STATES.slice(10)].includes(state)) {
          assert.ok(frame.lines.every((line) => visibleWidth(line) <= 8), `${set}/${state} overflows the canvas`);
        }
      }
    }
  }
});
