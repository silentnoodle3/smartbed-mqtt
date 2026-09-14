// Races a promise against a timeout so a hung request (e.g. a BLE peripheral that never
// answers a read/write because its link has gone silently stale) can't block a caller
// forever - it rejects instead, letting the caller treat that as a failure and react
// (reconnect, back off, etc.) rather than waiting indefinitely.
export const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
