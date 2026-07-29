/**
 * Rasterises app/icon.svg into the PNG sizes a web app manifest needs.
 *
 * Run with: node scripts/generate-icons.mjs
 * Only needs re-running when the logo changes.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "app", "icon.svg");
const OUT = path.join(ROOT, "public", "icons");

// Backdrop for maskable icons. Android crops them to a device-specific shape, so
// the artwork must sit inside a filled square with room to spare.
const MASK_BG = { r: 15, g: 23, b: 42, alpha: 1 }; // slate-950

async function render(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  const svg = await readFile(SRC, "utf8");
  await mkdir(OUT, { recursive: true });

  // Plain icons: artwork fills the canvas.
  for (const size of [192, 512]) {
    await writeFile(path.join(OUT, `icon-${size}.png`), await render(svg, size));
  }

  // Maskable icons: artwork at 60% on a solid square, keeping it inside the
  // safe zone (the central 80% circle) whatever shape the launcher applies.
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

  // iOS home screen icon: no transparency, no mask, so pad it on a solid square.
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
