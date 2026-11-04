// Export a conference's presentations as {id, title, abstract} for an agent to categorize.
// Usage: npx tsx scripts/export-items.ts <conference.json[.gz]> <out items.json> [--posters-only]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [input, out, ...flags] = process.argv.slice(2);
if (!input || !out) {
  console.error('usage: npx tsx scripts/export-items.ts <conference.json[.gz]> <items.json> [--posters-only]');
  process.exit(2);
}
let buf = readFileSync(input);
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
const conf = JSON.parse(buf.toString('utf8'));
const postersOnly = flags.includes('--posters-only');
const items = conf.sessions
  .filter((s: any) => !postersOnly || s.kind === 'posters')
  .flatMap((s: any) => (s.presentations ?? []).map((p: any) => ({ id: p.id, title: p.title, abstract: p.abstract ?? '' })))
  .filter((p: any) => p.abstract || p.title);
writeFileSync(out, JSON.stringify(items, null, 1));
console.log(`wrote ${items.length} items to ${out}`);
