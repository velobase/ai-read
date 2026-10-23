# Native account connection

Profile offers Continue with Google directly. The iOS system authentication sheet opens the official service and starts Google OAuth without a second provider-selection click. Web and iOS share the same account. The original sign-in grants access to that account's AI configuration. A separate library authorization now connects an isolated account library and syncs books, reading progress, notes and bookmarks. Neither sign-in nor library authorization automatically uploads the device library.

The App starts with the existing device library. The account screen offers explicit library authorization/opening and a return to device storage. Account databases and attachments are scoped by canonical server origin plus stable user ID; the device database is preserved. This is implemented functionality, with real account authorization, sync round trips and multi-account switching still awaiting runtime verification. The [native sync design](native-sync-design.md) details the storage, outbox, recovery and verification boundaries.

## Protocol and storage

- The native module creates a fresh 32-byte verifier and state using the system random generator. The authorization page receives only the S256 challenge and state. Google/Auth.js handles the existing Web login.
- `/mobile/authorize` presents the account, server origin and AI-only scope. Loading the page never creates a grant. A GET obtains a five-minute HMAC consent nonce bound to the Web session, issuer, challenge, state and fixed callback. Explicit POST confirmation verifies all of those again. The separate `/mobile/library/authorize` page uses the v2 authorize endpoint and an additional signature domain bound to the fixed library profile and permissions; an AI-only nonce cannot authorize that profile.
- The server stores the random authorization code as a hash, along with its challenge, state hash, origin, user and parent Web session. Exchange validates PKCE and atomically consumes the code before creating a mobile session. Codes expire in five minutes.
- Only `com.velobase.bypage://auth/callback` is accepted. The app checks the callback path, scheme, host, duplicate parameters, original state and exact issuer before exchanging the code. It does not accept caller-supplied redirects.
- Mobile sessions are stored in the existing Session table with `kind=mobile`, exact origin, expiry, permissions and a token hash. The raw token is returned once. Both sessions and authorization grants default to `['account_ai']`; existing tokens are not elevated. Token exchange copies only the stored grant's permissions and returns them with the public session identity. Auth.js cookie sessions accept only `kind=web`; mobile endpoints accept only mobile Bearer credentials. Existing Web device controls can revoke mobile sessions.
- A session lasts 30 days without silent refresh. Every protected API request rechecks its database record and loads that user's AI configuration. An expired or revoked login cannot fall back to the local developer key.
- iOS stores credentials in Keychain under a hash of the origin, using `WhenUnlockedThisDeviceOnly` and disabling iCloud Keychain synchronization. The JavaScript bridge returns public identity separately. An authorization header crosses the bridge only for the captured session's request and is never put in React state, preferences, SQLite, diagnostics or URLs.
- Authentication exchange and revocation use an ephemeral URLSession with cookies, cache and credential storage disabled, no redirects, bounded responses and timeouts. Reading streams retain Expo's fetch transport, with redirects rejected and credentials omitted.

## Library permission and v2 discovery

The v2 browser confirmation grants `account_ai` plus `library_sync` for reading, adding, updating and deleting account books, progress, notes and bookmarks. It explicitly says that authorization does not upload the device library: copying device books must be a separate App action. Independent translation, AI-history and preference sync are not included. Deleting an account book also tombstones its associated cloud records, including saved translations and conversations, and pauses its translation jobs; this consequence is disclosed before confirmation.

`/api/mobile/v2/config` returns version 2, the four supported entities and the current session's permissions. Backend availability alone does not authorize a library: the native panel checks support and obtains the separate browser grant, while protected requests require `library_sync` and the exact account-identity header. The v1 capability remains `nativeAccountSync: false` for old clients. An old native build without the library-auth capability cannot start the new grant flow. See the [native sync protocol](native-sync-protocol.md).

The App's account-library path now includes immutable storage handles, lease-bound switching, a transactional outbox, CAS acknowledgements and local conflict/deletion recovery. Initial remote books and progress are applied together. Local edits and their pending mutations commit together; late responses cannot clear newer edits. Web shelf fields are preserved, and ordinary progress/group changes send metadata without repeatedly transferring the entire book. Automatic sync is foreground work on the available library screen; the account panel also provides status and explicit retry.

A separate per-book confirmation copies selected device content into the account library while retaining device originals. Books, progress, notes, bookmarks and group membership can synchronize. Saved translations are copied to the local account cache only; original PDF files, AI history and translation drafts are not copied. No independent translation, history or preference endpoint is enabled by this consent.

Recovery copies retain the complete pre-conflict/deletion local book data, including private drafts/history and pending mutations, without removing account PDF originals. The account panel offers an importable reading-pack export and a full recovery-archive export. Export does not recreate a cloud book; the full archive is not a portable reading pack. PDF original bytes remain local and are not embedded in those exports.

## Identity and cancellation

The native account adapter owns a synchronous revision. Changing origin, signing in/out or receiving a current session's 401 invalidates that revision and cancels registered requests. Each stream checks its captured revision after awaits and after reader cleanup. A translation batch also captures the revision, so it cannot resume under another account. Late replies and 401s from an old identity cannot clear the new session. Keychain clearing additionally takes the expected session ID.

When account identity changes or its library permission is lost, account content is blocked and the host returns to the device library after its local flush boundary. Account databases and attachments are retained. A switch prepares its destination, flushes the old reader, then revokes the old lease and remounts the library tree; delayed writes remain bound to their original handle.

Signing out removes the local credential before trying remote revocation. If the server cannot be reached, the app reports that local sign-out succeeded and explains that the Web device list can revoke the remote session. An offline session verification preserves local reading and cached identity but does not claim that the server verified it.

## Deployment and local development

Apply the additive Prisma migrations before serving these routes. The original session migration defaults existing session kinds to `web`; `202610230003_mobile_library_permissions` adds AI-only permission defaults to sessions and pending mobile grants without changing their identities or granting library access. Account-enabled deployments require the existing Google/Auth.js configuration and a canonical `APP_ORIGIN`. Production origin must be HTTPS. Debug native builds allow HTTP only for loopback when the generated development flag is present. Release builds pin `https://leafread.ai` in the request boundary and native credential module. No user-selectable origin exists. Old `serverOrigin` preferences are discarded; local books and historical account databases remain untouched. Development builds alone may pin a loopback origin at build time.

`app.config.js` keeps the existing `bypage` scheme and adds the account callback scheme. Rebuild the native app after installing or updating the local `ByPageAuth` Expo module, including its `libraryVersion` capability; a Metro reload alone cannot add system framework code. There are no new npm authentication dependencies or provider token storage.

The module follows VeloAgent's separation between the mobile host, API contracts, browser handoff and secure credentials. The reference checkout was read at `/Users/jerry/go/src/github.com/velobase/veloagent`; Harness was read at `/Users/jerry/Code/velobase-harness`. Its GET auto-authorization behavior was not copied: ByPage requires a separate confirmation POST.

## Verification boundaries

Earlier account-connection compilation and focused simulator observations are recorded in [mobile verification](mobile-verification.md). This increment has not established real account authorization, an account-library round trip, or isolation across multiple real accounts. Existing device data remains in `bypage-v1.db`; the implementation does not migrate or automatically upload it. The earlier permission migration ran on the confirmed local database with empty user/session/grant tables, so it is not evidence of real legacy-token behavior.

The connected App paths described here reflect source implementation. Builds, static review and device-only simulator observations do not prove the account workflows. The main verification log records completed observations separately. No unit, integration or end-to-end automated tests were added or run. Full saved-translation, AI-history and preference sync remain future work requiring separate contracts and consent.


Recovery copies can now be restored into an independent device book. Complete recovery JSON is accepted by Import with a dedicated preview and never replays sync operations. Original PDF bytes are copied only during internal account recovery when available; exported JSON does not contain them. Compatible AI history/drafts retain their original identity, while incompatible rows remain in the source archive and are reported as skipped. Repeating the same restore preserves the existing recovered copy. See [the recovery design](native-sync-design.md#recovery-and-explicit-copying) for limits.

## Profile and direct Google sign-in

The Profile card exposes Google sign-in for guests and identity/account management for signed-in readers. The sync row distinguishes device-only reading, waiting, syncing, completed and failed sync. Opening Profile never uploads the device library. Library sync remains a separate explicit permission, followed by a separate per-book copy decision.

Native authorization URLs include `provider=google`. Valid authorization pages start OAuth once when no web session exists; the OAuth return URL omits that flag to prevent redirect loops. An existing web session proceeds to explicit account confirmation. PKCE, state, issuer validation and the confirmation POST remain required; direct sign-in does not silently grant library permissions. Backend changes must be deployed alongside the next native release.

### Profile verification — 2026-10-23

- Web and mobile TypeScript checks passed; the production iOS JavaScript export and an iOS simulator native build passed. No automated test suite or paid model request was run.
- Manually clicked the rebuilt app on the iPhone 17 Pro Max simulator: Profile displayed the Google button and preserved device reading statistics; the button opened the iOS authentication sheet and reached `accounts.google.com` directly. Cancelling returned to Profile with the sign-in button usable and no error message.
- Manually opened Settings and confirmed that the service-address field and connection controls were gone. Static review also confirmed their removal from Account and the assistant.
- This simulator build used the compile-time loopback development backend at `127.0.0.1:4173` to exercise the new authorization pages. Release builds remain pinned to `https://leafread.ai`.
- No Google credentials were entered. Completed account authentication, signed-in Profile, logout and real library sync still require a user-authenticated session. This work has not been deployed to production or uploaded to TestFlight.
