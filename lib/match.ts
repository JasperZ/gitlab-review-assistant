/**
 * Glob matching for repository paths and project full paths.
 *
 * IMPORTANT: this imports `picomatch/posix`, NOT `picomatch`, and always passes
 * `windows: false`. Two independent guards against the same failure.
 *
 * Windows mode is not cosmetic -- with `windows: true`, `a/**` matches `a\b`. The
 * default `picomatch` entry turns it on from `navigator.platform`, which is "Win32"
 * in Chrome on Windows, so the same glob would quietly behave differently for a
 * developer on Windows than on macOS/Linux. The `posix` subpath skips that OS
 * detection; the explicit option covers the case where the import is changed back.
 *
 * (The auto-detection only triggers when an options object is passed -- which we
 * always do -- so both guards are live for this call pattern.)
 */
import picomatch from 'picomatch/posix';

export interface MatcherOptions {
  /** Case-insensitive matching. Used for project paths, not file paths. */
  nocase?: boolean;
}

/** Lines starting with this are notes, not globs. */
const COMMENT_PREFIX = '#';

/**
 * Reads a multiline glob block: one entry per line, blank lines dropped.
 *
 * Comment lines are KEPT so notes survive a save/reload round-trip; `globsOf` strips
 * them at match time.
 */
export function parseGlobLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Renders stored lines back into a textarea. */
export function formatGlobLines(lines: readonly string[]): string {
  return lines.join('\n');
}

function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith(COMMENT_PREFIX);
}

/** The subset of lines that are actually globs — the only thing matching may use. */
export function globsOf(lines: readonly string[]): string[] {
  return lines.filter((line) => !isCommentLine(line));
}

/**
 * Strips a leading `./` or `/`.
 *
 * Applied to both globs and inputs so the two sides can't drift. Users carry
 * .gitignore habits where a leading `/` means "anchored to the repo root"; in glob
 * syntax it is a literal slash character, and our paths never have one, so
 * `/charts/**` would otherwise match nothing at all.
 */
export function normalizePath(input: string): string {
  return input.replace(/^\.?\//, '');
}

/** True if the glob is syntactically valid (picomatch can compile it). */
export function isValidGlob(glob: string): boolean {
  const cleaned = normalizePath(glob.trim());
  if (cleaned.length === 0) return false;
  try {
    picomatch(cleaned, { dot: true, windows: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Compiles a set of globs into a reusable predicate. Compile once, match many --
 * that is picomatch's documented performance model, and it matters here because we
 * run the result over every file in the merge request.
 *
 * Returns a predicate that is always false when no usable globs are supplied,
 * so an empty configuration can never mark anything.
 */
export function createMatcher(
  globs: readonly string[],
  { nocase = false }: MatcherOptions = {},
): (path: string) => boolean {
  const cleaned = globs.map((g) => normalizePath(g.trim())).filter((g) => g.length > 0);

  if (cleaned.length === 0) return () => false;

  const isMatch = picomatch(cleaned, {
    // REQUIRED. Without this, `**/*.yml` does NOT match `.gitlab-ci.yml`. The bug
    // hides well: `**/.gitlab-ci.yml` works without it, because the dot is explicit
    // in the glob, so it only shows up for wildcard globs.
    dot: true,
    nocase,
    windows: false,
  });

  return (path: string) => isMatch(normalizePath(path));
}
