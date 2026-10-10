// The two halves of the wallet's viewing key, by the names every screen uses (step 4.11, D-38; the
// founder's choice of 2026-10-10). They are one key pair: the private half is made in the browser tab
// from the wallet's signature and is "unlocked" or "locked" there; the public half is registered with
// Sotto once, with another signature, and is "registered" or "not registered". No screen says
// "unlocked" of the public half or "create" of either.
export const PRIVATE_VIEWING_KEY = "Private viewing key";
export const PUBLIC_VIEWING_KEY = "Public viewing key";
export const REGISTER_PUBLIC_VIEWING_KEY = "Register public viewing key";
/** What a form says when the public half is not registered, and why it matters there. */
export const PUBLIC_VIEWING_KEY_MISSING = "Your public viewing key is not registered yet.";
