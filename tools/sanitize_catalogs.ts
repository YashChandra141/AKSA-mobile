/* One-off sanitizer: make the bundled catalogs strictly valid JSON.
 * - Stars with NaN coordinates and no name are dropped (unusable).
 * - A constellation with a NaN center gets its center recomputed from
 *   its named member stars (mean unit vector, same rule as the Python
 *   build_catalog.py).
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dir, '..', 'src', 'sky', 'data');

function load(name: string): any {
  const raw = fs.readFileSync(path.join(dir, name), 'utf8');
  return JSON.parse(raw.replace(/\bNaN\b/g, 'null').replace(/\b-?Infinity\b/g, 'null'));
}

function save(name: string, data: unknown) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 1) + '\n');
}

// --- stars.json: drop entries with null ra/dec ---
const stars = load('stars.json');
const before = stars.stars.length;
stars.stars = stars.stars.filter(
  (s: any) => typeof s.ra_hours === 'number' && typeof s.dec_degrees === 'number',
);
stars.count = stars.stars.length;
console.log(`stars.json: ${before} -> ${stars.count} (dropped ${before - stars.count} bad entries)`);
save('stars.json', stars);

// --- constellations.json: recompute NaN centers from named stars ---
const consts = load('constellations.json');
const starList = stars.stars as { name: string | null; ra_hours: number; dec_degrees: number }[];
for (const c of consts.constellations) {
  if (typeof c.ra_hours === 'number' && typeof c.dec_degrees === 'number') continue;
  const members = (c.named_stars ?? [])
    .map((n: string) => starList.find((s) => s.name === n))
    .filter(Boolean);
  if (!members.length) {
    console.error(`constellation ${c.name}: NaN center and no named stars to recompute from`);
    process.exit(1);
  }
  let x = 0, y = 0, z = 0;
  for (const st of members) {
    const ra = (st.ra_hours * 15 * Math.PI) / 180;
    const dec = (st.dec_degrees * Math.PI) / 180;
    x += Math.cos(dec) * Math.cos(ra);
    y += Math.cos(dec) * Math.sin(ra);
    z += Math.sin(dec);
  }
  x /= members.length; y /= members.length; z /= members.length;
  const norm = Math.sqrt(x * x + y * y + z * z) || 1;
  c.dec_degrees = (Math.asin(z / norm) * 180) / Math.PI;
  c.ra_hours = (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360 / 15;
  console.log(
    `constellation ${c.name}: recomputed center ra=${c.ra_hours.toFixed(3)}h dec=${c.dec_degrees.toFixed(2)}deg` +
      ` from ${members.map((m: any) => m.name).join(', ')}`,
  );
}
save('constellations.json', consts);
console.log('done');