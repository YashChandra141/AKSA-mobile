"""Dump golden fixtures from the reference Python AKSA implementation.

Run from d:\\project\\mlh:
    d:\\project\\cursor\\mlh\\venv\\Scripts\\python.exe tools\\make_golden.py

Writes tests/golden.json with tonight_summary, find_object (a fixed set of
objects), visible_planets and dark_window for 3 fixed locations and times.
The Jest suite compares the TypeScript port against these within 0.5 deg
and +/-5 min.
"""

import json
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

REF_ROOT = Path(r"d:\project\cursor\mlh")
sys.path.insert(0, str(REF_ROOT))

from aksa import astro, catalog, location, sky_query  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "tests" / "golden.json"

# (label, lat, lon, tz, local time)
CASES = [
    ("pune_oct", 18.5204, 73.8567, "Asia/Kolkata", (2026, 10, 9, 21, 30)),
    ("reykjavik_summer", 64.1466, -21.9426, "Atlantic/Reykjavik", (2026, 6, 21, 23, 0)),
    ("newyork_winter", 40.7128, -74.0060, "America/New_York", (2026, 1, 15, 20, 0)),
]

FIND_NAMES = [
    "Sirius", "Polaris", "Betelgeuse", "Saturn", "Jupiter", "M31",
    "Pleiades", "orion belt", "Big Dipper", "Orion", "Venus", "Mars",
    "Aldebaran", "M13", "Crab Nebula",
]


def loc_for(case):
    label, lat, lon, tz, _ = case
    return {"lat": lat, "lon": lon, "tz": tz, "label": label.strip()}


def main():
    fixtures = {"cases": {}}
    for case in CASES:
        label, lat, lon, tz, (y, mo, d, h, mi) = case
        loc = loc_for(case)
        location.load_location = lambda loc=loc: loc  # type: ignore[assignment]
        # sky_query reads _loc() through its module import; patch both.
        sky_query.location.load_location = location.load_location  # type: ignore[assignment]

        # Pin sky_query's date.today() to the fixture date so rise/set
        # fixtures are self-consistent with the position fixtures.
        class _FixedDate(date):
            @classmethod
            def today(cls):
                return cls(y, mo, d)

        sky_query.date = _FixedDate  # type: ignore[assignment]

        t = sky_query.make_time(y, mo, d, h, mi, tz)
        d_obj = datetime(y, mo, d, h, mi)

        dark = astro.dark_window(d_obj.date(), lat, lon, tz)
        entry = {
            "local_time": d_obj.strftime("%Y-%m-%dT%H:%M"),
            "dark_window": dark,
            "moon_info": astro.moon_info(d_obj.date(), lat, lon, tz, t=t),
            "visible_planets": astro.visible_planets(d_obj.date(), lat, lon, tz, dark=dark),
            "meteor_showers": astro.active_meteor_showers(d_obj.date()),
            "find_objects": {},
        }
        for name in FIND_NAMES:
            try:
                r = sky_query.find_object(name, t=t)
            except Exception as exc:  # reference bugs (e.g. double horizon
                # crossing in rise_set_transit at high latitudes) must not
                # block fixture generation; the TS test skips these.
                r = {"_reference_error": f"{type(exc).__name__}: {exc}"}
            entry["find_objects"][name] = r

        whats = sky_query.whats_up(t=t)
        entry["whats_up"] = whats
        fixtures["cases"][label.strip()] = entry

    # Catalog fixtures are location-independent.
    cat = {}
    for q in ["sirius", "m31", "orion belt", "north star", "saturn", "orion ring", "zzzqqq", "swathi"]:
        try:
            cat[q] = {"result": catalog.resolve(q)}
        except KeyError as exc:
            cat[q] = {"error": str(exc)}
    fixtures["catalog"] = cat

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixtures, indent=1, default=str), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()