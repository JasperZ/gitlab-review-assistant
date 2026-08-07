/**
 * Last-resort path: tick the checkboxes GitLab has actually rendered.
 *
 * This is deliberately partial. The classic diff view runs through
 * `vue-virtual-scroller`, so files outside the viewport are not in the DOM at all --
 * and neither is the file-tree sidebar, which is virtualised too. This reaches only
 * what is currently mounted.
 *
 * Its job is to degrade visibly when the localStorage contract breaks, not to be
 * complete. The caller must report how much it actually covered.
 */

/**
 * Stable since GitLab v13.9 and unchanged through master -- roughly 5.5 years.
 * Never select by CSS class here: the wrapper classes churn every few releases and
 * the checkbox `id` generator has changed three times.
 */
export const VIEWED_CHECKBOX_SELECTOR = 'input[data-testid="fileReviewCheckbox"]';

export const DIFF_FILE_SELECTOR = '.diff-file';

export interface FallbackResult {
  /** Checkboxes actually clicked. */
  clicked: number;
  /** Mounted files whose path matched but were already ticked. */
  alreadyChecked: number;
  /** Mounted files we could not read a path for. */
  unknownPath: number;
  /** Total checkboxes found in the DOM -- the ceiling on what this can ever do. */
  mounted: number;
}

/**
 * Ticks every mounted checkbox whose file path satisfies `shouldMark`.
 *
 * Iterates bottom-to-top: marking a file Viewed makes GitLab collapse it, which
 * shifts everything below it. Going upwards means each click only moves content we
 * have already passed.
 */
export function clickMountedCheckboxes(
  doc: Document,
  shouldMark: (path: string) => boolean,
): FallbackResult {
  const checkboxes = [...doc.querySelectorAll<HTMLInputElement>(VIEWED_CHECKBOX_SELECTOR)];
  const result: FallbackResult = {
    clicked: 0,
    alreadyChecked: 0,
    unknownPath: 0,
    mounted: checkboxes.length,
  };

  for (const checkbox of checkboxes.reverse()) {
    if (checkbox.disabled) continue;

    const path = checkbox.closest<HTMLElement>(DIFF_FILE_SELECTOR)?.dataset?.path;
    if (!path) {
      result.unknownPath += 1;
      continue;
    }

    if (!shouldMark(path)) continue;

    // .click() TOGGLES. Without this guard we would untick files the user had
    // already reviewed -- the exact opposite of what the extension is for.
    if (checkbox.checked) {
      result.alreadyChecked += 1;
      continue;
    }

    checkbox.click();
    result.clicked += 1;
  }

  return result;
}
