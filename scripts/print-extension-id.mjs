/**
 * Prints the extension ID that key.pem produces.
 *
 *   npm run id
 *
 * Lets the expected ID be checked without loading the extension, which is what makes the
 * "same ID from two different folders" verification quick.
 */
import { assertKeyPresent, extensionIdFor } from './extension-key.mjs';

console.log(extensionIdFor(assertKeyPresent()));
