# ByPage TestFlight release

Status recorded on 2026-10-23 (Asia/Shanghai): **production build, EAS submission, and Apple processing completed. Version 0.1.0 (2) shows Ready to Test in the internal Team (Expo) group; no testers have been invited**.

## Application records

- App Store Connect: [ByPage](https://appstoreconnect.apple.com/apps/6826089760/distribution), app ID `6826089760`.
- Apple team: UTOPIX, LLC (`9BMSHUC3V6`).
- Bundle identifier: `com.velobase.bypage`.
- Expo: [@attune-dating-team/bypage-reader](https://expo.dev/accounts/attune-dating-team/projects/bypage-reader).
- EAS project ID: `a3adde3b-27f2-4af9-9f9e-43f25e8d5d3e`.
- Version: `0.1.0`; current EAS build number `2`.
- Production build: [9e9333ae-d026-456a-b86b-a18ce87cb63d](https://expo.dev/accounts/attune-dating-team/projects/bypage-reader/builds/9e9333ae-d026-456a-b86b-a18ce87cb63d).
- Submission: [2be59dd9-14f8-4461-bcb9-a67154c6578b](https://expo.dev/accounts/attune-dating-team/projects/bypage-reader/submissions/2be59dd9-14f8-4461-bcb9-a67154c6578b).

## Completed preparation

- Production EAS profile uses the SDK 57 build image, disables dotenv/client environment injection, and uses remote build numbering.
- Submit profile targets the ByPage App Store Connect record and the verified Apple team.
- Production Expo configuration resolves to `ByPageAuthAllowLocalHTTP=false`, with no development local-network usage description.
- Required-reason privacy declarations include external user-selected document metadata (`3B52.1`) and retain existing container, preferences, and boot-time declarations.
- Root `.easignore` excludes local secrets, signing files, private reading/verification files, generated hosts, dependencies, and Git metadata while preserving local Expo module Swift sources.
- A local archive inspection contained 455 files (7,923,296 bytes); all 149 mobile/shared source files matched their working-copy hashes. It contained no real PDF/EPUB samples, environment files, signing keys, or generated mobile iOS host.
- A user-authorized Developer-role App Store Connect key was created and securely associated with this EAS project's submissions. Secret material is outside the repository and is not included in the archive.
- Final mobile type checking and iOS JS export passed. Import cancellation retained the nine-table database summaries and two incoming-document metadata hashes, leaving zero temporary PDF preview copies. See `mobile-verification.md` for manual simulator evidence and limitations.

## Signing and submission

The first production build attempt stopped during credential setup, before cloud compilation or binary upload. Apple returned HTTP 403 when the Developer-role API key attempted to create an Apple Distribution certificate. The key role was not broadened.

With explicit user authorization, the existing administrator webpage and native Chrome file picker were used to upload the local CSR. The Apple Distribution certificate and ByPage App Store provisioning profile were created and securely stored in EAS. Native file picker sheets needed their exposed Raise action before typing; no browser-extension file access change was required.

- Certificate: `D5MBSS2C3H`, expires 2027-10-23.
- Profile: `F9P6GQ7C2H`, UUID `2392b6a5-23dd-4942-89f8-381225780260`.
- The downloaded profile contains the matching certificate, the exact ByPage application identifier, `get-task-allow=false`, and no device list.
- EAS accepted all credentials and uploaded the 3.8 MB project archive.
- Build `0.1.0 (2)` finished at 14:09:25 on 2026-10-23 (Asia/Shanghai). EAS reported both build and submission `FINISHED`, with no error, at 14:09:51.
- The downloaded final IPA is 11,822,133 bytes. Its Info.plist confirms `com.velobase.bypage`, version `0.1.0`, build `2`, minimum iOS `16.4`, `ByPageAuthAllowLocalHTTP=false`, no local-network usage description, arbitrary loads disabled, and non-exempt encryption declared false. Expo's local-networking ATS flag remains present; the app's HTTP-auth allowance is disabled.
- The IPA includes the required-reason privacy manifest and contains no PDF/EPUB sample files or signing secrets.
- Apple completed processing and lists build `2` as `Ready to Submit` (external beta review has not been submitted), expiring in 90 days. Its detail page confirms association with internal group `Team (Expo)`.
- The internal group's Builds tab separately confirms `0.1.0 (2)` is `Ready to Test`, with 0 testers and 1 build. This is the verified internal-distribution result.
- App Store Connect build ID: `d3947c58-291a-42a3-a9a9-2e6d4da039c5`.
- Chinese What to Test instructions were saved, covering local import/reading and explicitly identifying unavailable online services.
- No tester invitation was sent by the agent, and no actual TestFlight installation on a physical device has been verified. The group and individual tester lists are empty.

## Preview scope

This build supports local reading and document import. No production `BYPAGE_MOBILE_API_ORIGIN` is configured, so account and online AI workflows need a separately configured HTTPS service; upload success does not establish those features as available. Manual simulator evidence and unverified branches are recorded in `mobile-verification.md`.

## Remaining release steps

1. Add explicitly requested internal testers to `Team (Expo)`; each tester needs a compatible device and the TestFlight app. No recipient was specified during this release.
2. Before external beta review, complete test information, feedback/review contact details, and a public privacy policy covering native storage and optional account/AI behavior; add the policy entry inside the app.

Apple displays a program-license update notice for the account holder. No agreement was accepted by the agent; if it blocks submission, the account holder must resolve it.

No automated unit, integration, or end-to-end tests were run for this release preparation.
