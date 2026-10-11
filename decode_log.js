const z = require('zlib');
const fs = require('fs');
const input = process.argv[2];
const output = process.argv[3];
try {
  const d = z.brotliDecompressSync(fs.readFileSync(input));
  fs.writeFileSync(output, d.toString());
  console.log('decoded ' + d.length + ' bytes');
} catch (e) {
  console.log('NOT brotli: ' + e.message.slice(0, 80));
  // maybe plain text already
  const raw = fs.readFileSync(input);
  if (raw.length > 0 && raw[0] === 0x7b) {
    fs.writeFileSync(output, raw.toString());
    console.log('copied as plain text ' + raw.length + ' bytes');
  }
}
