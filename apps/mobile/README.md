# LeafRead for iOS

Native EPUB, PDF and TXT reading with device-local storage, original PDF page comparison, notes, bookmarks, page transitions and optional account services at `https://leafread.ai`.

From `apps/mobile`, run `npm ci`, then `npm run ios` for a local development build. The shared `packages/reading-core` and `packages/api-client` directories are required. `npm run typecheck` performs static validation. Do not run automated tests unless the user explicitly requests them.

Production builds use the EAS `production` profile. EAS manages the increasing iOS build number remotely. Keep `com.velobase.bypage` and the existing EAS project identity unchanged when updating the visible LeafRead / 叶子阅读 brand. Credentials are managed outside the repository; no server secrets are included in the native build.

## Release 1.0.1 (9), 2026-10-23

- EAS build: `87049568-29de-4efc-b45a-ad6ea74d1026`; source commit: `41858909796bff613d891f6be0a8aef44ef8f13f`.
- EAS upload: `db2cb69e-b23b-43b3-99d2-5e44472c7ee7`, completed successfully.
- Backend release: `e6a6d5b7500909f7425e6e735ff8a070af0696ed`, deployed and healthy.
- TestFlight internal testing is active. External review and App Store review both showed **Waiting for Review** on 2026-10-23.
- App Store submission: `ad8e0c66-5349-43ad-9332-a1b2dfc15389`.
- The earlier 1.0.0 (7) App Store and external beta submissions were withdrawn. Build 7 was removed from the external group; build 8 was canceled before upload.
- Store availability: United States, free, automatic release after approval.
- Static type checks, Next.js production build, native Release simulator build and EAS distribution build passed. Manual simulator checks confirmed Apple's system account authorization prompt and the official Google SDK login page. Full sign-in, return-to-app, session renewal and account deletion remain for the user to verify. No automated tests were run for this release.

Account sync requires separate authorization. Device books are copied to an account only by explicit user choice. Deletion revokes server sessions and Apple authorization, deletes account cloud data and queues local account-cache cleanup; device-library books remain.

## Native sign-in update (1.0.1)

- Apple uses the iOS system authorization sheet; Google uses its official iOS SDK with nonce-bound backend verification.
- The previous mobile browser authorization flow and all auth-version fallbacks are removed. Old cached credentials are cleared and require native sign-in. Existing provider identities keep their accounts. Keychain restores the app session; foreground renewal preserves permissions, and sign-out cannot be undone by a late callback.
- Library sync is confirmed for the current account inside the app, without a second browser login. Device books still require an explicit copy action.
- The Expo config plugin adds module maps needed by Google's optional App Check dependency under static CocoaPods linking. App Check itself is not configured or enabled.
- Server configuration and account migration details: `docs/authentication.md`. Keep the Google iOS/Web public client IDs and URL scheme aligned; never embed server secrets.
