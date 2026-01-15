/**
 * Split data/metadata.json into multiple smaller files under public/metadata-parts/.
 * Usage: node scripts/splitMetadata.js [--parts N]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT = path.join(__dirname, '../data/metadata.json');
const OUT_DIR = path.join(__dirname, '../public/metadata-parts');

function parseArgs() {
  const idx = process.argv.indexOf('--parts');
  if (idx >= 0 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 2; // default
}

function main() {
  const partsCount = parseArgs();
  if (!fs.existsSync(INPUT)) {
    console.error(`❌ Missing ${INPUT}, cannot split.`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));
  const data = raw?.data;
  if (!data || typeof data !== 'object') {
    console.error('❌ Invalid metadata format: missing data object.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const keys = Object.keys(data);
  const chunkSize = Math.ceil(keys.length / partsCount);

  for (let i = 0; i < partsCount; i++) {
    const slice = keys.slice(i * chunkSize, (i + 1) * chunkSize);
    const part = { knownSupportedEmoji: raw.knownSupportedEmoji, data: {} };
    slice.forEach(k => { part.data[k] = data[k]; });
    fs.writeFileSync(
      path.join(OUT_DIR, `part-${i}.json`),
      JSON.stringify(part),
      'utf-8'
    );
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ parts: partsCount }),
    'utf-8'
  );
  console.log(`✅ Split metadata into ${partsCount} parts at ${OUT_DIR}`);
}

main();


