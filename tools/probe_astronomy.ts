/* Probe v2: verify conventions with correct v2.1.19 API */
const A = require('astronomy-engine');

function utc(y: number, mo: number, d: number, h: number, mi: number) {
  return new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30, 0)); // IST = UTC+5:30
}

// Pune, local noon 2026-10-09 12:00 IST
const noon = utc(2026, 10, 9, 12, 0);
const observer = new A.Observer(18.5204, 73.8567, 100);
const t = noon;

// 1. Sun at local noon (expect az~180 S, alt~61)
const sunEq = A.Equator(A.Body.Sun, t, observer, true, true);
console.log('Sun Equator ra=', sunEq.ra, 'dec=', sunEq.dec, 'dist(AU)=', sunEq.dist);
const sunHor = A.Horizon(t, observer, sunEq.ra, sunEq.dec, 'normal');
console.log('Sun Horizon az=', sunHor.azimuth, 'alt=', sunHor.altitude);

// 2. Sirius via Rotation_EQJ_HOR vs precessed EQJ->EQD->HOR vs direct Horizon path
const raDeg = 6.75257 * 15;
const vec = null;
// Try building from RA/Dec manually: unit vector in EQJ (ra hours*15 -> deg)
const raRad = (raDeg * Math.PI) / 180;
const decRad = (-16.7131 * Math.PI) / 180;
const uv = { x: Math.cos(decRad) * Math.cos(raRad), y: Math.cos(decRad) * Math.sin(raRad), z: Math.sin(decRad) };
const eqjVec = new A.Vector(uv.x, uv.y, uv.z, new A.AstroTime(t));

const rot = A.Rotation_EQJ_HOR(t, observer);
const sph1 = A.HorizonFromVector(A.RotateVector(rot, eqjVec), null);
console.log('Sirius EQJ->HOR rot Spherical: lat=', sph1.lat, 'lon=', sph1.lon, '=> az_n_cw=', (360 - sph1.lon) % 360, 'or', (-sph1.lon) % 360);

// Precessed path: EQJ -> EQD -> HOR
const eqdVec = A.RotateVector(A.Rotation_EQJ_EQD(t), eqjVec);
const sph2 = A.HorizonFromVector(A.RotateVector(A.Rotation_EQD_HOR(t, observer), eqdVec), null);
console.log('Sirius EQJ->EQD->HOR Spherical: lat=', sph2.lat, 'lon=', sph2.lon, '=> az_n_cw=', (360 - sph2.lon) % 360);

// Direct Horizon() path using of-date topocentric coords of the star:
// For fixed stars there's no body; use Horizon with J2000 ra/dec as approximation
const hor3 = A.Horizon(t, observer, 6.75257, -16.7131, null);
console.log('Sirius direct Horizon():  az=', hor3.azimuth, 'alt=', hor3.altitude);

// 3. Constellation for Sirius
const con = A.Constellation(6.75257, -16.7131);
console.log('Constellation(Sirius):', con.symbol, con.name);

// 4. Saturn illumination + distance
const ill = A.Illumination(A.Body.Saturn, t);
console.log('Illumination(Saturn): mag=', ill.mag, 'phase_fraction=', ill.phase_fraction, 'geo_dist=', ill.geo_dist, 'helio=', ill.helio_dist);

// 5. MoonPhase + distance
console.log('MoonPhase:', A.MoonPhase(t));
const gmoon = A.GeoMoon(t);
const len = Math.sqrt(gmoon.x ** 2 + gmoon.y ** 2 + gmoon.z ** 2);
console.log('GeoMoon |v|=', len, 'KM_PER_AU=', A.KM_PER_AU, '-> km=', len * A.KM_PER_AU);
const illm = A.Illumination(A.Body.Moon, t);
console.log('Moon Illumination geo_dist(AU)=', illm.geo_dist, 'phase_fraction=', illm.phase_fraction);

// 6. SearchAltitude numeric direction: -1 = setting, +1 = rising
const dusk18 = A.SearchAltitude(A.Body.Sun, observer, -1, noon, 1, -18);
const dawn18 = A.SearchAltitude(A.Body.Sun, observer, +1, noon, 1, -18);
console.log('Sun -18 set:', dusk18 && dusk18.date.toISOString(), ' rise:', dawn18 && dawn18.date.toISOString());
const dusk12 = A.SearchAltitude(A.Body.Sun, observer, -1, noon, 1, -12);
console.log('Sun -12 set:', dusk12 && dusk12.date.toISOString());

// 7. Moon rise/set tonight
const mrise = A.SearchRiseSet(A.Body.Moon, observer, +1, noon, 1);
const mset = A.SearchRiseSet(A.Body.Moon, observer, -1, noon, 1);
console.log('Moon rise:', mrise && mrise.date.toISOString(), 'set:', mset && mset.date.toISOString());

// 8. MoonQuarters
let q = A.SearchMoonQuarter(t);
for (let i = 0; i < 3; i++) {
  console.log('MoonQuarter:', q.time.date.toISOString(), 'quarter=', q.quarter);
  q = A.NextMoonQuarter(q);
}