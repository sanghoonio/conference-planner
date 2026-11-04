import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SESSION_KINDS, validateConference } from '../schema/conference.ts';

const md = readFileSync(new URL('../public/AGENTS.md', import.meta.url), 'utf8');

describe('AGENTS.md', () => {
  it('has a complete example that validates with no warnings', () => {
    const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    const full = blocks.find((b) => b.includes('"format"'));
    expect(full).toBeTruthy();
    const r = validateConference(JSON.parse(full!));
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('documents every session kind and every schema field', () => {
    for (const k of SESSION_KINDS) expect(md).toContain(`\`${k}\``);
    const schema = JSON.parse(readFileSync(new URL('../public/conference.schema.json', import.meta.url), 'utf8'));
    const sessionProps = Object.keys(schema.properties.sessions.items.properties);
    const presProps = Object.keys(schema.properties.sessions.items.properties.presentations.anyOf[0].items.properties);
    const confProps = Object.keys(schema.properties.conference.properties);
    for (const f of [...sessionProps, ...presProps, ...confProps]) expect(md, f).toMatch(new RegExp('`' + f.replace('$', '\\$') + '`'));
  });
});
