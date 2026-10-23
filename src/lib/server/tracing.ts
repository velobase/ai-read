import 'server-only';
import {
  TracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { logException, setTelemetryTracer } from './observability';

const shared = globalThis as typeof globalThis & { bypageTracer?: TracerProvider };

export function registerTracing() {
  // No exporter is constructed without an explicit collector address.
  if (shared.bypageTracer || !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) return;
  const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    throw new Error('Invalid trace collector configuration.');
  const configured = Number(process.env.OTEL_TRACES_SAMPLE_RATIO ?? '0.1');
  const ratio = Number.isFinite(configured) ? Math.min(1, Math.max(0, configured)) : 0.1;
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': process.env.OTEL_SERVICE_NAME || 'bypage' }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url: endpoint.href, timeoutMillis: 5000 }),
        maxQueueSize: 512,
        maxExportBatchSize: 64,
        scheduledDelayMillis: 5000,
      }),
    ],
  });
  shared.bypageTracer = provider;
  // Intentionally private provider: automatic HTTP/SQL instrumentation could capture
  // book IDs, callback URLs, credentials or query text. Only our allowlisted spans export.
  setTelemetryTracer(provider.getTracer('bypage', '0.1.0'));
  process.once('SIGTERM', () => {
    void provider.shutdown().catch((error) => logException('tracing.shutdown', error));
  });
}
