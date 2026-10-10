/* Debug: TS vs golden fixtures for failing objects. */
import * as golden from '../tests/golden.json';
import { findObject, makeTime } from '../src/sky/skyQuery';
import type { SkyContext } from '../src/sky/types';

const FIX = golden as any;

function ctxFor(caseName: string): SkyContext {
  const c = FIX.cases[caseName];
  const [datePart, timePart] = c.local_time.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const tzs: Record<string, string> = {
    pune_oct: 'Asia/Kolkata',
    reykjavik_summer: 'Atlantic/Reykjavik',
    newyork_winter: 'America/New_York',
  };
  const locs: Record<string, { lat: number; lon: number }> = {
    pune_oct: { lat: 18.5204, lon: 73.8567 },
    reykjavik_summer: { lat: 64.1466, lon: -21.9426 },
    newyork_winter: { lat: 40.7128, lon: -74.006 },
  };
  return {
    lat: locs[caseName].lat,
    lon: locs[caseName].lon,
    tz: tzs[caseName],
    now: makeTime(y, m, d, hh, mm, tzs[caseName]),
    label: caseName,
  };
}

for (const caseName of ['pune_oct', 'newyork_winter']) {
  console.log(`\n=== ${caseName} ===`);
  for (const [name, exp] of Object.entries(FIX.cases[caseName].find_objects) as [string, any][]) {
    if ('_reference_error' in exp) continue;
    const act = findObject(name, ctxFor(caseName));
    if (!act.ok) continue;
    const pa = act.position!;
    const pe = exp.position;
    const altDiff = Math.abs(pa.alt - pe.alt);
    let azDiff = Math.abs(pa.az - pe.az);
    if (azDiff > 180) azDiff = 360 - azDiff;
    const flag = altDiff > 0.5 || azDiff > 0.5 ? ' <<<' : '';
    console.log(
      `${name.padEnd(12)} alt ${pa.alt.toFixed(1)} vs ${pe.alt.toFixed(1)} | az ${pa.az.toFixed(1)} vs ${pe.az.toFixed(1)} | dAlt=${altDiff.toFixed(2)} dAz=${azDiff.toFixed(2)}${flag}`,
    );
  }
}