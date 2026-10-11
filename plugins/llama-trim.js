/**
 * Trims llama.rn's prebuilt CPU-feature variants for Android.
 *
 * llama.rn ships a full llama.cpp build per CPU feature level
 * (~11.5 MB each, arm64-v8a): generic, v8, v8_2, v8_2_dotprod,
 * v8_2_i8mm, v8_2_dotprod_i8mm, and a Hexagon/OpenCL build. At runtime
 * RNLlama.java walks a tryLoadLibrary ladder from the most capable
 * variant down to plain "rnllama" - a missing .so simply falls through.
 *
 * We keep generic + v8 + v8_2 (covers armv8 through armv8.2 devices)
 * and drop the dotprod/i8mm/Hexagon builds: nothing in our device set
 * reaches those feature levels, and Hexagon needs Qualcomm's SDK
 * runtime. Saves ~49 MB per APK.
 */

import { withDangerousMod } from '@expo/config-plugins';
import fs from 'fs';
import path from 'path';

const DROP = [
  'librnllama_v8_2_dotprod.so',
  'librnllama_v8_2_i8mm.so',
  'librnllama_v8_2_dotprod_i8mm.so',
  'librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so',
];

function trimAbiDir(abiDir) {
  if (!fs.existsSync(abiDir)) return 0;
  let removed = 0;
  for (const name of DROP) {
    const file = path.join(abiDir, name);
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      removed += 1;
    }
  }
  return removed;
}

const withLlamaTrim = (config) => {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const root = config.modRequest.projectRoot;
      const jniLibs = path.join(
        root,
        'node_modules',
        'llama.rn',
        'android',
        'src',
        'main',
        'jniLibs',
      );
      const abis = fs.existsSync(jniLibs)
        ? fs.readdirSync(jniLibs).filter((d) => !d.startsWith('.'))
        : [];
      for (const abi of abis) {
        const removed = trimAbiDir(path.join(jniLibs, abi));
        if (removed) console.log(`llama-trim: dropped ${removed} unused variant(s) from ${abi}`);
      }
      return config;
    },
  ]);
};

export default withLlamaTrim;
