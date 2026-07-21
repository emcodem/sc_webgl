// Fetch a ship's reference JSON from the star-citizen.wiki API and store it (pretty-printed) under
// reference/ships/<slug>.json. Reference/metadata only -- NOT the flight source of truth, which is
// src/physics/shipTypes.ts (measured). See reference/ships/README.md.
//
// Usage: node scripts/fetch-ship-ref.mjs <slug> [<slug> ...]
//   e.g. node scripts/fetch-ship-ref.mjs aegs-gladius anvl-arrow
// Slug = the last path segment of the API URL, https://api.star-citizen.wiki/api/vehicles/<slug>.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'reference', 'ships');
const API = 'https://api.star-citizen.wiki/api/vehicles';

const slugs = process.argv.slice(2);
if (slugs.length === 0) {
  console.error('usage: node scripts/fetch-ship-ref.mjs <slug> [<slug> ...]');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

let failed = 0;
for (const slug of slugs) {
  try {
    const res = await fetch(`${API}/${slug}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (!json?.data) throw new Error('response has no `data` field (bad slug?)');
    const out = join(OUT_DIR, `${slug}.json`);
    writeFileSync(out, JSON.stringify(json, null, 2) + '\n');
    const d = json.data;
    console.log(`${slug}: ${d.game_name}  (patch ${d.version}, updated ${d.updated_at}) -> ${out}`);
  } catch (err) {
    failed++;
    console.error(`${slug}: FAILED -- ${err.message}`);
  }
}
// Set exitCode rather than process.exit() so Node drains fetch's keep-alive sockets before exiting
// (calling process.exit() mid-close triggers a libuv UV_HANDLE_CLOSING assertion on Windows).
process.exitCode = failed ? 1 : 0;
