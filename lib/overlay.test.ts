import { afterEach, describe, expect, it } from 'vitest';
import { showConfirm, showDangerConfirm, showMessage } from './overlay';
import type { ConfirmOptions, DiffFile, MessageOptions } from './types';

const HOST_ID = 'gitlab-review-assistant-overlay';

function shadow(): ShadowRoot {
  const host = document.getElementById(HOST_ID);
  if (!host?.shadowRoot) throw new Error('overlay not mounted');
  return host.shadowRoot;
}

const buttons = () => [...shadow().querySelectorAll('button')];

function buttonMatching(text: RegExp): HTMLButtonElement {
  const found = buttons().find((b) => text.test(b.textContent ?? ''));
  if (!found) {
    throw new Error(
      `no button matching ${text}; saw: ${buttons()
        .map((b) => b.textContent)
        .join(' | ')}`,
    );
  }
  return found;
}

/** The overlay's whole text, for asserting on rendered copy without pinning markup. */
const text = () => shadow().textContent ?? '';

const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key }));

function file(newPath: string): DiffFile {
  return {
    added_lines: 1,
    removed_lines: 0,
    new_path: newPath,
    old_path: newPath,
    new_file: false,
    deleted_file: false,
    submodule: false,
    file_identifier_hash: `fih-${newPath}`,
    file_hash: `fh-${newPath}`,
    code_review_id: `crid-${newPath}`,
    conflict_type: null,
  };
}

const confirmOptions = (overrides: Partial<ConfirmOptions> = {}): ConfirmOptions => ({
  matched: [file('charts/a/templates/x.yaml')],
  alreadyViewed: 0,
  totalFiles: 10,
  skippedCounts: {},
  projectFullPath: 'group/project',
  activeRuleCount: 1,
  currentlyMarked: 0,
  ...overrides,
});

const messageOptions = (overrides: Partial<MessageOptions> = {}): MessageOptions => ({
  title: 'Not a merge request',
  body: 'Open a GitLab merge request and try again.',
  tone: 'warning',
  ...overrides,
});

afterEach(() => {
  document.getElementById(HOST_ID)?.remove();
});

describe('dismissal', () => {
  // Every dialog shares one scaffold, so each of these is really a test of that.
  it('closes showConfirm on Escape', async () => {
    const choice = showConfirm(document, confirmOptions());
    press('Escape');
    await expect(choice).resolves.toBe('cancel');
  });

  it('closes on Escape even after another key has been pressed', async () => {
    // The regression: registering the handler with { once: true } unbinds it on the
    // first key of ANY kind. The card holds several buttons, so a single Tab is enough
    // to silently disable Escape for the rest of the dialog's life.
    const choice = showConfirm(document, confirmOptions());
    press('Tab');
    press('a');
    press('Shift');
    press('Escape');
    await expect(choice).resolves.toBe('cancel');
  });

  it('closes on a backdrop click but not a click inside the card', async () => {
    const choice = showConfirm(document, confirmOptions());
    shadow().querySelector<HTMLElement>('.card')?.click();
    expect(document.getElementById(HOST_ID)).not.toBeNull();

    shadow().querySelector<HTMLElement>('.backdrop')?.click();
    await expect(choice).resolves.toBe('cancel');
  });

  it('leaves nothing behind once resolved, so the next run mounts cleanly', async () => {
    const first = showConfirm(document, confirmOptions());
    press('Escape');
    await first;
    expect(document.getElementById(HOST_ID)).toBeNull();

    // A second dialog must answer its own Escape, not one left bound by the first.
    const second = showMessage(document, messageOptions());
    press('Escape');
    await expect(second).resolves.toBeUndefined();
  });
});

describe('showConfirm — summary', () => {
  it('lists matches grouped by directory', () => {
    void showConfirm(
      document,
      confirmOptions({
        matched: [file('charts/a/templates/x.yaml'), file('charts/a/templates/y.yaml')],
      }),
    );
    expect(text()).toContain('charts/a/templates');
    expect(text()).toContain('x.yaml');
    expect(text()).toContain('y.yaml');
  });

  it('says no rule applies when none is in scope', () => {
    void showConfirm(document, confirmOptions({ matched: [], activeRuleCount: 0 }));
    expect(text()).toMatch(/No configured rule applies/i);
  });

  it('distinguishes "no rule applies" from "rules applied but matched nothing"', () => {
    void showConfirm(document, confirmOptions({ matched: [], activeRuleCount: 2 }));
    expect(text()).toMatch(/No files in this merge request match/i);
  });

  it('reports already-viewed matches as a separate row', () => {
    void showConfirm(
      document,
      confirmOptions({
        matched: [file('a.yaml'), file('b.yaml')],
        alreadyViewed: 1,
      }),
    );
    expect(text()).toContain('Already Viewed');
  });

  it('labels every skip reason in human terms rather than its slug', () => {
    void showConfirm(
      document,
      confirmOptions({
        skippedCounts: {
          deleted: 2,
          renamed: 1,
          submodule: 3,
          new: 4,
          'no-checkbox': 5,
          'no-pattern-match': 6,
        },
      }),
    );
    const rendered = text();
    for (const label of [
      'deleted',
      'renamed or moved',
      'submodules',
      'newly added',
      'no Viewed checkbox in GitLab',
      "didn't match any rule",
    ]) {
      expect(rendered).toContain(label);
    }
    // The slugs themselves must never reach the user.
    expect(rendered).not.toContain('no-pattern-match');
    expect(rendered).not.toContain('no-checkbox');
  });

  it('omits reasons with a zero count', () => {
    void showConfirm(document, confirmOptions({ skippedCounts: { deleted: 0, renamed: 2 } }));
    expect(text()).toContain('renamed or moved');
    expect(text()).not.toContain('Skipped — deleted');
  });

  it('disables the primary action and focuses Cancel when there is nothing to do', () => {
    void showConfirm(document, confirmOptions({ matched: [file('a.yaml')], alreadyViewed: 1 }));
    const confirm = buttonMatching(/Nothing to do/);
    expect(confirm.disabled).toBe(true);
    expect(shadow().activeElement?.textContent).toBe('Cancel');
  });
});

describe('showConfirm — the DOM fallback escape hatch', () => {
  it('is offered only when the self-check has warned', () => {
    void showConfirm(document, confirmOptions({ warning: null }));
    expect(buttons().some((b) => /Tick checkboxes directly/.test(b.textContent ?? ''))).toBe(false);
  });

  it('appears alongside the warning that justifies it', () => {
    void showConfirm(document, confirmOptions({ warning: 'Previous run did not stick.' }));
    expect(text()).toContain('Previous run did not stick.');
    expect(buttonMatching(/Tick checkboxes directly/)).toBeTruthy();
  });

  it('resolves with "fallback" when pressed', async () => {
    const choice = showConfirm(document, confirmOptions({ warning: 'Something is off.' }));
    buttonMatching(/Tick checkboxes directly/).click();
    await expect(choice).resolves.toBe('fallback');
  });
});

describe('showConfirm — Unmark all', () => {
  it('is hidden when nothing is marked, so it can never be a no-op', () => {
    void showConfirm(document, confirmOptions({ currentlyMarked: 0 }));
    expect(buttons().some((b) => /Unmark/.test(b.textContent ?? ''))).toBe(false);
  });

  it('appears with the count once something is marked', () => {
    void showConfirm(document, confirmOptions({ currentlyMarked: 37 }));
    expect(buttonMatching(/Unmark all/).textContent).toContain('37');
  });

  it('resolves with "unmark" when pressed', async () => {
    const choice = showConfirm(document, confirmOptions({ currentlyMarked: 3 }));
    buttonMatching(/Unmark all/).click();
    await expect(choice).resolves.toBe('unmark');
  });

  it('still resolves "confirm" for the normal path', async () => {
    const choice = showConfirm(document, confirmOptions({ currentlyMarked: 3 }));
    buttonMatching(/Mark 1 file/).click();
    await expect(choice).resolves.toBe('confirm');
  });
});

describe('showMessage', () => {
  // The terminal surface for every abort in planRun, plus the fallback report and the
  // quota-failure notice -- i.e. everything the user sees when a run does not proceed.
  it('renders the title and body it was given', () => {
    void showMessage(document, messageOptions());
    expect(text()).toContain('Not a merge request');
    expect(text()).toContain('Open a GitLab merge request and try again.');
  });

  it('renders the subtitle when there is one', () => {
    void showMessage(document, messageOptions({ subtitle: 'group/project' }));
    expect(text()).toContain('group/project');
  });

  it('marks an error tone differently from a warning', () => {
    void showMessage(document, messageOptions({ tone: 'error' }));
    expect(shadow().querySelector('.warning.error')).not.toBeNull();

    document.getElementById(HOST_ID)?.remove();

    void showMessage(document, messageOptions({ tone: 'warning' }));
    expect(shadow().querySelector('.warning')).not.toBeNull();
    expect(shadow().querySelector('.warning.error')).toBeNull();
  });

  it('offers exactly one action', () => {
    void showMessage(document, messageOptions());
    expect(buttons()).toHaveLength(1);
    expect(buttonMatching(/^Close$/)).toBeTruthy();
  });

  it('resolves and tears down when closed', async () => {
    const done = showMessage(document, messageOptions());
    buttonMatching(/^Close$/).click();
    await expect(done).resolves.toBeUndefined();
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it('resolves on Escape too, so it can never trap the page', async () => {
    const done = showMessage(document, messageOptions());
    press('Escape');
    await expect(done).resolves.toBeUndefined();
  });
});

describe('showDangerConfirm', () => {
  const options = {
    title: 'Unmark all 5 file(s)?',
    body: 'This cannot be undone.',
    confirmLabel: 'Unmark 5 file(s)',
  };

  it('resolves true only via the destructive button', async () => {
    const result = showDangerConfirm(document, options);
    buttonMatching(/^Unmark 5 file/).click();
    await expect(result).resolves.toBe(true);
  });

  it('resolves false on Cancel', async () => {
    const result = showDangerConfirm(document, options);
    buttonMatching(/^Cancel$/).click();
    await expect(result).resolves.toBe(false);
  });

  it('resolves false on Escape', async () => {
    const result = showDangerConfirm(document, options);
    press('Escape');
    await expect(result).resolves.toBe(false);
  });

  it('resolves false on Escape after the user has tabbed between the buttons', async () => {
    const result = showDangerConfirm(document, options);
    press('Tab');
    press('Escape');
    await expect(result).resolves.toBe(false);
  });

  it('focuses Cancel, not the destructive button', async () => {
    // Enter pressed out of habit after the first dialog must not confirm the second.
    const result = showDangerConfirm(document, options);
    expect(shadow().activeElement?.textContent).toBe('Cancel');
    buttonMatching(/^Cancel$/).click();
    await result;
  });

  it('tears the overlay down after a decision', async () => {
    const result = showDangerConfirm(document, options);
    buttonMatching(/^Cancel$/).click();
    await result;
    expect(document.getElementById(HOST_ID)).toBeNull();
  });
});
