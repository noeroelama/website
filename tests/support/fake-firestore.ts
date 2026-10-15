import { vi } from "vitest";

type Data = Record<string, unknown>;

/** Firestore returns Timestamp objects for stored Dates; mimic that so adapters convert them. */
function asStored(data: Data): Data {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) =>
      value instanceof Date ? [key, { toDate: () => new Date(value.getTime()) }] : [key, value],
    ),
  );
}

/**
 * Minimal in-memory stand-in for the parts of the Firestore Admin SDK our adapters use.
 * Transactions run one at a time (serializable), like Firestore's.
 */
export function fakeFirestore(options: { failWith?: Error } = {}) {
  const docs = new Map<string, Data>();
  const writes: Array<{ path: string; data: Data }> = [];
  // Like Firestore, a snapshot is a copy taken at read time.
  const snapshot = (path: string, id: string) => {
    const data = docs.get(path);
    return { id, exists: data !== undefined, data: () => data };
  };
  const write = (path: string, data: Data) => {
    docs.set(path, asStored(data));
    writes.push({ path, data });
  };
  const ref = (collection: string, id: string) => {
    const path = `${collection}/${id}`;
    return {
      id,
      path,
      get: () => Promise.resolve(snapshot(path, id)),
      set: (data: Data) => Promise.resolve(write(path, data)),
      create: (data: Data) =>
        docs.has(path)
          ? Promise.reject(Object.assign(new Error("ALREADY_EXISTS"), { code: 6 }))
          : Promise.resolve(write(path, data)),
    };
  };
  const getAll = vi.fn((...refs: Array<{ path: string; id: string }>) =>
    Promise.resolve(refs.map((r) => snapshot(r.path, r.id))),
  );
  let queue = Promise.resolve();
  const db = {
    collection: (name: string) => ({
      doc: (id: string) => ref(name, id),
      get: () =>
        Promise.resolve({
          docs: [...docs.entries()]
            .filter(([path]) => path.startsWith(`${name}/`))
            .map(([path, data]) => ({ id: path.slice(name.length + 1), data: () => data })),
        }),
      where: (field: string, _op: "==", value: unknown) => ({
        get: () =>
          Promise.resolve({
            docs: [...docs.entries()]
              .filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
              .map(([path, data]) => ({ id: path.slice(name.length + 1), data: () => data })),
          }),
      }),
    }),
    getAll,
    /**
     * Like Firestore: every read must come before the first write, and the writes are applied
     * only when the callback succeeds (an error rolls everything back).
     */
    runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      if (options.failWith) return Promise.reject(options.failWith);
      const run = queue.then(async () => {
        const pending: Array<() => void> = [];
        const later = (apply: () => void) => {
          pending.push(apply);
        };
        const result = await fn({
          get: (r: { path: string; id: string }) => {
            if (pending.length > 0) {
              throw new Error("Firestore transactions require all reads before all writes.");
            }
            return Promise.resolve(snapshot(r.path, r.id));
          },
          set: (r: { path: string }, data: Data) => later(() => write(r.path, data)),
          create: (r: { path: string }, data: Data) =>
            later(() => {
              if (docs.has(r.path)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
              write(r.path, data);
            }),
          update: (r: { path: string }, data: Data) =>
            later(() => write(r.path, { ...docs.get(r.path), ...data })),
          delete: (r: { path: string }) => later(() => docs.delete(r.path)),
        });
        for (const apply of pending) apply();
        return result;
      });
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  return { db, docs, writes, getAll };
}
