import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT

export const telemetry = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'distributed-cache-worker',
  traceExporter: endpoint
    ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` })
    : undefined,
  instrumentations: [getNodeAutoInstrumentations()],
})

if (endpoint) telemetry.start()
