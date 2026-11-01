# Apple token-exchange incident

The user reported that completing Apple web sign-in returns a generic failure and that the Xcode iPhone simulator's Apple button does not open a sheet. Per the user's latest instruction, server diagnosis takes priority.

## Confirmed server evidence

- Auth logs at 18:25:18 and 18:26:16 UTC on 1 November show Apple's `invalid_client` during the external OAuth exchange.
- The configured client list is `com.picktennt.web,Idddeas.Picktennt`, matching the documented web-first/native-audience configuration.
- The observed web failures occur before account linking. A same-email Google account is not the indicated cause of these particular failures.
- Google's PKCE and email/password logins returned successful responses in the same window.
- The management API protects provider secrets with HMAC digests (confirmed in the official Supabase CLI config comparison source). The digest cannot validate the stored JWT's structure or claims; it must not be mistaken for malformed input. No Apple secret/private key was printed, stored or read from the private Mac files.

Apple's `invalid_client` identifies a client credential/configuration rejection; it does not by itself distinguish an incorrect secret from a signature/key registration, claim, expiry or related configuration problem. Opening Apple's login page only validated authorization entry, not the token exchange.

## Concrete private credential repair

`scripts/auth/repair-apple-client-secret.mjs` is a Mac-only helper for the existing private key. It creates a fresh web client JWT with the ticket's Team ID, Key ID and Services ID, uses Apple's HTTPS server time, signs ES256 in the required JOSE/P1363 format, verifies the signature locally and copies the JWT directly to the Mac clipboard. It never prints the token, writes a token file, uploads the private key, or sends the JWT anywhere. No dependency installation is required.

1. Put the helper in the Mac Downloads folder alongside the existing private `AuthKey_8MM4XQSN7L.p8`.
2. Run `node ~/Downloads/repair-apple-client-secret.mjs` (or supply the private key path as the sole optional argument).
3. Paste the clipboard only into the existing Supabase Apple provider's Secret Key field and save. Keep the two Client IDs unchanged.

The user requested that the private credential stay on the Mac/in Supabase. That private signing step cannot be performed from this Windows workspace without access to that private key, so the provider credential has not been changed by the agent. A valid fresh signature also requires that the specified Apple key is active and associated with the configured Services ID. Verify a completed real sign-in after replacement; do not declare the server recovered from a provider-page check alone.

Validation: all 15 auth tests passed, including correct claims/expiry, independent ES256 verification, raw 64-byte signature format, and rejection of invalid key types/signing times. Scoped ESLint passed. The actual user's key and Mac clipboard were not accessed.

## Simulator observation

No native `id_token` attempt was observed in the inspected recent auth window. A button that never opens Apple's system sheet can fail before reaching Supabase. The available iOS Git branches do not contain the current simulator authentication implementation; no speculative iOS changes or provider audience removals were made. The simulator investigation remains separate until server credential recovery is complete, as requested by the user.
