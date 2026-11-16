import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sets = ["default", "red", "aza_choi", "aza_choi_nobg", "test"];
// Draw badges on a 40px grid, then scale with nearest-neighbor to keep pixel edges crisp.
const scenes = {
  success: { source: "hi", color: "#8fdfa2", icon: "polyline 10,20 17,27 30,12", text: ["OK!", "*v*"] },
  ask: { source: "think", color: "#f3d17c", icon: "polyline 13,13 13,10 25,10 28,13 28,17 21,22 21,25 point 21,30", text: ["?", "??"] },
  grandma: { source: "idle", color: "#c7b5e8", icon: "polyline 11,13 21,13 11,24 21,24 polyline 24,21 31,21 24,29 31,29", text: ["zZ", "Zz"] },
  bye: { source: "hi", color: "#f3b78d", icon: "polyline 10,20 30,20 23,13 polyline 30,20 23,27", text: ["/", "\\"] },
  delegate: { source: "tool", color: "#88c9ef", icon: "circle 20,10 20,7 line 20,14 20,21 polyline 10,26 10,21 30,21 30,26 circle 10,29 10,26 circle 30,29 30,26", text: ["o-o", "o=o"] },
  jobs: { source: "tool", color: "#8fdfa2", icon: "rectangle 7,13 33,27 line 11,17 11,23 line 16,17 16,23 line 21,17 21,23", text: ["[=]", "[≡]"] },
  remember: { source: "read", color: "#c7b5e8", icon: "rectangle 10,8 30,32 rectangle 15,9 25,16 rectangle 15,23 25,31", text: ["[+]", "[*]"] },
  yolo: { source: "idle", color: "#f3d17c", icon: "polyline 6,14 19,14 17,23 9,23 6,14 line 19,17 22,17 polyline 22,14 35,14 32,23 24,23 22,14 line 16,29 26,29", text: ["B)", "B)!"] },
  "super-yolo": { source: "hi", color: "#f0a668", icon: "polyline 21,7 12,21 21,21 17,33 30,17 21,17 21,7", text: ["!!", "!!!"] },
  explore: { source: "read", color: "#88c9ef", icon: "circle 17,16 17,8 line 23,23 32,32", text: ["o?", "O?"] },
  build: { source: "tool", color: "#f3b78d", icon: "polyline 8,13 17,7 27,17 20,24 8,13 line 22,21 31,31", text: ["/T", "T\\"] },
  verify: { source: "read", color: "#8fdfa2", icon: "polyline 20,6 32,11 30,25 20,34 10,25 8,11 20,6 polyline 13,19 18,24 27,14", text: ["[v]", "[V]"] },
  judge: { source: "think", color: "#f3d17c", icon: "polyline 11,9 17,6 27,16 21,22 11,12 11,9 line 23,19 32,28 line 9,32 25,32", text: ["=T", "T="] },
  review: { source: "read", color: "#ef9eac", icon: "polyline 10,7 27,7 27,32 10,32 10,7 line 14,13 23,13 line 14,18 20,18 polyline 19,27 29,17 32,20 22,30 19,30 19,27", text: ["[/]", "[x]"] },
  jira: { source: "write", color: "#88c9ef", icon: "polyline 14,24 16,13 29,7 32,10 26,23 14,26 14,24 polyline 15,17 8,21 14,23 polyline 23,25 22,32 19,26 line 13,28 8,33", text: ["^", "^^"] },
};

const scratch = mkdtempSync(join(tmpdir(), "pi-emote-frames-"));
let count = 0;
try {
  for (const set of sets) {
    const setDir = join(root, "emotes", set);
    for (const [state, scene] of Object.entries(scenes)) {
      const sources = readdirSync(join(setDir, scene.source)).filter((file) => file.endsWith(".png")).sort();
      const target = join(setDir, state);
      mkdirSync(target, { recursive: true });
      for (let frame = 0; frame < 2; frame++) {
        const source = join(setDir, scene.source, sources[frame % sources.length]);
        const [width, height] = execFileSync("magick", ["identify", "-format", "%w %h", source], { encoding: "utf8" }).trim().split(" ").map(Number);
        const badgeSize = Math.round(width * 0.42);
        const badge = join(scratch, "badge.png");
        execFileSync("magick", ["-size", "40x40", "xc:none", "+antialias",
          "-fill", "#182431", "-stroke", frame === 0 ? scene.color : "#ffffff", "-strokewidth", "2",
          "-draw", "roundrectangle 2,2 37,37 4,4", "-fill", "none", "-stroke", scene.color,
          "-strokewidth", "3", "-draw", scene.icon, "-filter", "point", "-resize", `${badgeSize}x${badgeSize}`, badge]);
        execFileSync("magick", [source, badge, "-geometry", `+${width - badgeSize - 2}+${height - badgeSize - 2}`,
          "-composite", "-strip", "-define", "png:exclude-chunks=date,time", join(target, `${state}_${frame + 1}.png`)]);
        count++;
      }
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const marker = "# Generated activity scenes (scripts/generate-activity-frames.mjs).";
for (const set of ["ascii", "ascii-bear", "ascii-bot"]) {
  const path = join(root, "emotes", set, "ascii.yaml");
  const original = readFileSync(path, "utf8").split(marker)[0].trimEnd();
  let additions = "";
  for (const [state, scene] of Object.entries(scenes)) {
    if (new RegExp(`^${state}:`, "m").test(original)) continue;
    additions += `\n${state}:\n`;
    for (const [frame, text] of scene.text.entries()) {
      if (set === "ascii-bot") {
        const face = state === "grandma" ? "-_-" : state === "success" ? "^o^" : "o_o";
        const status = text.padStart(Math.floor((8 + text.length) / 2)).padEnd(8);
        const lines = ["\x1b[32m.------.\x1b[0m", `\x1b[32m|\x1b[0m  \x1b[33m${face}\x1b[0m \x1b[32m|\x1b[0m`, "\x1b[32m'--++--'\x1b[0m", `\x1b[32m${status}\x1b[0m`];
        const quotedLines = lines.map((line) => JSON.stringify(line).replaceAll("\\u001b", "\\x1b"));
        additions += `  - - ${quotedLines[0]}\n${quotedLines.slice(1).map((line) => `    - ${line}\n`).join("")}`;
      } else {
        const face = set === "ascii-bear"
          ? (state === "grandma" ? "ʕ-ᴥ-ʔ" : frame === 0 ? "ʕ•ᴥ•ʔ" : "ʕᵔᴥᵔʔ")
          : (state === "grandma" ? "(-_-)" : frame === 0 ? "(•‿•)" : "(^‿^)");
        additions += `  - ${JSON.stringify(`${face}${text}`)}\n`;
      }
    }
  }
  writeFileSync(path, `${original}\n\n${marker}\n${additions}`);
}
console.log(`Generated ${count} PNG frames and completed all three ASCII sets.`);
