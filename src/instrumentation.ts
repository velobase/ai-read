export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { startTranslationWorker } = await import('./lib/server/translation-worker');
    startTranslationWorker();
    const { startCatalogWorker } = await import('./lib/server/catalog-worker');
    startCatalogWorker();
  }
}
