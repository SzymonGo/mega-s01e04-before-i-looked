import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const NORMAL = '2026-10-01';
const EMPTY = '2026-10-02';
const BAD_LINE = '2026-10-03';
const MISSING = '2026-10-04';

// Fixture lines are deliberately not sorted by job; the routes must sort.
const normalLines = [
  { at: '2026-10-01T23:00:01+01:00', job: 'zeta/cleanup', status: 'ok', owner: null },
  { at: '2026-10-01T23:00:02+01:00', job: 'beta/flaky', status: 'retry', owner: 'lane-07', error: 'timeout' },
  { at: '2026-10-01T23:05:02+01:00', job: 'beta/flaky', status: 'retry', owner: 'lane-07', error: 'timeout' },
  { at: '2026-10-01T23:10:02+01:00', job: 'beta/flaky', status: 'retry', owner: 'lane-07', error: 'timeout' },
  { at: '2026-10-01T23:15:02+01:00', job: 'beta/flaky', status: 'ok', owner: 'lane-07' },
  { at: '2026-10-01T23:20:00+01:00', job: 'gamma/broken', status: 'fail', owner: 'rook', error: 'exit 2' },
  { at: '2026-10-01T23:30:00+01:00', job: 'alpha/first', status: 'ok', owner: 'rook' },
];
const JOBS_SORTED = ['alpha/first', 'beta/flaky', 'gamma/broken', 'zeta/cleanup'];

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-digest-routes-'));
  fs.writeFileSync(path.join(runsDir, `${NORMAL}.jsonl`), normalLines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(runsDir, `${EMPTY}.jsonl`), '');
  const good = JSON.stringify({ at: '2026-10-03T23:00:00+01:00', job: 'alpha/first', status: 'ok', owner: 'rook' });
  const truncated = '{"at":"2026-10-03T23:10:00+01:00","job":"beta/fl';
  fs.writeFileSync(path.join(runsDir, `${BAD_LINE}.jsonl`), `${good}\n${truncated}\n`);
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

afterAll(() => {
  fs.rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders a normal night with its jobs in sorted order', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    const positions = JOBS_SORTED.map((job) => html.indexOf(job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('404s for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('404s for an invalid night', async () => {
    const res = await app.request('/digest/not-a-night');
    expect(res.status).toBe(404);
  });

  it('says nothing ran for an empty file', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('still renders when a line did not parse, and says so', async () => {
    const res = await app.request(`/digest/${BAD_LINE}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('alpha/first');
    expect(html).toContain("didn't parse");
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the Night for a normal night', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.night).toBe(NORMAL);
    expect(night.badLines).toBe(0);
    expect(night.rows.map((r) => r.job)).toEqual(JOBS_SORTED);
  });

  it('404s with a JSON error for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('returns no rows for an empty file', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.rows).toEqual([]);
    expect(night.badLines).toBe(0);
  });

  it('counts a bad line without failing', async () => {
    const res = await app.request(`/api/digest/${BAD_LINE}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['alpha/first']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order for a normal night', async () => {
    const html = await (await app.request(`/digest/${NORMAL}`)).text();
    const night = (await (await app.request(`/api/digest/${NORMAL}`)).json()) as Night;
    const jsonJobs = night.rows.map((r) => r.job);
    const pageJobs = jsonJobs
      .map((job) => ({ job, at: html.indexOf(job) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((x) => x.job);
    expect(pageJobs).toEqual(jsonJobs);
  });
});
