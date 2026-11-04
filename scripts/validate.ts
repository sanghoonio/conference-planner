// Validate a conference file (.json or .json.gz) with the same schema + semantic checks the app runs.
// Usage: npm run validate -- <file> [more files…]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { validateConference } from '../schema/conference.ts';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: npm run validate -- <file.conference.json[.gz]> …');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  let buf = readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  let value: unknown;
  try {
    value = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    console.log(`✗ ${file}: not valid JSON: ${(e as Error).message}`);
    failed = true;
    continue;
  }
  const r = validateConference(value);
  for (const i of r.issues) console.log(`  ${i.level === 'error' ? 'error  ' : 'warning'} ${i.path}: ${i.message}`);
  if (r.ok) {
    const sessions = r.data.sessions.length;
    const pres = r.data.sessions.reduce((n, s) => n + (s.presentations?.length ?? 0), 0);
    const kinds: Record<string, number> = {};
    for (const s of r.data.sessions) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
    const days = new Set(r.data.sessions.map((s) => s.start.slice(0, 10)));
    console.log(
      `✓ ${file}: ${r.data.conference.name} — ${sessions} sessions (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), ${pres} presentations, ${days.size} days` +
        (r.issues.length ? `, ${r.issues.length} warning(s)` : ''),
    );
  } else {
    console.log(`✗ ${file}: ${r.issues.filter((i) => i.level === 'error').length} error(s)`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
