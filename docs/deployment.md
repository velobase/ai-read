# LeafRead deployment

Production origin: https://leafread.ai. Application source: `velobase/ai-read` (`main`). Desired Kubernetes state: `velobase/gitops`, `apps/leafread/overlays/prod`; Argo CD application `leafread-prod`.

## Network

Cloudflare proxies the apex and wildcard A records to the existing GCP shared TCP ingress. Full (strict) TLS validates the origin certificate. The existing GKE Nginx controller routes `leafread.ai` to a ClusterIP service and redirects `www` to the canonical apex. cert-manager renews the certificate for both names. No new public LoadBalancer or external node IP is needed. Private nodes continue using the existing Cloud NAT egress.

The application accepts only its configured `APP_ORIGIN`. Set `AUTH_URL` to the same canonical HTTPS origin: Auth.js route handlers otherwise derive OAuth callbacks from the standalone server’s internal host rather than the forwarded host headers. Ingress probes send that Host header. API responses are not cached; model responses stream without Nginx buffering. Book sync requests retain the application's 64 MiB limit. The pod NetworkPolicy permits DNS, Workload Identity, the private Cloud SQL endpoint and public HTTPS; it blocks other private destinations. Hosted AI endpoints cannot point to loopback. Browser-entered model keys remain memory-only. An account-scoped managed key is stored separately in `leafread-private-ai`; only authenticated user IDs in `AI_ALLOWED_USER_IDS` can use it, and it is never returned to the browser.

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

## Managed AI access

`leafread-private-ai` is provisioned outside Git with `AI_BASE_URL`, `AI_MODEL`, `AI_PRIVATE_API_KEY` and `AI_ALLOWED_USER_IDS`. Hosted AI access checks the session user ID before using the private key or exposing the configured service/model defaults. Other accounts retain BYOK support. The key uses a separate environment variable from legacy shared-key deployments so an image rollback fails closed. Keep personal account IDs and keys out of source control; a provider key change requires the web pods to restart. No paid model request is part of deployment validation.
