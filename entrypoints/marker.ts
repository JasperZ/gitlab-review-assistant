/**
 * The marking routine, injected on demand by the background script.
 *
 * An unlisted entrypoint: WXT bundles it to `marker.js` but does not register it in
 * the manifest, so it only ever runs when `scripting.executeScript` injects it. That
 * matters -- a declarative content script would require host permissions for an
 * instance we do not know at build time.
 *
 * Why it writes localStorage and reloads rather than clicking checkboxes:
 * GitLab keeps "Viewed" entirely client-side, in `code-review-<mrPath>`, and its
 * store rewrites that whole key from memory on the next toggle. So an in-place write
 * without a reload is silently clobbered, and clicking can only ever reach the
 * handful of files the virtual scroller has mounted.
 */
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { clickMountedCheckboxes } from '@/lib/fallback';
import {
  clearViewedIds,
  getMetadataEndpoint,
  getProjectFullPath,
  mergeViewedIds,
  resolveMrPath,
  storageKeyFor,
} from '@/lib/gitlab';
import { showConfirm, showDangerConfirm, showMessage } from '@/lib/overlay';
import { planRun, serializeStash } from '@/lib/plan';
import { loadMarkingOptions, loadRules } from '@/lib/settings';
import type { DiffsMetadata } from '@/lib/types';

/** Records what the last run wrote, so the next run can verify it stuck. */
const SELF_CHECK_KEY = 'gitlab-review-assistant:last-write';

/** Guards against a second click while the overlay is already open. */
const BUSY_FLAG = '__gitlabReviewAssistantBusy';

export default defineUnlistedScript(() => {
  void main();
});

async function main(): Promise<void> {
  const scope = globalThis as Record<string, unknown>;
  if (scope[BUSY_FLAG] === true) return;
  scope[BUSY_FLAG] = true;
  try {
    await run();
  } catch (error) {
    console.error('[gitlab-review-assistant]', error);
    await showMessage(document, {
      title: 'Something went wrong',
      body: error instanceof Error ? error.message : String(error),
      tone: 'error',
    });
  } finally {
    scope[BUSY_FLAG] = false;
  }
}

async function run(): Promise<void> {
  const doc = document;

  // Deliberately does NOT require #js-diffs-app: Vue replaces that element on mount,
  // so it is absent from the live DOM. Everything needed survives elsewhere -- the MR
  // path in the URL, the project in <body>.
  const mrPath = resolveMrPath(doc, location.pathname);
  const projectFullPath = getProjectFullPath(doc);

  const [rules, markingOptions] = await Promise.all([loadRules(), loadMarkingOptions()]);

  // Only fetched once the page has yielded an MR path; otherwise there is no URL to
  // build. The placeholder never surfaces -- planRun rejects a null mrPath first.
  const metadata = mrPath
    ? await fetchMetadata(getMetadataEndpoint(doc, mrPath, location.search))
    : 'Not a merge request.';

  const plan = planRun({
    mrPath,
    projectFullPath,
    metadata,
    storedRaw: mrPath ? readViewedIds(mrPath) : null,
    // Read, not consumed. An abort below must leave the stash intact: it is evidence
    // that the last write stuck, and the aborts here are mostly transient (a failed
    // fetch, a truncated file list, the wrong page). Consuming it on one of those would
    // silently retire the self-check before it ever got a chance to report.
    stashRaw: readStash(),
    rules,
    markingOptions,
  });

  if (plan.kind === 'abort') {
    await showMessage(doc, plan.message);
    return;
  }

  // Past every abort, so the stash has been turned into `confirm.warning` and has done
  // its job. Clearing here keeps it one-shot without letting an abort eat it.
  clearStash();

  const { key, existing, matched, confirm } = plan;
  const choice = await showConfirm(doc, confirm);

  if (choice === 'cancel') return;

  if (choice === 'unmark') {
    await unmarkAll(doc, key, confirm.currentlyMarked);
    return;
  }

  if (choice === 'fallback') {
    // Tick exactly what the primary path decided on. Re-matching the globs here
    // would ignore the structural rules and tick renamed or deleted files the other
    // path deliberately skips.
    const targets = new Set(matched.map((f) => f.new_path));
    const result = clickMountedCheckboxes(doc, (path) => targets.has(path));
    await showMessage(doc, {
      title: `Ticked ${result.clicked} checkbox(es)`,
      subtitle: confirm.projectFullPath,
      body:
        `Only the ${result.mounted} file(s) GitLab had rendered could be reached — the diff ` +
        'list is virtualised, so anything off-screen was not touched. Scroll and run it again ' +
        'to cover more.',
      tone: 'warning',
    });
    return;
  }

  const { ids, added } = mergeViewedIds(
    existing,
    matched.map((f) => f.code_review_id),
  );

  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch (error) {
    // Almost certainly QuotaExceededError. Do NOT reload after a failed write: the
    // page would come back unchanged and look like the extension silently did nothing.
    await showMessage(doc, {
      title: "Couldn't save",
      body: `Writing to this site's local storage failed (${
        error instanceof Error ? error.name : 'unknown error'
      }). Nothing has been changed.`,
      tone: 'error',
    });
    return;
  }

  if (added.length > 0) {
    // Exactly what this run added, not everything it matched -- the next run checks
    // every stashed id survived, and files that were already ticked prove nothing.
    recordExpectation(key, added);
    location.reload();
  }
}

/**
 * Discards every Viewed tick for this merge request, behind a second confirmation.
 *
 * Irreversible: GitLab keeps viewed state only in this key and no history of it. The
 * confirmation is explicit that hand-ticked files go too, because they do.
 */
async function unmarkAll(doc: Document, key: string, count: number): Promise<void> {
  const confirmed = await showDangerConfirm(doc, {
    title: `Unmark all ${count} file(s)?`,
    subtitle: key,
    body:
      `This clears every Viewed tick in this merge request — all ${count} of them, ` +
      'including files you ticked yourself and files that match no rule. GitLab keeps ' +
      'no history of Viewed state, so this cannot be undone.',
    confirmLabel: `Unmark ${count} file(s)`,
  });

  if (!confirmed) return;

  try {
    clearViewedIds(localStorage, key);
  } catch (error) {
    await showMessage(doc, {
      title: "Couldn't unmark",
      body: `Clearing this site's local storage failed (${
        error instanceof Error ? error.name : 'unknown error'
      }). Nothing has been changed.`,
      tone: 'error',
    });
    return;
  }

  // Drop the stash too. It records ids we just deleted on purpose, so leaving it would
  // make the next run report them as missing -- an alarming and entirely false warning.
  clearStash();

  location.reload();
}

async function fetchMetadata(url: string): Promise<DiffsMetadata | string> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    return `Request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!response.ok) {
    return `GitLab returned ${response.status} ${response.statusText} for ${url}.`;
  }

  try {
    const body = (await response.json()) as DiffsMetadata;
    if (!Array.isArray(body?.diff_files)) {
      return 'The metadata response did not contain a file list.';
    }
    return body;
  } catch {
    return 'The metadata response was not valid JSON.';
  }
}

/** GitLab's stored viewed ids for this merge request, unparsed. */
function readViewedIds(mrPath: string): string | null {
  return localStorage.getItem(storageKeyFor(mrPath));
}

/** Stashes what we just wrote. Session-scoped, so it dies with the tab. */
function recordExpectation(key: string, ids: string[]): void {
  try {
    sessionStorage.setItem(SELF_CHECK_KEY, serializeStash({ key, ids }));
  } catch {
    // Non-fatal: we just lose the ability to self-check next time.
  }
}

/** Reads the previous run's stash, leaving it in place. */
function readStash(): string | null {
  try {
    return sessionStorage.getItem(SELF_CHECK_KEY);
  } catch {
    return null;
  }
}

/** Retires the stash once it has been reported on. Paired with `readStash`. */
function clearStash(): void {
  try {
    sessionStorage.removeItem(SELF_CHECK_KEY);
  } catch {
    // Non-fatal; worst case is the same warning again next run.
  }
}
