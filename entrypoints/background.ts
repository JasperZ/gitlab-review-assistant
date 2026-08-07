/**
 * Injects the marking routine into the active tab when the toolbar icon is clicked.
 *
 * The click is what makes this work without host permissions: `activeTab` grants
 * temporary access to the current tab on a qualifying user gesture, which is enough
 * for `scripting.executeScript`. That is why there is no popup -- Chrome does not
 * fire `action.onClicked` when a `default_popup` is set.
 *
 * Nothing is cached in module scope: an MV3 service worker is torn down after ~30s
 * idle and any globals go with it.
 */
import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';

/** Build output path of the unlisted `marker` entrypoint. */
const MARKER_SCRIPT = '/marker.js';

const BADGE_CLEAR_MS = 4000;

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    void run(tab);
  });
});

async function run(tab: { id?: number }): Promise<void> {
  if (tab.id == null) return;

  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: [MARKER_SCRIPT],
    });
  } catch (error) {
    // Most commonly: the user clicked on a chrome:// page, the Web Store, or a PDF
    // viewer, where no extension may inject. Say so on the badge rather than failing
    // invisibly -- there is no page we are allowed to draw an overlay on.
    console.error('[gitlab-review-assistant] injection failed', error);
    await flashBadge(tab.id, '!', '#dc2626');
  }
}

async function flashBadge(tabId: number, text: string, color: string): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ tabId, color });
    await browser.action.setBadgeText({ tabId, text });
    setTimeout(() => {
      void browser.action.setBadgeText({ tabId, text: '' });
    }, BADGE_CLEAR_MS);
  } catch {
    // Tab closed between the failure and the badge write. Nothing to report to.
  }
}
