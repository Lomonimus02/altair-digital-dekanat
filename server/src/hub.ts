const listeners = new Map<number, Set<(data: unknown) => void>>();

export function subscribe(userId: number, send: (data: unknown) => void) {
  let bucket = listeners.get(userId);
  if (!bucket) {
    bucket = new Set();
    listeners.set(userId, bucket);
  }
  bucket.add(send);
  return () => {
    bucket!.delete(send);
    if (bucket!.size === 0) listeners.delete(userId);
  };
}

export function publish(userId: number, data: unknown) {
  for (const send of listeners.get(userId) ?? []) {
    try {
      send(data);
    } catch {
      /* соединение уже закрыто */
    }
  }
}

export function listenerCount() {
  let total = 0;
  for (const bucket of listeners.values()) total += bucket.size;
  return total;
}
