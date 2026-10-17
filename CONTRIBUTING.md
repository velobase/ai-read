# Contributing to AI Read

Contributions should make reading across languages easier while keeping source evidence visible and the user's library under their control.

Open an issue for larger changes so the scope can be discussed. For a small fix, a focused pull request with a clear problem statement and behavior change is welcome.

Use `npm ci` followed by `npm run dev` to work locally. `npm run typecheck` and `npm run build` check types and packaging. State exactly what you verified and what remains unverified in the pull request. Do not claim live provider behavior without actually verifying it.

Keep imported books, personal notes, model credentials, and `.env` files out of commits. Use original or appropriately licensed fixtures. Preserve dependency license notices. Do not add analytics or remote library storage without explicit product discussion.

Changes to parsing or citation IDs should account for existing saved positions, notes, and translations. Changes to storage require an IndexedDB migration. UI work should support keyboard navigation, narrow screens, and the paper/night themes.

Contributions are provided under the project's MIT license. Third-party assets must have compatible, documented licenses.
