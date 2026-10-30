import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-read-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('gives 5 jobs sorted by job and counts the truncated last line', () => {
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night!.badLines).toBe(1);
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('keeps a job whose owner is null', () => {
    const row = night!.rows.find((r) => r.job === 'digest/render');
    expect(row).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok', lastError: null });
  });

  it('counts retries and keeps the last error after a clean run', () => {
    const row = night!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('gives the last error of a failed job', () => {
    const row = night!.rows.find((r) => r.job === 'notes/backup');
    expect(row).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
  });

  it('keeps the offsets as written', () => {
    const row = night!.rows.find((r) => r.job === 'lane/sync');
    expect(row).toMatchObject({
      runs: 8,
      retries: 1,
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });
});

describe('readNight edge cases', () => {
  it('returns null for a night with no file', () => {
    expect(readNight(tmp, '2026-01-01')).toBeNull();
  });

  it('returns a night with no rows for an empty file', () => {
    writeFileSync(join(tmp, '2026-01-02.jsonl'), '');
    expect(readNight(tmp, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts lines that do not parse, skips blank lines, never throws', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+02:00","job":"a","status":"ok","owner":"x"}',
      '',
      'not json',
      '{"at":"2026-01-03T01:01:00+02:00","job":"a","status":"done","owner":"x"}',
      '{"at":"2026-01-03T01:02:00+02:00","job":"a","status":"ok"}',
      '{"at":"2026-01-03T01:03:00+02:00","job":"a","status":"fail","owner":"x","error":42}',
      '[1,2]',
      '   ',
      '{"at":"2026-01-03T01:04:00+02:00","job":"a","status":"retry","owner":null}',
    ];
    writeFileSync(join(tmp, '2026-01-03.jsonl'), lines.join('\r\n') + '\n');
    const night = readNight(tmp, '2026-01-03');
    expect(night!.badLines).toBe(5);
    expect(night!.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(night!.rows).toEqual([
      {
        job: 'a',
        owner: null,
        runs: 2,
        retries: 1,
        lastStatus: 'retry',
        lastError: null,
        firstAt: '2026-01-03T01:00:00+02:00',
        lastAt: '2026-01-03T01:04:00+02:00',
      },
    ]);
  });
});
