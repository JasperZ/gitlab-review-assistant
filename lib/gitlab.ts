/**
 * Reads the contracts GitLab's merge-request page exposes to the DOM.
 *
 * Every function takes its document/storage explicitly so it can be unit-tested
 * against a saved HTML fixture with no browser.
 *
 * All findings verified against gitlab-org/gitlab at tag v18.8.0-ee.
 */
import type { DiffsMetadata } from './types';

/**
 * GitLab's own regex for extracting the merge-request path.
 * app/assets/javascripts/diffs/utils/merge_request.js @ v18.8.0-ee
 */
const MR_PATH_RE = /^(\/?(.+\/)+(.+)\/-\/merge_requests\/(\d+)).*$/i;

/**
 * Server-rendered mount point of the classic diffs app.
 *
 * ⚠️ Usually ABSENT from the live DOM. `diffs/index.js` does `new Vue({ el, ... })`,
 * and Vue 2 *replaces* the mount element with the component's rendered root — so the
 * id survives in the server HTML but is gone by the time anything is injected.
 * Confirmed against a real 18.8 instance.
 *
 * Treat it as an optimisation, never a requirement: when it is present its dataset is
 * the most faithful source, and everything falls back to the URL when it is not.
 */
export function getDiffsApp(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('#js-diffs-app');
}

/**
 * Derives `mrPath` from the diffs app's `data-endpoint`.
 *
 * Deliberately NOT from `location.pathname`: this must reproduce GitLab's own
 * computation byte-for-byte, because it becomes the localStorage key GitLab itself
 * reads. On a self-hosted instance with a relative URL root the result therefore
 * includes that root -- which is correct here, and wrong for the project full path
 * (see `getProjectFullPath`).
 */
export function deriveMrPath(endpoint: string): string | null {
  return endpoint.match(MR_PATH_RE)?.[1] ?? null;
}

/**
 * Resolves `mrPath`, preferring the diffs app's `data-endpoint` and falling back to the
 * page URL.
 *
 * The fallback is exact, not approximate: `data-endpoint` is
 * `<mrPath>/diffs.json?...` and `location.pathname` is `<mrPath>/diffs`, so the same
 * regex yields the same capture from either. Both carry a self-hosted relative URL
 * root, which this value must keep — it becomes GitLab's own storage key.
 *
 * The fallback is the path that actually runs in practice, because Vue has replaced
 * the element by then. See `getDiffsApp`.
 */
export function resolveMrPath(doc: Document, pathname: string): string | null {
  const endpoint = getDiffsApp(doc)?.dataset?.endpoint;
  return (endpoint ? deriveMrPath(endpoint) : null) ?? deriveMrPath(pathname);
}

/** The localStorage key GitLab keeps per-file "Viewed" state under. */
export function storageKeyFor(mrPath: string): string {
  return `code-review-${mrPath}`;
}

/**
 * The project's full path (`group/subgroup/project`), for matching project scopes.
 *
 * `data-project-full-path` is `Project#full_path` straight from the routes table, so
 * it never contains a relative URL root, handles arbitrary subgroup nesting, and is
 * unaffected by GitLab's client-side MR tab switching. Present since GitLab 17.0.
 *
 * Deliberately does NOT fall back to `#js-diffs-app`'s `data-project-path`: at 18.8
 * that attribute is populated by the Rails *route helper*, so it yields
 * `/group/project` -- leading slash, relative-root-prefixed. It only became
 * `full_path` after 19.2.
 */
export function getProjectFullPath(doc: Document): string | null {
  const fromBody = doc.body?.dataset?.projectFullPath;
  if (fromBody) return fromBody;

  // Fallback for the MR page. `data-project-path` here IS full_path despite the name
  // (_page.html.haml passes `@merge_request.project.full_path`). Guard the leading
  // slash in case a future release swaps in a route helper.
  const fromMr = doc.querySelector<HTMLElement>('.merge-request')?.dataset?.projectPath;
  if (fromMr && !fromMr.startsWith('/')) return fromMr;

  return null;
}

/**
 * URL of the metadata endpoint listing every file in the MR.
 *
 * Read off the page rather than constructed, so we inherit the exact
 * `diff_head` / `diff_id` / `w` / `view` params the page itself is using.
 *
 * Do NOT substitute the newer `/-/merge_requests/:iid/diff_files_metadata` route: at
 * 18.8 it is hardwired to `latest_diffs` and ignores those params, so on an older MR
 * version or a single-commit view it returns the wrong file set -- and therefore
 * `code_review_id`s that will never match anything on screen.
 */
export function getMetadataEndpoint(doc: Document, mrPath: string, search: string): string {
  return getDiffsApp(doc)?.dataset?.endpointMetadata ?? buildMetadataEndpoint(mrPath, search);
}

/**
 * Query params that select which *version* of the merge request is being viewed.
 *
 * Only these are carried over. `view` and `w` change how GitLab renders a diff but not
 * which blobs it is diffing, and `code_review_id` is
 * `SHA1("<path>-<new?>-<deleted?>-<renamed?>-<blob_id>")` — so they cannot affect the
 * ids we write. These three can: they select different blobs entirely.
 */
const VERSION_PARAMS = ['diff_id', 'start_sha', 'commit_id'] as const;

/**
 * Builds the metadata URL from the MR path, used when the diffs app element is gone.
 * Verified against a real 18.8 instance: the bare URL returns the complete file list
 * with `code_review_id` populated.
 */
export function buildMetadataEndpoint(mrPath: string, search: string): string {
  const incoming = new URLSearchParams(search);
  const carried = new URLSearchParams();
  for (const key of VERSION_PARAMS) {
    const value = incoming.get(key);
    if (value) carried.set(key, value);
  }
  const query = carried.toString();
  return `${mrPath}/diffs_metadata.json${query ? `?${query}` : ''}`;
}

/**
 * Checks the metadata payload is a complete, trustworthy picture of the MR.
 * Returns a human-readable reason to abort, or null if everything is consistent.
 *
 * GitLab drops files past `diff_max_files` (default 1000) entirely rather than
 * signalling per-file, so marking a truncated payload would silently mark a subset.
 */
export function detectIncompleteMetadata(meta: DiffsMetadata): string | null {
  if (meta.has_encoded_file_paths === true) {
    return 'This merge request contains non-UTF-8 file paths, which can make a rename indistinguishable from an edit. Mark these files manually.';
  }

  // `real_size` is always a string; a trailing "+" literally means "the collection
  // overflowed and there are at least this many".
  if (String(meta.real_size).endsWith('+')) {
    return `This merge request is too large: GitLab reported ${meta.real_size} files and truncated the list. Mark these files manually.`;
  }

  if (meta.render_overflow_warning === true) {
    return 'GitLab has truncated the file list for this merge request (overflow). Mark these files manually.';
  }

  const declared = Number.parseInt(String(meta.real_size), 10);
  const listed = meta.diff_files.length;
  if (Number.isFinite(declared) && declared !== listed) {
    return `File list looks incomplete: GitLab reported ${declared} files but returned ${listed}. Refusing to mark a partial set.`;
  }

  return null;
}

/**
 * Parses the stored array of viewed ids.
 *
 * Returns `null` when a value exists but cannot be parsed. That is deliberately
 * distinct from "no value": overwriting an unreadable value would destroy review
 * progress we cannot see, so the caller must abort rather than merge into nothing.
 */
export function parseViewedIds(raw: string | null): string[] | null {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return null;
  }
}

/**
 * Discards every viewed id for one merge request.
 *
 * Removes the key rather than writing `[]`, because that is exactly what GitLab's own
 * `autosave()` does when nothing is viewed -- so the store is left in its native empty
 * state instead of one only this extension produces.
 *
 * This is the single most destructive thing the extension can do: viewed state lives
 * nowhere but this key, so there is nothing to recover from. It must only ever be
 * reached through the twice-confirmed Unmark all flow.
 *
 * The parameter is `store`, NOT `storage`. A top-level binding called `storage`
 * anywhere in a module makes `WxtVitest()` collide with its own `wxt/utils/storage`
 * injection, and the module's v8 coverage silently collapses to zero mapped lines --
 * this file reported 2 of ~100 lines and 0 branches for exactly that reason, while
 * still passing the global 80% thresholds. Do not rename it back.
 */
export function clearViewedIds(store: Pick<Storage, 'removeItem'>, key: string): void {
  store.removeItem(key);
}

export interface MergeResult {
  ids: string[];
  /**
   * The ids this merge genuinely added -- i.e. files not already marked Viewed.
   *
   * The ids rather than a count, because the self-check stashes exactly this list and
   * then asserts every entry survived the reload. Stashing everything that matched
   * would include files that were already ticked, inflating what the next run reports.
   */
  added: string[];
}

/**
 * Unions new ids into the existing set.
 *
 * A union, never a replacement. Overwriting the array is the one genuinely
 * destructive thing this extension could do: it would wipe every file the user had
 * already ticked by hand.
 */
export function mergeViewedIds(
  existing: readonly string[],
  incoming: readonly string[],
): MergeResult {
  const ids = new Set(existing);
  const added: string[] = [];
  for (const id of incoming) {
    if (!ids.has(id)) {
      ids.add(id);
      added.push(id);
    }
  }
  return { ids: [...ids], added };
}
