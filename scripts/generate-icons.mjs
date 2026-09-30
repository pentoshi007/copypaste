import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "app", "icon.svg");
const OUT = path.join(ROOT, "public", "icons");

const MASK_BG = { r: 15, g: 23, b: 42, alpha: 1 };

async function render(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  const svg = await readFile(SRC, "utf8");
  await mkdir(OUT, { recursive: true });

  for (const size of [192, 512]) {
    await writeFile(path.join(OUT, `icon-${size}.png`), await render(svg, size));
  }

  for (const size of [192, 512]) {
    const inner = Math.round(size * 0.6);
    const art = await render(svg, inner);
    const offset = Math.round((size - inner) / 2);
    const out = await sharp({
      create: { width: size, height: size, channels: 4, background: MASK_BG },
    })
      .composite([{ input: art, top: offset, left: offset }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(path.join(OUT, `maskable-${size}.png`), out);
  }

  const appleInner = 148;
  const appleArt = await render(svg, appleInner);
  const appleOffset = Math.round((180 - appleInner) / 2);
  const apple = await sharp({
    create: { width: 180, height: 180, channels: 4, background: MASK_BG },
  })
    .composite([{ input: appleArt, top: appleOffset, left: appleOffset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(OUT, "apple-touch-icon.png"), apple);

  console.log("icons written to public/icons/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
