/**
 * Decides which files in a merge request may be auto-marked as Viewed.
 *
 * Every exclusion here is deliberate and conservative: when in doubt, a file is left
 * for manual review. The extension only ever ticks boxes, never unticks them.
 *
 * Structural eligibility and glob matching are decided in one pass, in `selectFiles`.
 * There is deliberately no separate `isEligible` predicate: a second copy of the same
 * conditions is a copy that can drift from the one that actually runs.
 */
import { createMatcher, globsOf } from './match';
import type { DiffFile, MarkingOptions, Rule, SkipReason } from './types';

/**
 * True if the file was renamed or moved.
 *
 * This is not a heuristic. GitLab's backend defines the same predicate:
 *   @renamed_file = gitaly_diff.from_path != gitaly_diff.to_path
 * and `old_path`/`new_path` are exactly `from_path`/`to_path`.
 * (lib/gitlab/git/diff.rb @ v18.8.0-ee)
 *
 * Note that `old_path` is never null or empty -- for an added file it equals
 * `new_path`, and for a deleted file `new_path` equals `old_path`. A null check
 * would look correct and quietly misclassify every add and delete.
 */
export function isRenamed(file: DiffFile): boolean {
  return file.old_path !== file.new_path;
}

export interface Selection {
  /** Files that will be marked Viewed. */
  matched: DiffFile[];
  /** Everything else, with the reason it was left alone. */
  skipped: Array<{ file: DiffFile; reason: SkipReason }>;
  /** Rules whose project scope matched this project. */
  activeRules: Rule[];
}

/**
 * Selects the files to mark for a given project.
 *
 * Project scopes are evaluated once, up front, so the (potentially hundreds of)
 * per-file path matches run against a single compiled matcher.
 */
export function selectFiles(
  files: readonly DiffFile[],
  projectFullPath: string,
  rules: readonly Rule[],
  options: MarkingOptions,
): Selection {
  const activeRules = rules.filter(
    (rule) =>
      rule.enabled &&
      // Project paths are case-insensitively unique in GitLab, unlike file paths.
      createMatcher([rule.project], { nocase: true })(projectFullPath),
  );

  // One compiled matcher across every glob of every in-scope rule -- still a single
  // matcher run per file, which is what keeps a 400-file merge request cheap.
  // globsOf drops comment lines, which are stored so notes survive a reload.
  const matchesPath = createMatcher(
    activeRules.flatMap((rule) => globsOf(rule.globs)),
    { nocase: false },
  );

  const matched: DiffFile[] = [];
  const skipped: Selection['skipped'] = [];

  for (const file of files) {
    // Structural categories are decided before globs, so the summary can say
    // "skipped: deleted" rather than the misleading "didn't match any pattern".
    if (!file.code_review_id) {
      // Not configurable: GitLab renders no Viewed checkbox without this (its own
      // isReviewable requires it), so there is nothing to tick, and marking one would
      // write a null into the id list that would persist forever.
      skipped.push({ file, reason: 'no-checkbox' });
    } else if (file.deleted_file && !options.markDeletedFiles) {
      skipped.push({ file, reason: 'deleted' });
    } else if (file.submodule && !options.markSubmodules) {
      skipped.push({ file, reason: 'submodule' });
    } else if (isRenamed(file) && !options.markRenamedFiles) {
      skipped.push({ file, reason: 'renamed' });
    } else if (file.new_file && !options.markNewFiles) {
      skipped.push({ file, reason: 'new' });
    } else if (!matchesPath(file.new_path)) {
      skipped.push({ file, reason: 'no-pattern-match' });
    } else {
      matched.push(file);
    }
  }

  return { matched, skipped, activeRules };
}

/**
 * Groups paths by their parent directory, for the collapsed confirmation overlay.
 * Sorted by directory name; files within a directory sorted by name.
 */
export function groupByDirectory(files: readonly DiffFile[]): Array<{
  directory: string;
  files: string[];
}> {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const slash = file.new_path.lastIndexOf('/');
    const directory = slash === -1 ? '.' : file.new_path.slice(0, slash);
    const name = slash === -1 ? file.new_path : file.new_path.slice(slash + 1);
    const bucket = groups.get(directory);
    if (bucket) bucket.push(name);
    else groups.set(directory, [name]);
  }

  return [...groups.entries()]
    .map(([directory, names]) => ({ directory, files: names.sort() }))
    .sort((a, b) => a.directory.localeCompare(b.directory));
}
