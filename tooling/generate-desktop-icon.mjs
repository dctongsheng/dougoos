import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";

const execute = promisify(execFile);
const SOURCE_SIZE = 1024;

function insideRoundedSquare(x, y) {
  const radius = 220;
  const innerStart = radius;
  const innerEnd = SOURCE_SIZE - radius;
  if (x >= innerStart && x < innerEnd) return true;
  if (y >= innerStart && y < innerEnd) return true;
  const cornerX = x < innerStart ? innerStart : innerEnd;
  const cornerY = y < innerStart ? innerStart : innerEnd;
  return Math.hypot(x - cornerX, y - cornerY) <= radius;
}

function renderSourceIcon() {
  const png = new PNG({ colorType: 6, height: SOURCE_SIZE, width: SOURCE_SIZE });
  for (let y = 0; y < SOURCE_SIZE; y += 1) {
    for (let x = 0; x < SOURCE_SIZE; x += 1) {
      const offset = (y * SOURCE_SIZE + x) * 4;
      if (!insideRoundedSquare(x, y)) {
        png.data[offset + 3] = 0;
        continue;
      }

      const vertical = y / (SOURCE_SIZE - 1);
      const horizontal = x / (SOURCE_SIZE - 1);
      const glow = Math.max(0, 1 - Math.hypot(x - 700, y - 280) / 620);
      png.data[offset] = Math.round(8 + 18 * vertical + 34 * glow);
      png.data[offset + 1] = Math.round(18 + 40 * vertical + 132 * glow);
      png.data[offset + 2] = Math.round(24 + 38 * horizontal + 70 * glow);
      png.data[offset + 3] = 255;

      const distance = Math.abs(x - 512) + Math.abs(y - 512);
      const outerStroke = Math.abs(distance - 292) <= 34;
      const innerStroke = Math.abs(distance - 160) <= 28;
      if (outerStroke || innerStroke) {
        const highlight = outerStroke ? 242 : 61;
        png.data[offset] = highlight;
        png.data[offset + 1] = outerStroke ? 250 : 220;
        png.data[offset + 2] = outerStroke ? 245 : 132;
      }
    }
  }
  return PNG.sync.write(png);
}

export async function generateDesktopIcon(outputDirectory) {
  const iconsetPath = join(outputDirectory, "DougoOS.iconset");
  const sourcePath = join(outputDirectory, "DougoOS-1024.png");
  const iconPath = join(outputDirectory, "DougoOS.icns");
  await rm(iconsetPath, { force: true, recursive: true });
  await mkdir(iconsetPath, { recursive: true });
  await writeFile(sourcePath, renderSourceIcon());

  const variants = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, size] of variants) {
    await execute("sips", [
      "-z",
      size.toString(),
      size.toString(),
      sourcePath,
      "--out",
      join(iconsetPath, name),
    ]);
  }
  await execute("iconutil", ["-c", "icns", iconsetPath, "-o", iconPath]);
  return iconPath;
}
