/**
 * Build a per-emoji index for Emoji Kitchen combos (lossless, no guessing).
 * Output:
 *  - public/emoji-index/manifest.json  { version, count }
 *  - public/emoji-index/u{codepoint}.json { codepoint, asLeft, asRight }
 *
 * Source priority:
 *  1) data/metadata.json (if present)
 *  2) public/metadata-parts/manifest.json + part-*.json (committed in repo)
 *  3) public/metadata.json (if present)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'emoji-index');

const SRC_DATA = path.join(ROOT, 'data', 'metadata.json');
const SRC_PUBLIC = path.join(ROOT, 'public', 'metadata.json');
const SRC_PARTS_DIR = path.join(ROOT, 'public', 'metadata-parts');
const SRC_PARTS_MANIFEST = path.join(SRC_PARTS_DIR, 'manifest.json');

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function mergeFromParts() {
  const h = crypto.createHash('sha256');
  const mRaw = fs.readFileSync(SRC_PARTS_MANIFEST);
  h.update(mRaw);
  const manifest = JSON.parse(mRaw.toString('utf-8'));
  const parts = manifest?.parts;
  if (!Number.isInteger(parts) || parts <= 0) throw new Error('Invalid parts manifest');

  const merged = { knownSupportedEmoji: [], data: {} };
  for (let i = 0; i < parts; i++) {
    const p = path.join(SRC_PARTS_DIR, `part-${i}.json`);
    const raw = fs.readFileSync(p);
    h.update(raw);
    const json = JSON.parse(raw.toString('utf-8'));
    if (Array.isArray(json?.knownSupportedEmoji) && merged.knownSupportedEmoji.length === 0) {
      merged.knownSupportedEmoji = json.knownSupportedEmoji;
    }
    if (json?.data && typeof json.data === 'object') {
      Object.assign(merged.data, json.data);
    }
  }

  return { metadata: merged, version: h.digest('hex') };
}

function loadSource() {
  if (fs.existsSync(SRC_DATA)) {
    const raw = fs.readFileSync(SRC_DATA);
    return { metadata: JSON.parse(raw.toString('utf-8')), version: sha256Hex(raw) };
  }
  if (fs.existsSync(SRC_PARTS_MANIFEST)) {
    return mergeFromParts();
  }
  if (fs.existsSync(SRC_PUBLIC)) {
    const raw = fs.readFileSync(SRC_PUBLIC);
    return { metadata: JSON.parse(raw.toString('utf-8')), version: sha256Hex(raw) };
  }
  throw new Error('No metadata source found (data/metadata.json, public/metadata-parts, public/metadata.json)');
}

function main() {
  const { metadata, version } = loadSource();
  const data = metadata?.data;
  if (!data || typeof data !== 'object') throw new Error('Invalid metadata: missing data object');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const asLeft = new Map();  // codepoint -> array
  const asRight = new Map(); // codepoint -> array

  const push = (m, k, v) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };

  // Linear pass over all combos: build both directions without O(N) scanning at runtime.
  for (const leftCp of Object.keys(data)) {
    const combosByRight = data[leftCp]?.combinations;
    if (!combosByRight || typeof combosByRight !== 'object') continue;
    for (const rightCp of Object.keys(combosByRight)) {
      const arr = combosByRight[rightCp];
      if (!Array.isArray(arr)) continue;
      for (const c of arr) {
        if (!c || !c.isLatest) continue;
        if (!c.leftEmoji || !c.rightEmoji || !c.gStaticUrl) continue;
        const entry = {
          leftEmoji: c.leftEmoji,
          rightEmoji: c.rightEmoji,
          gStaticUrl: c.gStaticUrl,
          date: c.date || null,
          isLatest: true
        };
        push(asLeft, leftCp, entry);
        push(asRight, rightCp, entry);
      }
    }
  }

  const allCps = new Set([...asLeft.keys(), ...asRight.keys()]);

  // Deduplicate per codepoint by left+right (safety)
  for (const cp of allCps) {
    const leftArr = asLeft.get(cp) || [];
    const rightArr = asRight.get(cp) || [];
    const dedupe = (arr) => {
      const seen = new Set();
      const out = [];
      for (const x of arr) {
        const k = `${x.leftEmoji}+${x.rightEmoji}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(x);
      }
      return out;
    };
    const payload = {
      codepoint: cp,
      asLeft: dedupe(leftArr),
      asRight: dedupe(rightArr)
    };
    fs.writeFileSync(path.join(OUT_DIR, `u${cp}.json`), JSON.stringify(payload), 'utf-8');
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ version, count: allCps.size }),
    'utf-8'
  );

  console.log(`✅ Emoji index built: ${allCps.size} files, version=${version.slice(0, 12)}…`);
}

try {
  main();
} catch (e) {
  console.error('❌ buildEmojiIndex failed:', e?.message || e);
  process.exit(1);
}

