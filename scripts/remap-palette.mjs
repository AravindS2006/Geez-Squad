// One-off palette migration to the "Performance studio" direction: sage/forest
// greens and blue-greys become neutral ink/stone, lime highlights become volt
// lime, and semantic success/warning/danger plus avatar tints are preserved.
// Usage: node scripts/remap-palette.mjs <css files...>
import fs from 'node:fs';

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklch(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => toLin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
function hex([L, C, H]) {
  const h = (H * Math.PI) / 180, A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
    .map((v) => Math.round(Math.min(1, Math.max(0, fromLin(v))) * 255).toString(16).padStart(2, '0'))
    .join('');
}
const NEUTRAL_HUE = 95; // a hint of warmth, like stone
export function remap(input) {
  const [L, C, H] = oklch(input);
  const greenish = H >= 95 && H < 175;
  const blueGrey = H >= 175 && H < 265 && C < 0.06;
  if (greenish && C >= 0.09 && L >= 0.78) return hex([Math.max(L, 0.86), 0.19, 128]); // volt lime
  if (greenish && C >= 0.09) return input; // semantic success greens
  if (greenish || blueGrey || C < 0.02) {
    // Text greys get slightly darker for crisper contrast; surfaces stay put.
    const Ln = L < 0.7 ? L * 0.9 : L;
    return hex([Ln, Math.min(C, 0.004), NEUTRAL_HUE]);
  }
  return input; // warm, violet, saturated blue/red: avatars, status, charts
}
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  let n = 0;
  const out = src.replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g, (m, raw) => {
    const full = (raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw).toLowerCase();
    const next = remap(full);
    if (next === full) return m;
    n++;
    return `#${next}`;
  });
  fs.writeFileSync(file, out);
  console.log(`${file}: ${n} colors remapped`);
}
