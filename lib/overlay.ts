/**
 * The confirmation overlay.
 *
 * On the merge-request page this is the extension's only user-facing surface, and it
 * has to render *before* the reload: `activeTab` is revoked on navigation, so nothing
 * can be injected afterwards to report what happened. `showDangerConfirm` is also
 * reused by the options page, which has neither a reload nor an injection to race.
 *
 * Rendered into a shadow root so GitLab's stylesheets cannot reach in and ours
 * cannot leak out.
 */
import { groupByDirectory } from './filter';
import type { ConfirmOptions, MessageOptions, SkipReason } from './types';

const HOST_ID = 'gitlab-review-assistant-overlay';

export type ConfirmChoice = 'confirm' | 'cancel' | 'fallback' | 'unmark';

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .backdrop {
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(15, 23, 42, 0.55);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.5;
  }
  .card {
    background: #ffffff; color: #1f2937;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0,0,0,.35);
    width: min(680px, 100%);
    max-height: min(80vh, 720px);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  header { padding: 18px 22px 12px; border-bottom: 1px solid #e5e7eb; }
  h1 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  .subtle { color: #6b7280; font-size: 13px; }
  .body { padding: 14px 22px; overflow-y: auto; flex: 1 1 auto; }
  footer {
    padding: 14px 22px; border-top: 1px solid #e5e7eb;
    display: flex; gap: 10px; justify-content: flex-end; align-items: center;
    flex-wrap: wrap;
  }
  button {
    font: inherit; padding: 7px 14px; border-radius: 6px;
    border: 1px solid #d1d5db; background: #fff; color: #1f2937; cursor: pointer;
  }
  button:hover { background: #f9fafb; }
  button.primary { background: #1f75cb; border-color: #1f75cb; color: #fff; }
  button.primary:hover { background: #1a63ac; }
  button.primary:disabled { background: #9ca3af; border-color: #9ca3af; cursor: not-allowed; }
  button.link { border: none; background: none; color: #1f75cb; text-decoration: underline; padding: 7px 4px; }
  button.link.danger { color: #b91c1c; }
  button.danger-action { background: #b91c1c; border-color: #b91c1c; color: #fff; }
  button.danger-action:hover { background: #991b1b; }
  .spacer { flex: 1 1 auto; }
  details { margin: 0 0 6px; border: 1px solid #e5e7eb; border-radius: 6px; }
  summary {
    cursor: pointer; padding: 7px 10px; font-weight: 500;
    display: flex; justify-content: space-between; gap: 12px;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: #f9fafb; }
  .count { color: #6b7280; font-weight: 400; font-variant-numeric: tabular-nums; }
  ul { margin: 0; padding: 2px 10px 10px 26px; }
  li { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; word-break: break-all; }
  .warning {
    background: #fef3c7; border: 1px solid #fcd34d; color: #78350f;
    padding: 10px 12px; border-radius: 6px; margin-bottom: 12px;
  }
  .error { background: #fee2e2; border-color: #fca5a5; color: #7f1d1d; }
  .empty { color: #6b7280; padding: 8px 0; }
  dl { display: grid; grid-template-columns: auto auto; gap: 2px 10px; margin: 12px 0 0; font-size: 13px; color: #6b7280; }
  dt { grid-column: 1; }
  dd { grid-column: 2; margin: 0; font-variant-numeric: tabular-nums; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; }
  @media (prefers-color-scheme: dark) {
    .card { background: #1f2937; color: #f3f4f6; }
    header, footer { border-color: #374151; }
    .subtle, .count, .empty, dl { color: #9ca3af; }
    button { background: #374151; border-color: #4b5563; color: #f3f4f6; }
    button:hover { background: #4b5563; }
    button.link { background: none; color: #93c5fd; }
    button.link.danger { color: #fca5a5; }
    button.danger-action { background: #b91c1c; border-color: #b91c1c; color: #fff; }
    details { border-color: #374151; }
    summary:hover { background: #374151; }
    .warning { background: #422006; border-color: #92400e; color: #fde68a; }
    .error { background: #450a0a; border-color: #991b1b; color: #fecaca; }
    code { background: #374151; }
  }
`;

/**
 * Every skip reason needs a label. Typed `Record<SkipReason, string>` rather than
 * `Record<string, string>` so adding a reason without a label fails to compile instead
 * of shipping the raw slug into the summary. Iteration order here is also the display
 * order, which is why it is a literal and not built from the counts.
 */
const SKIP_LABELS: Record<SkipReason, string> = {
  deleted: 'deleted',
  renamed: 'renamed or moved',
  submodule: 'submodules',
  new: 'newly added',
  'no-checkbox': 'no Viewed checkbox in GitLab',
  'no-pattern-match': "didn't match any rule",
};

const SKIP_ORDER = Object.keys(SKIP_LABELS) as SkipReason[];

function mount(doc: Document): { root: ShadowRoot; destroy: () => void; signal: AbortSignal } {
  doc.getElementById(HOST_ID)?.remove();

  const host = doc.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = STYLES;
  root.append(style);

  doc.body.append(host);

  // Listeners registered with this signal are torn down by destroy(), whichever way the
  // dialog was dismissed. The Escape handler is on the *document*, so removing the host
  // does not unbind it; left behind, it would keep firing a dead close callback and
  // stack up one listener per dialog shown.
  const controller = new AbortController();
  return {
    root,
    signal: controller.signal,
    destroy: () => {
      controller.abort();
      host.remove();
    },
  };
}

/** Wraps content in the backdrop/card chrome and wires Escape to `onEscape`. */
function scaffold(
  doc: Document,
  root: ShadowRoot,
  title: string,
  subtitle: string,
  onEscape: () => void,
  signal: AbortSignal,
): { body: HTMLElement; footer: HTMLElement } {
  const backdrop = doc.createElement('div');
  backdrop.className = 'backdrop';

  const card = doc.createElement('div');
  card.className = 'card';

  const header = doc.createElement('header');
  const h1 = doc.createElement('h1');
  h1.textContent = title;
  const sub = doc.createElement('div');
  sub.className = 'subtle';
  sub.textContent = subtitle;
  header.append(h1, sub);

  const body = doc.createElement('div');
  body.className = 'body';

  const footer = doc.createElement('footer');

  card.append(header, body, footer);
  backdrop.append(card);
  root.append(backdrop);

  backdrop.addEventListener(
    'click',
    (event) => {
      if (event.target === backdrop) onEscape();
    },
    { signal },
  );
  // NOT `{ once: true }`: that unbinds on the first key of any kind, so a single Tab --
  // likely, since the card holds several buttons -- would silently disable Escape for
  // the rest of the dialog's life. The signal is what unbinds it.
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') onEscape();
    },
    { signal },
  );

  return { body, footer };
}

function addWarning(doc: Document, body: HTMLElement, text: string, tone: 'warning' | 'error') {
  const el = doc.createElement('div');
  el.className = tone === 'error' ? 'warning error' : 'warning';
  el.textContent = text;
  body.append(el);
}

/**
 * Asks the user to confirm. Resolves with their choice; never rejects.
 *
 * Matches are grouped by directory and collapsed, so a 400-file result stays a
 * usable confirmation step rather than a wall of rows.
 */
export function showConfirm(doc: Document, options: ConfirmOptions): Promise<ConfirmChoice> {
  return new Promise((resolve) => {
    const { root, destroy, signal } = mount(doc);
    const finish = (choice: ConfirmChoice) => {
      destroy();
      resolve(choice);
    };

    const toMark = options.matched.length - options.alreadyViewed;
    const { body, footer } = scaffold(
      doc,
      root,
      'Mark templated files as Viewed',
      `${options.projectFullPath} · ${options.totalFiles} files changed · ${options.activeRuleCount} rule(s) apply`,
      () => finish('cancel'),
      signal,
    );

    if (options.warning) addWarning(doc, body, options.warning, 'warning');

    if (options.matched.length === 0) {
      const empty = doc.createElement('p');
      empty.className = 'empty';
      empty.textContent =
        options.activeRuleCount === 0
          ? 'No configured rule applies to this project. Open the options page to add one.'
          : 'No files in this merge request match your rules.';
      body.append(empty);
    } else {
      for (const group of groupByDirectory(options.matched)) {
        const details = doc.createElement('details');
        const summary = doc.createElement('summary');

        const name = doc.createElement('span');
        name.textContent = group.directory;
        const count = doc.createElement('span');
        count.className = 'count';
        count.textContent = String(group.files.length);
        summary.append(name, count);

        const list = doc.createElement('ul');
        for (const file of group.files) {
          const li = doc.createElement('li');
          li.textContent = file;
          list.append(li);
        }

        details.append(summary, list);
        body.append(details);
      }
    }

    const stats = doc.createElement('dl');
    const rows: Array<[string, string]> = [['Will be marked Viewed', String(toMark)]];
    if (options.alreadyViewed > 0) {
      rows.push(['Already Viewed (no change)', String(options.alreadyViewed)]);
    }
    for (const reason of SKIP_ORDER) {
      const n = options.skippedCounts[reason] ?? 0;
      if (n > 0) rows.push([`Skipped — ${SKIP_LABELS[reason]}`, String(n)]);
    }
    for (const [label, value] of rows) {
      const dt = doc.createElement('dt');
      dt.textContent = label;
      const dd = doc.createElement('dd');
      dd.textContent = value;
      stats.append(dt, dd);
    }
    body.append(stats);

    const note = doc.createElement('div');
    note.className = 'subtle';
    note.style.marginTop = '12px';
    note.textContent = 'The page will reload so GitLab picks up the change.';
    body.append(note);

    if (options.warning) {
      const fallbackBtn = doc.createElement('button');
      fallbackBtn.className = 'link';
      fallbackBtn.textContent = 'Tick checkboxes directly instead';
      fallbackBtn.addEventListener('click', () => finish('fallback'));
      footer.append(fallbackBtn);
    }

    // Only offered when there is something to undo, so it can never be a no-op.
    // Ellipsis signals that a further confirmation follows.
    if (options.currentlyMarked > 0) {
      const unmarkBtn = doc.createElement('button');
      unmarkBtn.className = 'link danger';
      unmarkBtn.textContent = `Unmark all ${options.currentlyMarked} file(s)…`;
      unmarkBtn.addEventListener('click', () => finish('unmark'));
      footer.append(unmarkBtn);
    }

    const spacer = doc.createElement('div');
    spacer.className = 'spacer';
    footer.append(spacer);

    const cancel = doc.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => finish('cancel'));

    const confirm = doc.createElement('button');
    confirm.className = 'primary';
    confirm.textContent = toMark > 0 ? `Mark ${toMark} file(s) Viewed` : 'Nothing to do';
    confirm.disabled = toMark === 0;
    confirm.addEventListener('click', () => finish('confirm'));

    footer.append(cancel, confirm);
    (confirm.disabled ? cancel : confirm).focus();
  });
}

/**
 * The second gate in front of an irreversible action.
 *
 * Resolves true ONLY when the destructive button is pressed. Cancel, Escape and a
 * backdrop click all resolve false, and Cancel holds focus — the dangerous path must
 * never be the one that happens by reflex, and pressing Enter out of habit after the
 * first dialog must not confirm the second.
 */
export function showDangerConfirm(
  doc: Document,
  options: { title: string; subtitle?: string; body: string; confirmLabel: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    const { root, destroy, signal } = mount(doc);
    const finish = (confirmed: boolean) => {
      destroy();
      resolve(confirmed);
    };

    const { body, footer } = scaffold(
      doc,
      root,
      options.title,
      options.subtitle ?? '',
      () => finish(false),
      signal,
    );
    addWarning(doc, body, options.body, 'error');

    const spacer = doc.createElement('div');
    spacer.className = 'spacer';

    const cancel = doc.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => finish(false));

    const confirm = doc.createElement('button');
    confirm.className = 'danger-action';
    confirm.textContent = options.confirmLabel;
    confirm.addEventListener('click', () => finish(true));

    footer.append(spacer, cancel, confirm);
    cancel.focus();
  });
}

/** A terminal message with a single dismiss button. Used for aborts and errors. */
export function showMessage(doc: Document, options: MessageOptions): Promise<void> {
  return new Promise((resolve) => {
    const { root, destroy, signal } = mount(doc);
    const finish = () => {
      destroy();
      resolve();
    };

    const { body, footer } = scaffold(
      doc,
      root,
      options.title,
      options.subtitle ?? '',
      finish,
      signal,
    );
    addWarning(doc, body, options.body, options.tone);

    const spacer = doc.createElement('div');
    spacer.className = 'spacer';
    const close = doc.createElement('button');
    close.className = 'primary';
    close.textContent = 'Close';
    close.addEventListener('click', finish);
    footer.append(spacer, close);
    close.focus();
  });
}
