# Third-party notices

AI Read is an independent application. It does not include source code from Readest, Anx Reader, Readwise, LingQ, or Immersive Translate.

Runtime libraries and bundled fonts retain their original licenses:

| Dependency                 | License                   | Upstream                                      |
| -------------------------- | ------------------------- | --------------------------------------------- |
| Next.js                    | MIT                       | https://github.com/vercel/next.js             |
| shadcn/ui component source | MIT                       | https://github.com/shadcn-ui/ui               |
| Radix UI                   | MIT                       | https://github.com/radix-ui/primitives        |
| class-variance-authority   | Apache-2.0                | https://github.com/joe-bell/cva               |
| clsx                       | MIT                       | https://github.com/lukeed/clsx                |
| tailwind-merge             | MIT                       | https://github.com/dcastil/tailwind-merge     |
| tw-animate-css             | MIT                       | https://github.com/Wombosvideo/tw-animate-css |
| React / React DOM          | MIT                       | https://github.com/facebook/react             |
| Lucide React icons         | ISC                       | https://github.com/lucide-icons/lucide        |
| fflate                     | MIT                       | https://github.com/101arrowz/fflate           |
| DM Sans (via Fontsource)   | SIL Open Font License 1.1 | https://github.com/fontsource/font-files      |
| Lora (via Fontsource)      | SIL Open Font License 1.1 | https://github.com/fontsource/font-files      |

Full notices for these distributed components are included under `public/licenses/`, served as static assets by Next.js. Font files are distributed unmodified. The fonts' licenses apply to the fonts, independently of the application's MIT license.

Build tooling includes Tailwind CSS and PostCSS (MIT), TypeScript (Apache-2.0), Prettier (MIT), and their dependencies. Their license files are installed with npm. The exact resolved dependency graph is recorded in `package-lock.json`.

Account services additionally use Auth.js / NextAuth and its Prisma adapter (ISC), Prisma Client and PostgreSQL adapter (Apache-2.0), node-postgres (MIT), and dotenv (BSD-2-Clause). Their notices are bundled under `public/licenses/`; Prisma generation/migration tooling retains its installed license. The Google sign-in mark is used to identify the Google login provider.

PDF conversion uses Mozilla PDF.js / pdfjs-dist (Apache-2.0), with its worker, CMaps, standard fonts and WASM assets served from `public/pdfjs/`. The build copies the upstream license alongside those assets; see `/pdfjs/LICENSE`.

The iOS host uses React Native, Expo and Expo modules (MIT), React Native Safe Area Context (MIT), @xmldom/xmldom (MIT), and Ionicons via @expo/vector-icons (MIT). Their installed notices and exact versions are retained in `apps/mobile/package-lock.json` and the dependency directories. Apple PDFKit, Vision and speech APIs are system frameworks, not bundled third-party implementations.

Optional OpenTelemetry tracing uses @opentelemetry/api, resources, sdk-trace and exporter-trace-otlp-http (Apache-2.0); dependency licenses remain with the installed server distribution.
