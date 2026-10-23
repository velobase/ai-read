# LeafRead for iOS

Native EPUB, PDF and TXT reading with device-local storage, original PDF page comparison, notes, bookmarks, page transitions and optional account services at `https://leafread.ai`.

From `apps/mobile`, run `npm ci`, then `npm run ios` for a local development build. The shared `packages/reading-core` and `packages/api-client` directories are required. `npm run typecheck` performs static validation. Do not run automated tests unless the user explicitly requests them.

Production builds use the EAS `production` profile. EAS manages the increasing iOS build number remotely. Keep `com.velobase.bypage` and the existing EAS project identity unchanged when updating the visible LeafRead / 叶子阅读 brand. Credentials are managed outside the repository; no server secrets are included in the native build.

## Release 1.0.0 (7), 2026-10-23

- EAS build: `624eccda-6de8-4a83-99b6-cad844ce7524`.
- Backend release: `fa7240242504a119b0223704d0febc4b66e41cba`.
- TestFlight external review and App Store review submitted; both showed **Waiting for Review** on 2026-10-23.
- App Store submission: `55719494-8f5c-4fbd-b8fb-48b846980857`.
- Store availability: United States, free, automatic release after approval.
- Static type checks, native Release simulator build and EAS distribution build passed. Manual simulator checks covered reading screens and opening Apple's official authorization page. Full sign-in, return-to-app and account deletion remain for the user to verify. No automated tests were run for this release.

Account sync requires separate authorization. Device books are copied to an account only by explicit user choice. Deletion revokes server sessions and Apple authorization, deletes account cloud data and queues local account-cache cleanup; device-library books remain.

## Native sign-in update (1.0.1)

- Apple uses the iOS system authorization sheet; Google uses its official iOS SDK with nonce-bound backend verification.
- Existing provider identities keep their accounts. Keychain restores the app session; foreground renewal preserves permissions, and sign-out cannot be undone by a late callback.
- Library sync is confirmed for the current account inside the app, without a second browser login. Device books still require an explicit copy action.
- The Expo config plugin adds module maps needed by Google's optional App Check dependency under static CocoaPods linking. App Check itself is not configured or enabled.
- Server configuration and account migration details: `docs/authentication.md`. Keep the Google iOS/Web public client IDs and URL scheme aligned; never embed server secrets.
