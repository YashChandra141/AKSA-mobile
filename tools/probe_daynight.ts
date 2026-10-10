/**
 * Probe: does the engine know day from night? Compute the Sun's altitude
 * and the dark window for the same place at midday vs late evening.
 */
import { makeObserver, planetBody, altAz, darkWindow } from '../src/sky/astro';
import { makeTime } from '../src/sky/skyQuery';

const ctx = { lat: 18.5204, lon: 73.8567, tz: 'Asia/Kolkata', label: 'Pune' };
const observer = makeObserver(ctx.lat, ctx.lon);
const sun = { kind: 'body' as const, body: planetBody('Sun') };

for (const [label, h, m] of [
  ['12:00 noon', 12, 0],
  ['18:30 evening', 18, 30],
  ['21:00 night', 21, 0],
  ['02:00 deep night', 2, 0],
] as const) {
  const now = makeTime(2024, 10, 18, h, m, ctx.tz);
  const p = altAz(sun, now, observer);
  const dw = darkWindow({ ...ctx, now });
  console.log(
    `${label}: sun alt = ${p.alt.toFixed(1)}deg (${p.alt > 0 ? 'DAY' : p.alt > -18 ? 'TWILIGHT' : 'NIGHT'})` +
      ` | dark window: ${dw ? `${dw.start} - ${dw.end}` : 'none'}`,
  );
}
