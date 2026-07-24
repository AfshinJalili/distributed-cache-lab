export const keys = {
  prefix: 'dcl:',
  settings: 'dcl:settings',
  clockOffset: 'dcl:clock-offset-ms',
  metrics: 'dcl:metrics',
  instances: 'dcl:instances',
  lastTrace: 'dcl:last-trace',
  events: 'dcl:events',
  cacheIndex: 'dcl:cache:index',
  cacheLru: 'dcl:cache:lru',
  cacheLfu: 'dcl:cache:lfu',
  cacheVersionWatermarks: 'dcl:cache:version-watermarks',
  cacheEntryPrefix: 'dcl:cache:entry:',
  lockPrefix: 'dcl:lock:',
} as const

export const refreshQueueName = 'dcl-cache-refresh'
