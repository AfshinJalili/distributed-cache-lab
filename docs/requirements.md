# Accepted demo scope

This implementation promotes design prototype A into a real local system with:

- a React/Vite console, NestJS API, NestJS/BullMQ worker, and shared TypeScript packages;
- two load-balanced API replicas and two competing worker replicas;
- PostgreSQL as source of truth and one Redis 7 node;
- `product:42`, `flags:global`, `catalog:home`, `pricing:pro`, and negative-cached `product:404`;
- exact application-managed LRU/LFU slots with Redis configured for `noeviction`;
- Redis per-key locks and cold-miss coalescing;
- soft/hard TTL, jitter, stale-while-revalidate, and durable deduplicated refresh;
- invalidate and write-through policies reconciled through a transactional outbox;
- a Redis-backed logical clock and Redis Stream delivered through SSE;
- Prometheus metrics, OpenTelemetry traces in Jaeger, and Toxiproxy drills;
- unit, Redis integration, Compose end-to-end, k6 load, and CI checks;
- local Docker Compose operation with a shared lab state and no authentication.

Browser and CDN caching are intentionally excluded. The lab reports application-cache behavior through standard and diagnostic HTTP headers.
