#!/usr/bin/env node
// Generate Android launcher icons, iOS app icon, and PWA/web icons from
// public/logo-color.svg. Uses sharp for SVG rasterization + compositing and
// png-to-ico for the favicon. Called via `npm run icons`.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = resolve(process.cwd());
const SOURCE_SVG = resolve(ROOT, 'public/logo-color.svg');
const BG_COLOR = '#ffffff';

const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const NC = '\x1b[0m';

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function ensureDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

// Rasterize the color SVG once at high resolution; reuse for every output.
async function rasterizeSource(size) {
  const svg = await readFile(SOURCE_SVG);
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// Composite the color logo at content-size onto a canvas-size background.
// If bg is null/transparent, the result has an alpha channel (for adaptive fg).
async function compose({ canvas, content, bg, dest, mask }) {
  const logo = await rasterizeSource(content);

  const base = bg === null
    ? sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    : sharp({ create: { width: canvas, height: canvas, channels: 4, background: bg } });

  const layers = [
    { input: logo, gravity: 'center' },
  ];
  if (mask) layers.unshift({ input: mask, blend: 'dest-in' });

  await ensureDir(dest);
  // For a masked (round) output, composite mask first over the BG to clip it,
  // then composite the logo on top. We do this in two passes.
  if (mask) {
    const maskedBg = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: bg } })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    await sharp(maskedBg)
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toFile(dest);
  } else {
    await base.composite([{ input: logo, gravity: 'center' }]).png().toFile(dest);
  }
}

// Build a white-filled circle mask of the given size (transparent outside).
async function circleMask(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function hexToRgba(hex) {
  const m = hex.replace('#', '');
  return { r: parseInt(m.slice(0,2),16), g: parseInt(m.slice(2,4),16), b: parseInt(m.slice(4,6),16), alpha: 1 };
}

async function main() {
  console.log(`${GREEN}Generating app icons...${NC}\n`);

  if (!(await exists(SOURCE_SVG))) {
    console.error(`${YELLOW}Error: Source logo not found at ${SOURCE_SVG}${NC}`);
    process.exit(1);
  }

  const bgRgba = hexToRgba(BG_COLOR);

  // ── Adaptive icon foreground PNGs (transparent bg, color logo at 55% safe zone) ──
  console.log('Generating adaptive foreground PNGs...');
  const adaptiveTargets = [
    { size: 48,  dest: 'android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png' },
    { size: 72,  dest: 'android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png' },
    { size: 96,  dest: 'android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png' },
    { size: 144, dest: 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png' },
    { size: 192, dest: 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png' },
  ];
  for (const { size, dest } of adaptiveTargets) {
    const content = Math.floor(size * 55 / 100);
    await compose({ canvas: size, content, bg: null, dest: resolve(ROOT, dest) });
  }

  // ── Legacy launcher icons: square (white bg) ──
  console.log('Generating legacy square launcher icons...');
  const squareTargets = [
    { size: 48,  dest: 'android/app/src/main/res/mipmap-mdpi/ic_launcher.png' },
    { size: 72,  dest: 'android/app/src/main/res/mipmap-hdpi/ic_launcher.png' },
    { size: 96,  dest: 'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png' },
    { size: 144, dest: 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png' },
    { size: 192, dest: 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png' },
  ];
  for (const { size, dest } of squareTargets) {
    const content = Math.floor(size * 60 / 100);
    await compose({ canvas: size, content, bg: bgRgba, dest: resolve(ROOT, dest) });
  }

  // ── Legacy launcher icons: round (white circle on transparent) ──
  console.log('Generating legacy round launcher icons...');
  const roundTargets = [
    { size: 48,  dest: 'android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png' },
    { size: 72,  dest: 'android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png' },
    { size: 96,  dest: 'android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png' },
    { size: 144, dest: 'android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png' },
    { size: 192, dest: 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png' },
  ];
  for (const { size, dest } of roundTargets) {
    const content = Math.floor(size * 60 / 100);
    const mask = await circleMask(size);
    await compose({ canvas: size, content, bg: bgRgba, dest: resolve(ROOT, dest), mask });
  }

  // ── Adaptive-icon background color resource ──
  const bgFile = resolve(ROOT, 'android/app/src/main/res/values/ic_launcher_background.xml');
  await ensureDir(bgFile);
  await writeFile(bgFile, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BG_COLOR}</color>
</resources>
`);

  // ── iOS App Icon (1024x1024, color logo on white) ──
  console.log('Generating iOS app icon...');
  const iosIcon = resolve(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  if (await exists(dirname(iosIcon))) {
    await compose({ canvas: 1024, content: 614, bg: bgRgba, dest: iosIcon });
    console.log(`  ${GREEN}✓${NC} ${iosIcon}`);
  } else {
    console.log(`  ${YELLOW}Skipped: iOS icon dir not found${NC}`);
  }

  // ── PWA / web icons ──
  console.log('Generating PWA / web icons...');
  const pwaTargets = [
    { canvas: 192, content: Math.floor(192 * 60 / 100), dest: 'public/icon-192.png' },
    { canvas: 512, content: Math.floor(512 * 60 / 100), dest: 'public/icon-512.png' },
    { canvas: 180, content: Math.floor(180 * 60 / 100), dest: 'public/apple-touch-icon.png' },
  ];
  for (const { canvas, content, dest } of pwaTargets) {
    await compose({ canvas, content, bg: bgRgba, dest: resolve(ROOT, dest) });
  }

  // public/logo.png — colored grid on transparent (400x400)
  await compose({ canvas: 400, content: 400, bg: null, dest: resolve(ROOT, 'public/logo.png') });

  // Favicon — multi-size ICO built from 16/32/48 PNGs on white
  const favBuffers = [];
  for (const size of [16, 32, 48]) {
    const content = Math.floor(size * 60 / 100);
    const logo = await rasterizeSource(content);
    const buf = await sharp({ create: { width: size, height: size, channels: 4, background: bgRgba } })
      .composite([{ input: logo, gravity: 'center' }])
      .png()
      .toBuffer();
    favBuffers.push(buf);
  }
  const icoBuf = await pngToIco(favBuffers);
  await writeFile(resolve(ROOT, 'public/favicon.ico'), icoBuf);

  console.log(`  ${GREEN}✓${NC} public/icon-192.png, icon-512.png, apple-touch-icon.png, logo.png, favicon.ico`);

  console.log(`\n${GREEN}App icons generated successfully!${NC}`);
  console.log(`Icon: Kubo color logo on ${GREEN}${BG_COLOR}${NC}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
