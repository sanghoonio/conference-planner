import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseConferenceFile, parseConferenceText } from '../src/lib/load.ts';

const raw = readFileSync(new URL('../public/demo.conference.json', import.meta.url));

describe('loading files', () => {
  it('reads plain JSON', async () => {
    const r = await parseConferenceFile(new Blob([raw]));
    expect(r.ok).toBe(true);
  });

  it('reads gzipped JSON regardless of extension', async () => {
    const r = await parseConferenceFile(new Blob([gzipSync(raw)]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.conference.id).toBe('demo-symposium-2027');
  });

  it('reports invalid JSON as an error, not a throw', () => {
    const r = parseConferenceText('{"format": ');
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/not valid JSON/);
  });
});
