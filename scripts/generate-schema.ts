// Writes public/conference.schema.json from the Zod schema (the single source of truth).
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Conference, FORMAT } from '../schema/conference.ts';

const json = z.toJSONSchema(Conference, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
const out = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'conference.schema.json',
  title: `Conference file (${FORMAT})`,
  description:
    'A complete scientific conference program for Conference Planner. All times are local wall-clock "YYYY-MM-DDTHH:mm" in conference.timezone. See AGENTS.md.',
  ...json,
};
writeFileSync(new URL('../public/conference.schema.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log('wrote public/conference.schema.json');
