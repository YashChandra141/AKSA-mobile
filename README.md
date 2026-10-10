# AKSA — your stargazing buddy, computed on your phone

AKSA is an offline-first stargazing companion. It tells you **whether tonight is
worth going out**, **what you can actually see from where you are**, and walks
you to it with **compass directions and fists** — one fist at arm's length is
about 10°. A friendly local AI model rephrases the computed answers into chat,
but it never invents a single position: the astronomy is always calculated on
device, right where you stand.

No account. No telemetry. No stored app data.

## What it does

- **Tonight verdict** — a GO / MAYBE / SKIP score for tonight built from the
  dark window (Sun −18°), real cloud cover, the Moon's phase and how long it
  will be up, and active meteor showers. With reasons you can check yourself.
- **Where is it?** — ask for any star, planet, constellation, asterism or
  Messier object: direction, height in fists, when it rises and sets, what
  equipment you need, and a star-hop hint from a nearby bright star.
- **What's that bright star in the east?** — identify unknown objects from a
  direction and height above the horizon.
- **Sky Detective** — a live all-sky map you can tap. Don't know what you're
  looking at? A five-clue guessing ladder (direction → star-hop → shape →
  comparison → reveal) is built from verified data, never the model's memory.
- **Stargazing missions** — a short chain of real, doable challenges for
  tonight, filtered by what is actually up and the equipment you told AKSA you
  have. Stuck on a step? The Detective's clue ladder walks you in.
- **Red-light mode** — one tap turns the whole app red to protect your
  dark-adapted eyes at the eyepiece.

## Privacy by construction

- **Location is used in memory only.** A fresh GPS fix every launch, never
  written to disk. Deny GPS and pick a city instead.
- **No stored app data at all.** Profile, chat history, clue progress and
  mission progress reset when you close the app. There is no journal, no
  sync, no analytics.
- **The only network calls are** (1) Open-Meteo for cloud cover, (2) an
  optional one-time download of a ~0.8 GB GGUF model, and (3) ipapi.co for an
  automatic IP-based location/timezone — used only when GPS is unavailable so
  the sky math uses the right clock. Everything else runs offline.
- **The AI runs on your phone.** The local model (Gemma 3 1B by default)
  only phrases sentences from computed data. It cannot see the sky, and the
  prompts forbid it from guessing positions.

## How the AI works (the honest version)

Every factual sentence AKSA produces comes from TypeScript code —
[astronomy-engine](https://github.com/skyfielders/astronomy-engine) ported to a
pure-TS sky engine — fed by the bundled catalogs (bright stars, Messier
objects, constellations, asterisms, meteor showers, facts). The local model
has exactly three jobs:

1. **Pick a tool** for unusual questions (a tiny JSON router call, capped at
   80 tokens),
2. **Phrase** the computed result into 2–4 friendly sentences, and
3. **Chat casually** (with a strict guard: it must never claim to see or name
   anything in the sky).

If no model is installed, AKSA answers with clean template wording instead —
same facts, same features.

## Requirements

- [Bun](https://bun.sh) 1.4.0 (package manager)
- Node.js 20+ (for Expo tooling)
- Android Studio / Xcode for a device build, or Expo Go for a quick look

## Getting started

```bash
bun install        # deps; also fetches llama.rn native artifacts
bun run android    # or: bun run ios
bun run test       # 80 tests: golden fixtures vs the Python reference + unit tests
bun run typecheck  # tsc --noEmit
```

### Installing the AI model

Open the **Models** tab and download the recommended model
(`gemma-3-1b-it-Q4_K_M.gguf`, about 0.8 GB, over Wi-Fi), or import a folder of
`.gguf` files you already have. AKSA auto-selects the best model on each launch
and tells you when it's running in template-only mode.

On iOS the app enables file sharing, so you can also drop `.gguf` files into
the app's `models/` folder via Finder.

## Project structure

```
src/
  app/          Expo Router screens (Tonight, Guide, Detective, Missions, Models, Object)
  sky/          The pure sky engine: astro, catalog, score, facts, intent,
                skyQuery, mapData, clues, missions — all deterministic and unit-tested
  ai/           prompts, llm runtime (llama.rn), router, model manager
  services/     location (GPS/city) and weather (Open-Meteo) — memory only
  state/        one Zustand store, deliberately not persisted
tests/          golden fixtures dumped from the Python reference + unit tests
tools/          fixture generation and maintenance scripts
```

The sky engine is a line-faithful port of the original Python **AKSA** CLI
(Skyfield-based), verified against golden fixtures for three sites and seasons
(Pune autumn, Reykjavík summer, New York winter) with tight tolerances
(0.5° positions, 5-minute rise/set times).

## Attribution

- Sky math: [astronomy-engine](https://github.com/cosinekitty/astronomy)
- Cloud cover: [Open-Meteo](https://open-meteo.com) (free, no key)
- On-device model: [llama.cpp](https://github.com/ggml-org/llama.cpp) via
  [llama.rn](https://github.com/mybigday/llama.rn); Gemma 3 1B GGUF by Google,
  quantized builds by unsloth on Hugging Face
- Star catalogs: HYG and Messier data bundled from the original AKSA project
