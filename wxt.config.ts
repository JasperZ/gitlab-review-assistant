import { defineConfig } from 'wxt';
import { readPublicKey } from './scripts/extension-key.mjs';

const publicKey = readPublicKey();
if (!publicKey) {
  console.warn(
    '[wxt.config] key.pem not found -- building without a pinned extension ID. ' +
      'Fine for local work; `npm run zip` will refuse to package like this.',
  );
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Pinned explicitly. MV3 is already the Chrome default, but WXT still defaults
  // Firefox to MV2, and under Firefox MV2 a content-script fetch runs in the
  // extension's context rather than the page's -- which would silently drop the
  // GitLab session cookie. Pinning it now removes that trap if Firefox is ever added.
  manifestVersion: 3,

  // Auto-imports off: every symbol is imported explicitly so the code stays greppable.
  imports: false,

  manifest: {
    name: 'GitLab Review Assistant',
    description:
      'Marks templated files as Viewed in GitLab merge requests, based on glob patterns you configure.',

    // No host permissions. The GitLab instance is user-configurable and therefore
    // unknown at build time, so a static content_scripts block is impossible.
    // Because the trigger is a toolbar click, activeTab grants exactly what we need
    // for scripting.executeScript -- with no install-time warning.
    permissions: ['activeTab', 'scripting', 'storage'],

    // Empty action = toolbar icon with no popup, so action.onClicked fires.
    // (Chrome will not fire onClicked if a default_popup is set.)
    action: {},

    // Pins the extension ID. Without this, an unpacked extension's ID is derived from
    // its absolute folder path -- so every colleague gets a different ID, and moving or
    // re-extracting the folder makes Chrome treat it as a brand new extension and
    // DISCARD their stored patterns, since chrome.storage is scoped to the ID.
    //
    // Derived from ./key.pem at build time rather than committed, so no key material of
    // any kind is in git. `npm run id` prints the resulting ID; `npm run zip` refuses to
    // build without it. Absent key.pem, the build still works -- it just has no pinned ID.
    ...(publicKey ? { key: publicKey } : {}),
  },
});
