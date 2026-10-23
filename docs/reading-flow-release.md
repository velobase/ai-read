# Reading translation release — 2026-10-23

Source commit: `083a9cecab81afcf3b7206cc0a6bf1542ba8bd61`.

Web and native readers now follow the same interaction: choose Original, Bilingual or Translation only; missing paragraphs near the reading position are translated automatically. Returning to the book restores the position, saved complete paragraphs and unfinished long-paragraph checkpoints. Leaving the reader, selecting Original or backgrounding the app cancels unnecessary requests. There is no preparation, pause or whole-book task control.

The release was integrated with the existing production native Apple/Google sign-in, renewable sessions, platform-managed AI service and public bookstore. No database schema or migration changes were introduced. Existing saved editions remain readable; both clients hydrate matching server editions before generating missing text. Source-language overrides retain canonical source identity.

## Web

- [Production](https://leafread.ai)
- [Build 39967048515](https://github.com/velobase/ai-read/actions/runs/39967048515): success.
- [GitOps release 39967500571](https://github.com/velobase/gitops/actions/runs/39967500571): success.
- GitOps commit: `9d19024aaa13feb7d16336e3c9d980394e395ae1`.
- Runtime digest: `sha256:b226194ec3c5d8c1118b1d6aa9c4646ad43edeb12c8a5c9ee19b6fc5c087cac8`.
- Migration digest: `sha256:f75a8a1e33993ba31a4f5e92f8b8911ff7502c9a945e8dbe0fac6672a4a6d0b7`.
- Independently verified Argo Healthy/Synced at that GitOps revision, deployment 1/1, and `/api/ready` HTTP 200. CUA verified the production home page and public bookstore loaded.

## iOS

- Version **1.0.5 (13)**; bundle `com.velobase.bypage`.
- [EAS build 69781faa-b038-46fe-9566-933ea104f9d6](https://expo.dev/accounts/attune-dating-team/projects/bypage-reader/builds/69781faa-b038-46fe-9566-933ea104f9d6): FINISHED, exact source commit verified.
- [EAS submission 575f2243-b904-47d4-ac4c-5e702cdd11c8](https://expo.dev/accounts/attune-dating-team/projects/bypage-reader/submissions/575f2243-b904-47d4-ac4c-5e702cdd11c8) was canceled while still queued, before uploading. The same verified IPA was then delivered directly with Apple's official `altool` using the existing App Store Connect credentials.
- Apple confirmed `UPLOAD SUCCEEDED with no errors` at 2026-10-23 14:34:47 UTC; delivery UUID `1aa802f3-686a-4986-8b75-a163f46d6f52`, 12,654,794 bytes. The uploader recovered from a transient Apple 500 within that invocation; no duplicate upload was started.
- Verified at 2026-10-23 14:37:45 UTC: Apple finished processing exact **1.0.5 (13)** with `processingState=VALID`, `internalBuildState=IN_BETA_TESTING`, `expired=false`. App Store Connect build ID: `1aa802f3-686a-4986-8b75-a163f46d6f52`. The build is available in the existing internal group; external testing remains `READY_FOR_BETA_SUBMISSION`. A second independent App Store Connect query confirmed the same version, build and availability.
- `altool --wait` exited successfully with build/import status `VALID` and App Store Connect visibility confirmed. Temporary upload credential copies were removed after completion.
- Existing internal `Team (Expo)` group, ID `7b136b03-ed33-4525-aa46-90f22823858b`, was verified with access to all builds. No testers were added, no new credentials or groups were created, and no Apple agreements were accepted.
- Signed IPA metadata independently confirms the expected bundle/version/build, service origin `https://leafread.ai` and local HTTP disabled. Apple sign-in entitlement and Google sign-in configuration are retained.
- Final EAS archive contained 463 files; all 156 mobile/shared source files matched the release commit. No local credentials, environment files, books, databases or screenshots were included.

## Validation

Web production build, mobile iOS JS export, web/mobile/shared-package type checks passed. User-authorized lightweight offline checks passed: 9 mobile queue/recovery tests, 8 web translation tests and 7 reading-anchor/layout conditions. They cover saved-translation reuse, cancellation, checkpoint resume, bounded retries, offline probes, historical server recovery and source identity.

No live paid model calls, device installation or full integration/end-to-end testing were performed. Those reading and account integration checks remain for the user.
