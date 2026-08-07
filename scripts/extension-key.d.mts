/**
 * Types for extension-key.mjs.
 *
 * The module stays plain JavaScript because `scripts/*.mjs` are executed directly by node
 * (via npm scripts) with no build step, while `wxt.config.ts` imports it and is
 * typechecked. This declaration bridges the two.
 */

/** Path to the gitignored private key that pins the extension identity. */
export declare const KEY_PATH: string;

/**
 * Base64 SPKI DER public key for `manifest.key`, or undefined when key.pem is absent.
 * Byte-identical to `openssl rsa -in key.pem -pubout -outform DER | base64`.
 */
export declare function readPublicKey(): string | undefined;

/** The extension ID Chrome derives from a base64 public key. */
export declare function extensionIdFor(publicKey: string): string;

/** Returns the public key, or prints an explanation and exits non-zero. */
export declare function assertKeyPresent(): string;
