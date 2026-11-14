// The worker's "view": everything it prints. Controllers call these instead of console.* directly.
export const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
export const logRun = (id: string, s: { fetched: number; inserted: number; expired: number }, error?: string) =>
  log(`${id}: ${error ? 'ISSUE ' + error : 'ok'} fetched=${s.fetched} new=${s.inserted} expired=${s.expired}`);
export const logFatal = (e: unknown) => console.error(e);
