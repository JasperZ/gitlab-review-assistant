/**
 * Guard for `npm run zip` (npm runs this automatically as `prezip`).
 *
 * A zip is the artifact that reaches other people, so this is the one moment where a
 * missing key.pem must be a hard failure rather than a warning: shipping a build with no
 * pinned ID means every recipient gets a different extension identity, and their settings
 * vanish on the next update.
 */
import { assertKeyPresent, extensionIdFor } from './extension-key.mjs';

console.log(`Packaging with extension ID ${extensionIdFor(assertKeyPresent())}`);
