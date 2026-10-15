import { vi } from "vitest";

type Data = Record<string, unknown>;
type Doc = {
  id: string;
  exists: boolean;
  data: () => Data | undefined;
  get: (f: string) => unknown;
};

/** Firestore returns Timestamp objects for stored Dates; mimic that so adapters convert them. */
function asStored(data: Data): Data {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) =>
      value instanceof Date ? [key, { toDate: () => new Date(value.getTime()) }] : [key, value],
    ),
  );
}

const sortable = (value: unknown): string | number =>
  typeof value === "number"
    ? value
    : value && typeof value === "object" && "toDate" in value
      ? (value as { toDate(): Date }).toDate().getTime()
      : typeof value === "string"
        ? value
        : JSON.stringify(value ?? "");

/**
 * Minimal in-memory stand-in for the parts of the Firestore Admin SDK our adapters use:
 * documents, simple queries (==, array-contains, in, <=, >=, orderBy, startAfter, limit, count)
 * and transactions (serializable, reads before writes, writes applied only on success).
 */
export function fakeFirestore(options: { failWith?: Error } = {}) {
  const docs = new Map<string, Data>();
  const writes: Array<{ path: string; data: Data }> = [];
  // Like Firestore, a snapshot is a copy taken at read time.
  const snapshot = (path: string, id: string): Doc => {
    const data = docs.get(path);
    return { id, exists: data !== undefined, data: () => data, get: (f) => data?.[f] };
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

  type Filter = (data: Data) => boolean;
  const query = (
    name: string,
    filters: Filter[] = [],
    order: string[] = [],
    directions: Array<"asc" | "desc"> = [],
    after: unknown[] | null = null,
    max: number | null = null,
  ) => {
    const run = () => {
      let rows = [...docs.entries()]
        .filter(
          ([path]) => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes("/"),
        )
        .map(([path, data]) => ({ id: path.slice(name.length + 1), data }))
        .filter(({ data }) => filters.every((f) => f(data)));
      const compare = (a: Data, b: Data) => {
        for (const [i, field] of order.entries()) {
          const x = sortable(a[field]);
          const y = sortable(b[field]);
          if (x !== y) return (x < y ? -1 : 1) * (directions[i] === "desc" ? -1 : 1);
        }
        return 0;
      };
      if (order.length > 0) rows.sort((a, b) => compare(a.data, b.data));
      if (after) {
        const cursor = Object.fromEntries(order.map((f, i) => [f, after[i]]));
        rows = rows.filter(({ data }) => compare(data, cursor) > 0);
      }
      if (max !== null) rows = rows.slice(0, max);
      const result = rows.map(({ id, data }) => ({
        id,
        data: () => data,
        get: (f: string) => data[f],
      }));
      return { docs: result, size: result.length, empty: result.length === 0 };
    };
    return {
      __query: run,
      where(field: string, op: string, value: unknown) {
        const test: Filter = (data) => {
          const v = data[field];
          if (op === "==") return JSON.stringify(v) === JSON.stringify(value);
          if (op === "array-contains") return Array.isArray(v) && v.includes(value);
          if (op === "in") return (value as unknown[]).includes(v);
          if (op === ">=") return v !== undefined && sortable(v) >= sortable(value);
          if (op === "<=") return v !== undefined && sortable(v) <= sortable(value);
          throw new Error(`fake: unsupported op ${op}`);
        };
        return query(name, [...filters, test], order, directions, after, max);
      },
      orderBy(field: string, direction: "asc" | "desc" = "asc") {
        return query(name, filters, [...order, field], [...directions, direction], after, max);
      },
      startAfter(...values: unknown[]) {
        return query(name, filters, order, directions, values, max);
      },
      limit(n: number) {
        return query(name, filters, order, directions, after, n);
      },
      count() {
        return { get: () => Promise.resolve({ data: () => ({ count: run().size }) }) };
      },
      get: () => Promise.resolve(run()),
    };
  };

  const getAll = vi.fn((...refs: Array<{ path: string; id: string }>) =>
    Promise.resolve(refs.map((r) => snapshot(r.path, r.id))),
  );
  let queue = Promise.resolve();
  const db = {
    collection: (name: string) => ({ ...query(name), doc: (id: string) => ref(name, id) }),
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
          get: (target: { path: string; id: string } | { __query: () => unknown }) => {
            if (pending.length > 0) {
              throw new Error("Firestore transactions require all reads before all writes.");
            }
            return Promise.resolve(
              "__query" in target ? target.__query() : snapshot(target.path, target.id),
            );
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
