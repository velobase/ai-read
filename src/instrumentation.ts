export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { registerTracing } = await import('./lib/server/tracing');
    const { logEvent } = await import('./lib/server/observability');
    try {
      registerTracing();
    } catch (error) {
      const { inspect } = await import('node:util');
      console.error(
        'Tracing initialization failed',
        inspect(error, {
          depth: null,
          maxArrayLength: null,
          maxStringLength: null,
        }),
      );
      logEvent('server.request', { outcome: 'error', errorKind: 'trace_configuration' });
    }
  }
}

export const onRequestError: import('next').Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { inspect } = await import('node:util');
    console.error(
      'Unhandled request error',
      inspect(
        {
          error,
          method: request.method,
          path: request.path,
          context,
          requestId: request.headers['x-request-id'],
        },
        { depth: null, maxArrayLength: null, maxStringLength: null },
      ),
    );
    const { logEvent } = await import('./lib/server/observability');
    logEvent('server.request', { outcome: 'error', errorKind: 'unhandled_request' });
  }
};
