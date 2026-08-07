/**
 * Rasterises assets/icon.svg into the PNG sizes the manifest declares.
 *
 *   npm run icons
 *
 * The SVG is the source of truth; the PNGs are build output that happens to be
 * committed, because WXT copies public/ verbatim and Chrome cannot load an SVG icon.
 *
 * Uses @resvg/resvg-js rather than headless Chrome: it needs no system libraries and is
 * deterministic. (Chrome was tried first and hung when probed, which is not something to
 * put in a build script.)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

/** Must stay in step with the icon sizes WXT emits into the manifest. */
const SIZES = [16, 32, 48, 96, 128];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'assets', 'icon.svg');
const outDir = join(root, 'public', 'icon');

const svg = readFileSync(source, 'utf8');
mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(outDir, `${size}.png`), png);
  console.log(`  public/icon/${size}.png  ${String(png.length).padStart(6)} bytes`);
}

console.log(`Rendered ${SIZES.length} icons from assets/icon.svg`);
