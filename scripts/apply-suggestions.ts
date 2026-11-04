// Merge agent-suggested categories into a conference file as a facet with source "suggested".
// prediction.json: {"facet": {"key", "label"}, "categories": [...], "assignments": {"<presentation id>": ["<category>", ...]}}
// Usage: npx tsx scripts/apply-suggestions.ts <conference.json> <prediction.json> [--out <file>] (default: overwrite in place)
// Re-running replaces the previous suggestions for that facet key; organizer facets are never touched.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { validateConference } from '../schema/conference.ts';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
const [confPath, predPath] = outIdx >= 0 ? args.filter((_, i) => i !== outIdx && i !== outIdx + 1) : args;
if (!confPath || !predPath) {
  console.error('usage: npx tsx scripts/apply-suggestions.ts <conference.json[.gz]> <prediction.json> [--out <file>]');
  process.exit(2);
}

let buf = readFileSync(confPath);
const gz = buf[0] === 0x1f && buf[1] === 0x8b;
if (gz) buf = gunzipSync(buf);
const conf = JSON.parse(buf.toString('utf8'));
const pred = JSON.parse(readFileSync(predPath, 'utf8'));
const key: string = pred.facet?.key ?? 'topic';
const label: string = pred.facet?.label ?? 'Topic';
const categories = new Set<string>(pred.categories ?? []);

const existing = (conf.facets ?? []).find((f: any) => f.key === key);
if (existing && existing.source !== 'suggested') {
  console.error(`facet "${key}" already exists as an organizer facet; choose another key`);
  process.exit(1);
}
conf.facets = [...(conf.facets ?? []).filter((f: any) => f.key !== key), { key, label, source: 'suggested' }];

let tagged = 0;
const unknown = new Set<string>();
const seen = new Set<string>();
for (const s of conf.sessions) {
  if (s.facets) delete s.facets[key];
  for (const p of s.presentations ?? []) {
    if (p.facets) delete p.facets[key];
    const cats: string[] | undefined = pred.assignments?.[p.id];
    seen.add(p.id);
    if (!cats?.length) continue;
    for (const c of cats) if (!categories.has(c)) unknown.add(c);
    p.facets = { ...(p.facets ?? {}), [key]: [...new Set(cats)] };
    tagged++;
  }
}
const missing = Object.keys(pred.assignments ?? {}).filter((id) => !seen.has(id));
if (unknown.size) console.warn(`warning: labels not in "categories": ${[...unknown].join(', ')}`);
if (missing.length) console.warn(`warning: ${missing.length} assignment ids not found in the conference (e.g. ${missing.slice(0, 3).join(', ')})`);

const r = validateConference(conf);
if (!r.ok) {
  for (const i of r.issues) console.error(`${i.level}: ${i.path}: ${i.message}`);
  process.exit(1);
}
const json = JSON.stringify(conf, null, 2) + '\n';
const target = outPath ?? confPath;
writeFileSync(target, target.endsWith('.gz') ? gzipSync(json) : json);
console.log(`${target}: "${label}" (${categories.size} categories) on ${tagged} presentations`);
