import { describe, expect, it } from 'vitest';
import {
  createMatcher,
  formatGlobLines,
  globsOf,
  isValidGlob,
  normalizePath,
  parseGlobLines,
} from './match';

/** Convenience for single-pattern assertions. */
const matches = (pattern: string, path: string, nocase = false) =>
  createMatcher([pattern], { nocase })(path);

describe('normalizePath', () => {
  it('strips a leading slash or ./', () => {
    expect(normalizePath('/charts/a.yaml')).toBe('charts/a.yaml');
    expect(normalizePath('./charts/a.yaml')).toBe('charts/a.yaml');
    expect(normalizePath('charts/a.yaml')).toBe('charts/a.yaml');
  });

  it('leaves interior slashes and bare names alone', () => {
    expect(normalizePath('a//b')).toBe('a//b');
    expect(normalizePath('**')).toBe('**');
  });
});

describe('createMatcher — the behaviours the design depends on', () => {
  it('** matches zero path segments', () => {
    // The single most load-bearing glob behaviour here: a pattern written for nested
    // charts must still match the same file at the repo root.
    expect(matches('**/templates/*.yaml', 'templates/foo.yaml')).toBe(true);
    expect(matches('**/templates/*.yaml', 'charts/app/templates/foo.yaml')).toBe(true);
  });

  it('** collapses to zero mid-pattern too', () => {
    expect(matches('charts/**/values.yaml', 'charts/values.yaml')).toBe(true);
    expect(matches('charts/**/values.yaml', 'charts/app/nested/values.yaml')).toBe(true);
    // The literal prefix is still required.
    expect(matches('charts/**/values.yaml', 'other/values.yaml')).toBe(false);
  });

  it('matches dotfiles — the dot:true case', () => {
    // Without `dot: true` this returns false. The bug hides well, because an explicit
    // dot in the glob works either way, so only wildcard globs expose it.
    expect(matches('**/*.yml', '.gitlab-ci.yml')).toBe(true);
    expect(matches('**/*.yml', 'ci/.hidden.yml')).toBe(true);
    expect(matches('**/.gitlab-ci.yml', '.gitlab-ci.yml')).toBe(true);
  });

  it('* does not cross a path separator', () => {
    expect(matches('platform/service-*', 'platform/service-api')).toBe(true);
    expect(matches('platform/service-*', 'platform/service-api/sub')).toBe(false);
  });

  it('trailing /** also matches the bare prefix', () => {
    // Flagged as unverified during design (read from picomatch's source, with no test
    // asserting it). Asserted here so an upgrade that changes it fails loudly.
    expect(matches('mygroup/**', 'mygroup')).toBe(true);
    expect(matches('mygroup/**', 'mygroup/proj')).toBe(true);
    expect(matches('mygroup/**', 'mygroup/sub/proj')).toBe(true);
    expect(matches('mygroup/**', 'othergroup/proj')).toBe(false);
  });

  it('tolerates a leading slash, which users write out of .gitignore habit', () => {
    expect(matches('/charts/**', 'charts/app/x.yaml')).toBe(true);
    expect(matches('charts/**', '/charts/app/x.yaml')).toBe(true);
  });

  it('is case-sensitive by default, and case-insensitive on request', () => {
    expect(matches('README.md', 'readme.md')).toBe(false);
    expect(matches('README.md', 'README.md')).toBe(true);
    // Project scopes use nocase, because GitLab namespace paths are
    // case-insensitively unique.
    expect(matches('MyGroup/**', 'mygroup/proj', true)).toBe(true);
  });

  it('supports brace sets', () => {
    const m = createMatcher(['**/*.{yaml,yml}']);
    expect(m('charts/values.yaml')).toBe(true);
    expect(m('charts/values.yml')).toBe(true);
    expect(m('charts/values.json')).toBe(false);
  });

  it('treats a pattern list as a union', () => {
    const m = createMatcher(['**/*.yaml', 'docs/**']);
    expect(m('a/b.yaml')).toBe(true);
    expect(m('docs/index.md')).toBe(true);
    expect(m('src/main.ts')).toBe(false);
  });

  it('never matches when there are no usable globs', () => {
    // An empty configuration must be incapable of marking anything.
    expect(createMatcher([])('anything')).toBe(false);
    expect(createMatcher(['', '   '])('anything')).toBe(false);
  });

  it('matches exact paths, since a full path is itself a valid glob', () => {
    expect(matches('charts/app/values.yaml', 'charts/app/values.yaml')).toBe(true);
    expect(matches('charts/app/values.yaml', 'charts/app/values.yml')).toBe(false);
  });

  it('does not treat a backslash as a separator, even when the platform looks like Windows', () => {
    // Guards `windows: false` in createMatcher.
    //
    // picomatch's Windows mode is not cosmetic: with `windows: true`, `a/**` DOES
    // match `a\b`. The default picomatch entry turns that on automatically from
    // navigator.platform -- but only when an options object is passed, which we always
    // do. So dropping our explicit `windows: false` would silently give Windows
    // developers different results from everyone else. Faking Win32 here makes that
    // regression fail the suite on every platform.
    //
    // Note this does NOT detect a switch from `picomatch/posix` back to `picomatch`
    // on its own -- with `windows: false` set, the two entries behave identically.
    // The posix import is the belt; this assertion is the braces.
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'platform');
    Object.defineProperty(globalThis.navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    try {
      expect(globalThis.navigator.platform).toBe('Win32');
      expect(matches('a/**', 'a\\b')).toBe(false);
      expect(matches('a/**', 'a/b')).toBe(true);
    } finally {
      if (original) Object.defineProperty(globalThis.navigator, 'platform', original);
    }
  });
});

describe('pattern lines', () => {
  it('splits on newlines, trims, and drops blanks', () => {
    expect(parseGlobLines('  a/*.yaml \n\n  b/*.yml\n\n')).toEqual(['a/*.yaml', 'b/*.yml']);
  });

  it('keeps comment lines so notes survive a save/reload', () => {
    expect(parseGlobLines('# charts\na/*.yaml')).toEqual(['# charts', 'a/*.yaml']);
  });

  it('preserves order', () => {
    expect(parseGlobLines('z\na\nm')).toEqual(['z', 'a', 'm']);
  });

  it('round-trips through formatGlobLines', () => {
    const text = '# charts\n**/templates/*.yaml\n**/*.gen.ts';
    expect(formatGlobLines(parseGlobLines(text))).toBe(text);
  });

  it('globsOf strips comments and nothing else', () => {
    expect(globsOf(['# note', 'a/*.yaml', '  # indented note', 'b'])).toEqual(['a/*.yaml', 'b']);
  });

  it('does not treat a mid-line # as a comment', () => {
    // '#' is legal in a path, so only a leading one is a note.
    expect(globsOf(['docs/c#sharp/*.md'])).toEqual(['docs/c#sharp/*.md']);
  });
});

describe('isValidGlob', () => {
  it('accepts ordinary globs', () => {
    expect(isValidGlob('**/templates/*.yaml')).toBe(true);
    expect(isValidGlob('**')).toBe(true);
  });

  it('rejects blank input', () => {
    expect(isValidGlob('')).toBe(false);
    expect(isValidGlob('   ')).toBe(false);
    expect(isValidGlob('/')).toBe(false);
  });
});
