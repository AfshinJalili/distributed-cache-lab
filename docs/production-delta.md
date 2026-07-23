# Production delta

The application code demonstrates production patterns, but the local Compose topology optimizes for one-command learning. A real deployment should make explicit decisions in these areas.

## Redis

- Replace the single node with a managed replicated service, Sentinel, or Redis Cluster according to availability and scale requirements.
- Define persistence, backup, restore, encryption, authentication, network isolation, and maintenance policies.
- Revisit the exact application-managed LRU/LFU implementation for Redis Cluster: scripts and all keys they touch must share a hash slot, or eviction ownership must be partitioned.
- Size connection pools and establish server/client timeout budgets from measured tail latency.

## PostgreSQL and workers

- Use a highly available PostgreSQL service, migration job, backups, point-in-time recovery, TLS, and least-privilege credentials.
- Add an outbox retention/archive policy and alert on oldest unprocessed event age.
- Configure BullMQ retention, retry/backoff, dead-letter handling, and queue-depth alerts for the workload.

## Edge and API

- Add identity, authorization, tenant isolation, request validation policy, rate limits, TLS, and secret management.
- Replace the local Nginx instance with the platform ingress or load balancer and define deploy-time health/readiness behavior.
- Keep application replicas stateless; all coordination used by a request must remain shared or safely replica-local.

## Operations

- Export telemetry to durable backends and attach service-level objectives to hit rate, origin amplification, reconciliation lag, availability, and p95/p99 latency.
- Load-test failure recovery as well as steady state. Validate retry budgets so Redis or PostgreSQL degradation does not become a retry storm.
- Add deployment manifests, autoscaling policies, disruption budgets, resource limits, image scanning, signing, and a rollback strategy.
- Run chaos drills in an isolated environment with explicit blast-radius controls instead of exposing Toxiproxy controls publicly.

The local Redis node is not inconsistent with multiple API and worker replicas. They demonstrate cross-process coordination; Redis replication is a separate availability concern intentionally excluded from this lab.
