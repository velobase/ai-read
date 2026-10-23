import { mobileSyncGET, mobileSyncPOST } from '@/lib/server/mobile-sync';
import { observedRoute } from '@/lib/server/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = observedRoute('api.sync.read', mobileSyncGET);
export const POST = observedRoute('api.sync.write', mobileSyncPOST);
