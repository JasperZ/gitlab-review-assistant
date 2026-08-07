import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  ALL_PROJECTS,
  DEFAULT_MARKING_OPTIONS,
  debounce,
  loadMarkingOptions,
  loadRules,
  newRule,
  normalizeMarkingOptions,
  normalizeRule,
  rulesItem,
  saveMarkingOptions,
  saveRules,
  validateRule,
} from './settings';
import type { LegacyRule, Rule } from './types';

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  project: ALL_PROJECTS,
  globs: ['**/templates/*.yaml'],
  enabled: true,
  ...overrides,
});

const legacy = (overrides: Partial<LegacyRule> = {}): LegacyRule => ({
  project: ALL_PROJECTS,
  pattern: '**/templates/*.yaml',
  enabled: true,
  ...overrides,
});

describe('newRule', () => {
  it('defaults to every project with an empty glob list', () => {
    expect(newRule()).toEqual({ project: '**', globs: [], enabled: true });
  });
});

describe('normalizeRule', () => {
  it('upgrades the pre-v2 single-glob shape', () => {
    expect(normalizeRule(legacy({ pattern: 'a/*.yaml' }))).toEqual({
      project: '**',
      globs: ['a/*.yaml'],
      enabled: true,
    });
  });

  it('upgrades the v2 shape, which called the glob list "patterns"', () => {
    // The v3 rename is a rename of the field, not of the data. Configuration written
    // before it must keep working whether or not WXT's migration ever fires.
    expect(normalizeRule({ project: '**', patterns: ['a/*.yaml'], enabled: true })).toEqual({
      project: '**',
      globs: ['a/*.yaml'],
      enabled: true,
    });
  });

  it('prefers globs when an entry somehow carries both spellings', () => {
    expect(
      normalizeRule({ project: '**', globs: ['new'], patterns: ['old'], enabled: true }),
    ).toEqual({ project: '**', globs: ['new'], enabled: true });
  });

  it('passes a current-shape rule through unchanged', () => {
    const r = rule({ globs: ['a', 'b'] });
    expect(normalizeRule(r)).toEqual(r);
  });

  it('drops non-string globs rather than failing the whole rule', () => {
    const messy = { project: '**', globs: ['a', 3, null, 'b'], enabled: true };
    expect(normalizeRule(messy)).toEqual({ project: '**', globs: ['a', 'b'], enabled: true });
  });

  it('rejects entries it cannot make sense of', () => {
    expect(normalizeRule(null)).toBeNull();
    expect(normalizeRule('nope')).toBeNull();
    expect(normalizeRule({ project: '**' })).toBeNull();
    expect(normalizeRule({ project: 3, globs: [], enabled: true })).toBeNull();
  });
});

describe('validateRule', () => {
  it('accepts a well-formed rule', () => {
    expect(validateRule(rule())).toEqual([]);
    expect(validateRule(rule({ globs: ['a/*.yaml', 'b/*.yml'] }))).toEqual([]);
  });

  it('requires a project', () => {
    expect(validateRule(rule({ project: '' }))).toEqual([
      { field: 'project', message: expect.stringContaining('Required') },
    ]);
  });

  it('requires at least one glob', () => {
    expect(validateRule(rule({ globs: [] }))).toEqual([
      { field: 'globs', message: expect.stringContaining('Required') },
    ]);
  });

  it('treats a comment-only rule as empty', () => {
    expect(validateRule(rule({ globs: ['# just a note'] }))).toEqual([
      { field: 'globs', message: expect.stringContaining('Required') },
    ]);
  });

  it('names the offending glob rather than a line number', () => {
    // Blank lines are dropped on save, so a line number would drift from what the
    // user sees in the textarea.
    const problems = validateRule(rule({ globs: ['ok/*.yaml', '/anchored/**'] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('/anchored/**');
    expect(problems[0]?.message).toMatch(/literal slash/i);
  });

  it('does not validate comment lines as globs', () => {
    expect(validateRule(rule({ globs: ['# /not/a/glob', 'a/*.yaml'] }))).toEqual([]);
  });
});

describe('persistence', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('round-trips through sync storage', async () => {
    await saveRules([rule({ globs: ['a', 'b'] })]);
    expect(await loadRules()).toEqual([rule({ globs: ['a', 'b'] })]);
  });

  it('starts empty', async () => {
    expect(await loadRules()).toEqual([]);
  });

  it('reads configuration written in the pre-v2 shape', async () => {
    // The regression that matters: users have working single-glob rules in sync
    // storage. Normalising on read means they survive even if WXT's migration never
    // fires, which a manually reloaded unpacked extension does not guarantee.
    await rulesItem.setValue([legacy({ pattern: 'charts/**' })] as unknown as Rule[]);
    expect(await loadRules()).toEqual([{ project: '**', globs: ['charts/**'], enabled: true }]);
  });

  it('reads configuration written in the v2 shape', async () => {
    await rulesItem.setValue([
      { project: '**', patterns: ['charts/**'], enabled: true },
    ] as unknown as Rule[]);
    expect(await loadRules()).toEqual([{ project: '**', globs: ['charts/**'], enabled: true }]);
  });

  it('drops malformed entries rather than crashing the options page', async () => {
    await rulesItem.setValue([rule(), { project: '**' }, null] as unknown as Rule[]);
    expect(await loadRules()).toEqual([rule()]);
  });
});

describe('marking options', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults reproduce the behaviour that used to be hardcoded', () => {
    // Regression guard: upgrading must not change what gets marked.
    expect(DEFAULT_MARKING_OPTIONS).toEqual({
      markNewFiles: true,
      markDeletedFiles: false,
      markRenamedFiles: false,
      markSubmodules: false,
    });
  });

  it('round-trips through sync storage', async () => {
    const options = { ...DEFAULT_MARKING_OPTIONS, markDeletedFiles: true };
    await saveMarkingOptions(options);
    expect(await loadMarkingOptions()).toEqual(options);
  });

  it('starts at the defaults', async () => {
    expect(await loadMarkingOptions()).toEqual(DEFAULT_MARKING_OPTIONS);
  });

  it('coerces per field, so a corrupt value never disables marking wholesale', () => {
    expect(normalizeMarkingOptions({ markDeletedFiles: true, markNewFiles: 'nope' })).toEqual({
      ...DEFAULT_MARKING_OPTIONS,
      markDeletedFiles: true,
    });
    expect(normalizeMarkingOptions(null)).toEqual(DEFAULT_MARKING_OPTIONS);
    expect(normalizeMarkingOptions('garbage')).toEqual(DEFAULT_MARKING_OPTIONS);
    expect(normalizeMarkingOptions({})).toEqual(DEFAULT_MARKING_OPTIONS);
  });

  it('ignores unknown fields', () => {
    expect(normalizeMarkingOptions({ ...DEFAULT_MARKING_OPTIONS, bogus: true })).toEqual(
      DEFAULT_MARKING_OPTIONS,
    );
  });
});

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once on the trailing edge', () => {
    // storage.sync throttles at 120 writes/minute; saving per keystroke exceeds that
    // in seconds.
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced('a');
    debounced('b');
    debounced('c');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('allows a second call after the window elapses', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(100);
    debounced();
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
