import { validateConference, type Issue, type ParseResult } from '../../schema/conference.ts';

/** Read a .json or gzipped .json file (gzip detected by magic bytes, not extension). */
export async function readConferenceBytes(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function parseConferenceText(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const issue: Issue = { level: 'error', path: '(file)', message: `not valid JSON: ${(e as Error).message}` };
    return { ok: false, issues: [issue] };
  }
  return validateConference(value);
}

export async function parseConferenceFile(file: Blob): Promise<ParseResult> {
  try {
    return parseConferenceText(await readConferenceBytes(await file.arrayBuffer()));
  } catch (e) {
    return { ok: false, issues: [{ level: 'error', path: '(file)', message: `could not read file: ${(e as Error).message}` }] };
  }
}
