# LeafRead deployment

Production origin: https://leafread.ai. Application source: `velobase/ai-read` (`main`). Desired Kubernetes state: `velobase/gitops`, `apps/leafread/overlays/prod`; Argo CD application `leafread-prod`.

## Network

Cloudflare proxies the apex and wildcard A records to the existing GCP shared TCP ingress. Full (strict) TLS validates the origin certificate. The existing GKE Nginx controller routes `leafread.ai` to a ClusterIP service and redirects `www` to the canonical apex. cert-manager renews the certificate for both names. No new public LoadBalancer or external node IP is needed. Private nodes continue using the existing Cloud NAT egress.

The application accepts only its configured `APP_ORIGIN`. Set `AUTH_URL` to the same canonical HTTPS origin: Auth.js route handlers otherwise derive OAuth callbacks from the standalone server’s internal host rather than the forwarded host headers. Ingress probes send that Host header. API responses are not cached; model responses stream without Nginx buffering. Book sync requests retain the application's 64 MiB limit. The pod NetworkPolicy permits DNS, Workload Identity, the private Cloud SQL endpoint and public HTTPS; it blocks other private destinations. Hosted AI endpoints cannot point to loopback. Account AI connections are stored per user in PostgreSQL. API keys are encrypted before storage and are never returned to the browser; local mode without accounts retains memory-only manually entered keys.

## Database and credentials

LeafRead uses its own `leafread` database on the existing private Cloud SQL PostgreSQL instance. `leafread_migrator` owns only this database and applies migrations; `leafread_app` has application DML privileges. Neither account can create databases or roles. PostgreSQL connections pass through a loopback Cloud SQL Auth Proxy sidecar using GKE Workload Identity. No database listener is exposed publicly by this deployment.

Kubernetes Secrets `leafread-runtime` and `leafread-migration` are provisioned outside Git in namespace `leafread-prod`. Runtime requires `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET`. The production session secret differs from local development. Google OAuth registers `https://leafread.ai/api/auth/callback/google`; existing local callbacks remain supported. Never bake `.env` or runtime credentials into images.

The shared Cloud SQL instance's existing backup policy is not changed by this application release. It currently has automatic instance backups disabled. Before relying on this deployment as the sole copy of reading data, configure database backups; browser exports remain available. An image rollback does not roll back PostgreSQL or browser data.

## Release and rollback

1. Push application changes to `main`. **Build LeafRead** builds the Next.js standalone runtime and a separate Prisma migration image from the same commit. Compilation includes TypeScript checking. No unit, integration or E2E tests run automatically.
2. Once the build succeeds, run **LeafRead GitOps release** in `velobase/gitops` with the full application commit SHA. The workflow resolves both immutable image digests and commits only the LeafRead overlay. GitHub authenticates through repository-and-branch-bound Workload Identity Federation; no personal GitHub token or GCP key file is stored in the app repository.
3. Argo CD applies configuration and the migration Sync hook before replacing the web pod. A failed migration prevents rollout. RollingUpdate keeps the existing ready pod until its replacement is ready.
4. Observe Argo CD health, deployment readiness and `https://leafread.ai/api/ready`. `/api/health` reports process liveness; `/api/ready` requires complete auth configuration and an accessible migrated database. Functional integration verification is performed by the user.

To roll back, promote a previous compatible application commit through the same GitOps workflow. Preserve Secrets, the Cloud SQL database and browser libraries. Schema compatibility must be reviewed before promoting an older image.

For the initial bootstrap only, register `argocd/leafread-prod-application.json` with Argo CD after provisioning namespace, credentials and Workload Identity. Subsequent app releases change GitOps state, not live Deployment image fields.

## User AI connections

`User` has one optional `AIConnection` row, keyed by `userId` with cascade deletion. It stores the normalized service URL, arbitrary model ID, encrypted key and timestamps. Authenticated `PUT /api/account/ai` updates only the session owner's row; `GET /api/account/ai` and `/api/config` return metadata and a `hasKey` flag, never the key or ciphertext. Both settings screens save through this endpoint. Every AI request reads the latest account row, so changing a provider, model or key takes effect on the next request without a release or pod restart. An in-flight request completes with the configuration it started with.

`leafread-ai-encryption` is provisioned outside Git with a distinct `AI_ENCRYPTION_KEY`: a cryptographically random 32-byte value encoded as base64. AES-256-GCM uses a fresh nonce for each credential and authenticates the owning user ID and endpoint. The same master key is retained in GCP Secret Manager as `leafread-ai-encryption` for recovery. Preserve it alongside database recovery planning; replacing it without re-encrypting stored credentials makes them unreadable. Do not rotate it as part of ordinary model/key changes. Readiness verifies that the encryption key and migration are present. The database contains no plaintext provider keys, and no provider credentials or account IDs belong in Kubernetes configuration.

Leaving the key field blank retains the existing credential. Switching endpoints requires a replacement key or explicit removal. Hosted AI requests use the saved account connection, ignoring stale client-side endpoint/model/key values. Local deployments without accounts may still use `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY`. No paid model request is part of deployment validation.

## Public support identity

Use `leafread-support@googlegroups.com` for all public support links and the Google OAuth user-support and developer-contact fields. The shared contact constant is `src/lib/contact.ts`. Group membership and conversations must remain private; users may send support emails without joining. Do not publish a personal email address in application pages, OAuth branding or Git commit metadata.

## Reading translation

Web and native readers request missing translations near the current reading position when the reader selects Bilingual or Translation only. Moving the reading position replaces the demand; selecting Original, leaving the reader or backgrounding the app stops unnecessary requests. Completed translations remain available locally and through the existing library sync. The server handles the reader's requests through the configured AI service; deployment validation does not issue model requests.

There is no chapter or whole-book background worker to start, disable or drain. The web runtime no longer registers a translation worker in Next.js instrumentation, and the old mutation/chunk endpoints are removed. Keep the existing translation tables and migration history: saved editions are still read through `GET /api/translations`, and readiness continues to verify those tables. Do not delete historical editions, checkpoints or user translations when deploying this change. No new queue, Redis instance or dedicated worker deployment is required. See [reading translation and persistence](chapter-translations.md).
