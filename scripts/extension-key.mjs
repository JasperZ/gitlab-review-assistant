/**
 * Reads the extension's signing key and derives what Chrome needs from it.
 *
 * `key.pem` is gitignored and is the single source of truth for the extension's identity.
 * The public half is derived here at build time rather than being committed, so no key
 * material of any kind lives in version control.
 *
 * The trade that comes with that: a checkout without `key.pem` cannot produce a build with
 * the right extension ID. `assertKeyPresent()` exists so the moment that matters -- cutting
 * a zip for other people -- fails loudly instead of silently shipping a different ID.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const KEY_PATH = join(root, 'key.pem');

/**
 * The base64 SPKI DER public key, i.e. exactly what goes in `manifest.key`.
 * Returns undefined when `key.pem` is absent, so a fresh clone can still install and run
 * the test suite.
 *
 * Byte-identical to `openssl rsa -in key.pem -pubout -outform DER | base64`.
 */
export function readPublicKey() {
  if (!existsSync(KEY_PATH)) return undefined;
  const pem = readFileSync(KEY_PATH, 'utf8');
  return createPublicKey(pem).export({ format: 'der', type: 'spki' }).toString('base64');
}

/**
 * The extension ID Chrome derives from a public key: SHA-256, first 16 bytes, with each hex
 * digit 0-f remapped onto a-p. (That remap is why extension IDs are 32 letters, no digits.)
 */
export function extensionIdFor(publicKey) {
  const digest = createHash('sha256')
    .update(Buffer.from(publicKey, 'base64'))
    .digest('hex')
    .slice(0, 32);
  return [...digest].map((c) => String.fromCharCode(parseInt(c, 16) + 0x61)).join('');
}

/** Hard failure for the paths where a wrong ID would reach other people. */
export function assertKeyPresent() {
  const publicKey = readPublicKey();
  if (publicKey) return publicKey;

  console.error(`
Missing ${KEY_PATH}

This file pins the extension ID. Without it the ID is derived from the install path, so
every machine gets a different one -- and because chrome.storage is scoped to the ID,
anyone installing this build would start with empty settings and lose them again on the
next build.

Restore key.pem from wherever you archived it. Generating a new one also works, but it
produces a DIFFERENT extension ID and resets the stored settings of everyone already
running it.

    openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem
`);
  process.exit(1);
}
