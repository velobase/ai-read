# Third-party notices

AI Read is an independent application. It does not include source code from Readest, Anx Reader, Readwise, LingQ, or Immersive Translate.

Runtime libraries and bundled fonts retain their original licenses:

| Dependency               | License                   | Upstream                                 |
| ------------------------ | ------------------------- | ---------------------------------------- |
| React / React DOM        | MIT                       | https://github.com/facebook/react        |
| Lucide React icons       | ISC                       | https://github.com/lucide-icons/lucide   |
| fflate                   | MIT                       | https://github.com/101arrowz/fflate      |
| DM Sans (via Fontsource) | SIL Open Font License 1.1 | https://github.com/fontsource/font-files |
| Lora (via Fontsource)    | SIL Open Font License 1.1 | https://github.com/fontsource/font-files |

Full notices for these distributed components are included under `public/licenses/`, which Vite also copies into the production build. Font files are distributed unmodified. The fonts' licenses apply to the fonts, independently of the application's MIT license.

Build tooling includes Vite and its React plugin (MIT), TypeScript (Apache-2.0), Prettier (MIT), and their dependencies. Their license files are installed with npm. The exact resolved dependency graph is recorded in `package-lock.json`.
