import { describe, expect, it } from 'vitest';
import { FILE_SCHEMA, FILE_VERSION, parseSettingsFile, serializeSettings } from './transfer';
import { DEFAULT_MARKING_OPTIONS, SCHEMA_VERSION } from './settings';
import type { Rule } from './types';

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  project: '**',
  globs: ['**/templates/*.yaml'],
  enabled: true,
  ...overrides,
});

/** Narrows to the success shape so tests can read `.rules` without casting. */
function expectOk(result: ReturnType<typeof parseSettingsFile>) {
  if (!result.ok) throw new Error(`expected success, got: ${result.reason}`);
  return result;
}

describe('FILE_VERSION', () => {
  it('is the rule storage schema version', () => {
    // Derived rather than copied, so this cannot drift. Asserted anyway: reintroducing
    // a literal here would silently mislabel exported files and break the "written by
    // a newer version" warning.
    expect(FILE_VERSION).toBe(SCHEMA_VERSION);
  });
});

describe('serializeSettings', () => {
  it('writes a recognisable, version-stamped envelope', () => {
    const parsed = JSON.parse(serializeSettings([rule()], DEFAULT_MARKING_OPTIONS));
    expect(parsed.$schema).toBe(FILE_SCHEMA);
    expect(parsed.version).toBe(FILE_VERSION);
    expect(parsed.rules).toHaveLength(1);
  });

  it('is pretty-printed and newline-terminated so it diffs cleanly in git', () => {
    const text = serializeSettings([rule()], DEFAULT_MARKING_OPTIONS);
    expect(text).toContain('\n  ');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('parseSettingsFile', () => {
  it('round-trips exactly', () => {
    const original = [
      rule({ globs: ['a/*.yaml', 'b/*.yml'] }),
      rule({ project: 'group/**', globs: ['c/*'], enabled: false }),
    ];
    expect(
      expectOk(parseSettingsFile(serializeSettings(original, DEFAULT_MARKING_OPTIONS))).rules,
    ).toEqual(original);
  });

  it('preserves comment lines through the round trip', () => {
    const original = [rule({ globs: ['# generated charts', '**/templates/*.yaml'] })];
    expect(
      expectOk(parseSettingsFile(serializeSettings(original, DEFAULT_MARKING_OPTIONS))).rules,
    ).toEqual(original);
  });

  it('round-trips the marking options', () => {
    const marking = {
      markNewFiles: false,
      markDeletedFiles: true,
      markRenamedFiles: true,
      markSubmodules: false,
    };
    const result = expectOk(parseSettingsFile(serializeSettings([rule()], marking)));
    expect(result.marking).toEqual(marking);
  });

  it('falls back to defaults for a file exported before marking options existed', () => {
    // Every file exported by an earlier build looks exactly like this.
    const old = {
      $schema: 'gitlab-review-assistant/patterns',
      version: 2,
      patterns: [{ project: '**', patterns: ['**/templates/*.yaml'], enabled: true }],
    };
    const result = expectOk(parseSettingsFile(JSON.stringify(old)));
    expect(result.marking).toEqual(DEFAULT_MARKING_OPTIONS);
  });

  it('reads a v2 file, whose rule array and glob lists were both called "patterns"', () => {
    // Files exported before the v3 rename. Both spellings have to survive, at both
    // levels, or every previously exported config becomes unimportable.
    const v2 = {
      $schema: FILE_SCHEMA,
      version: 2,
      patterns: [{ project: 'group/**', patterns: ['a/*.yaml'], enabled: false }],
    };
    const result = expectOk(parseSettingsFile(JSON.stringify(v2)));
    expect(result.rules).toEqual([{ project: 'group/**', globs: ['a/*.yaml'], enabled: false }]);
  });

  it('coerces a partial or malformed marking block per field', () => {
    const messy = {
      rules: [rule()],
      marking: { markDeletedFiles: true, markNewFiles: 'yes', bogus: 1 },
    };
    const result = expectOk(parseSettingsFile(JSON.stringify(messy)));
    expect(result.marking).toEqual({ ...DEFAULT_MARKING_OPTIONS, markDeletedFiles: true });
  });

  it('accepts a bare array, for hand-written files', () => {
    const result = expectOk(parseSettingsFile(JSON.stringify([rule()])));
    expect(result.rules).toEqual([rule()]);
  });

  it('upgrades pre-v2 single-glob entries', () => {
    const legacy = [{ project: '**', pattern: 'charts/**', enabled: true }];
    const result = expectOk(parseSettingsFile(JSON.stringify({ rules: legacy })));
    expect(result.rules).toEqual([{ project: '**', globs: ['charts/**'], enabled: true }]);
  });

  it('keeps the good entries and counts the rest', () => {
    const mixed = { rules: [rule(), { nope: true }, null, 'string'] };
    const result = expectOk(parseSettingsFile(JSON.stringify(mixed)));
    expect(result.rules).toEqual([rule()]);
    expect(result.skipped).toBe(3);
  });

  it('warns about a newer file but still imports it', () => {
    const future = { $schema: FILE_SCHEMA, version: FILE_VERSION + 1, rules: [rule()] };
    const result = expectOk(parseSettingsFile(JSON.stringify(future)));
    expect(result.rules).toEqual([rule()]);
    expect(result.warning).toMatch(/newer version/i);
  });

  it('does not warn about the current version', () => {
    expect(
      expectOk(parseSettingsFile(serializeSettings([rule()], DEFAULT_MARKING_OPTIONS))).warning,
    ).toBeUndefined();
  });

  describe('rejects, with a reason, rather than throwing', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['not JSON', 'this is not json {', /not valid JSON/i],
      ['an empty object', '{}', /no rule list/i],
      ['a non-array rules field', '{"rules":"nope"}', /no rule list/i],
      ['a bare string', '"hello"', /no rule list/i],
      ['null', 'null', /no rule list/i],
      ['an empty array', '[]', /empty rule list/i],
      ['an array of junk', '[1,2,3]', /none of the 3 entries/i],
    ];

    for (const [label, text, expected] of cases) {
      it(label, () => {
        const result = parseSettingsFile(text);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(expected);
      });
    }
  });
});
