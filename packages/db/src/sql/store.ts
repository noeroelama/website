/**
 * MySQL 8 document store: the only place `mysql2` is imported (lint-enforced).
 *
 * Every collection is a table `(id, data JSON, dates JSON)`. The API is the small document API the
 * repositories in this folder use (documents, simple queries, transactions), so moving off
 * Firestore did not change any repository logic. Dates are stored as ISO strings (they sort and
 * compare correctly in JSON) and their paths are kept in `dates`, so reads give them back as
 * timestamps with `toDate()`.
 */
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { COLLECTIONS } from "./collections";

export type Data = Record<string, unknown>;
type Op = "==" | "in" | "array-contains" | "array-contains-any" | "<" | "<=" | ">" | ">=";
type Direction = "asc" | "desc";
type Runner = Pick<PoolConnection, "query">;

/** A stored date, read back like a Firestore Timestamp. */
export class StoredTimestamp {
  private readonly ms: number;
  constructor(ms: number) {
    this.ms = ms;
  }
  toDate(): Date {
    return new Date(this.ms);
  }
  toMillis(): number {
    return this.ms;
  }
}

/** Errors carry the gRPC-style codes callers already check (6 = exists, 5 = missing, 10 = aborted). */
const storeError = (message: string, code: 5 | 6 | 10) =>
  Object.assign(new Error(message), { code });

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/** Value → JSON-safe value; collects the paths of dates. */
function encode(
  value: unknown,
  path: Array<string | number>,
  dates: Array<Array<string | number>>,
): unknown {
  if (value instanceof Date || value instanceof StoredTimestamp) {
    const date = value instanceof Date ? value : value.toDate();
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid date at ${path.join(".")}.`);
    dates.push(path);
    return date.toISOString();
  }
  if (Array.isArray(value)) return value.map((v, i) => encode(v, [...path, i], dates));
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Numbers must be finite (${path.join(".")}).`);
  }
  if (value !== null && typeof value === "object") {
    if (!isPlainObject(value)) throw new Error(`Unsupported value at ${path.join(".")}.`);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, encode(v, [...path, k], dates)]),
    );
  }
  return value;
}

function encodeDoc(data: Data): { json: string; dates: string } {
  const dates: Array<Array<string | number>> = [];
  const encoded = encode(data, [], dates);
  return { json: JSON.stringify(encoded), dates: JSON.stringify(dates) };
}

/** JSON value used as a query parameter. */
const encodeValue = (value: unknown) => JSON.stringify(encode(value, [], []));

function decodeDoc(data: Data, dates: Array<Array<string | number>>): Data {
  for (const path of dates) {
    let node = data as Record<string | number, unknown>;
    for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
    const last = path[path.length - 1] as string | number;
    node[last] = new StoredTimestamp(Date.parse(node[last] as string));
  }
  return data;
}

/** "offer.expiresAt" → `$."offer"."expiresAt"` (bound as a parameter, never concatenated). */
const jsonPath = (field: string) =>
  `$${field
    .split(".")
    .map((key) => `."${key.replace(/["\\]/g, "\\$&")}"`)
    .join("")}`;

const fieldOf = (data: Data | undefined, field: string): unknown =>
  field.split(".").reduce<unknown>((node, key) => (node as Data | undefined)?.[key], data);

export interface DocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  readonly ref: DocumentReference;
  data(): Data | undefined;
  get(field: string): unknown;
}
/** A document returned by a query always exists. */
export interface QueryDocumentSnapshot extends DocumentSnapshot {
  data(): Data;
}
export interface QuerySnapshot {
  readonly docs: QueryDocumentSnapshot[];
  readonly size: number;
  readonly empty: boolean;
}

function snapshotOf(ref: DocumentReference, row: RowDataPacket | undefined): DocumentSnapshot {
  const data = row
    ? decodeDoc(row["data"] as Data, row["dates"] as Array<Array<string | number>>)
    : undefined;
  return {
    id: ref.id,
    ref,
    exists: data !== undefined,
    data: () => data,
    get: (field) => fieldOf(data, field),
  };
}

interface Engine {
  readonly ready: () => Promise<void>;
  readonly pool: Pool;
}

export class DocumentReference {
  private readonly engine: Engine;
  readonly table: string;
  readonly id: string;
  constructor(engine: Engine, table: string, id: string) {
    this.engine = engine;
    this.table = table;
    this.id = id;
  }
  get path() {
    return `${this.table}/${this.id}`;
  }
  async read(runner: Runner, lock: boolean): Promise<DocumentSnapshot> {
    const [rows] = await runner.query<RowDataPacket[]>(
      `SELECT data, dates FROM \`${this.table}\` WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
      [this.id],
    );
    return snapshotOf(this, rows[0]);
  }
  async get(): Promise<DocumentSnapshot> {
    await this.engine.ready();
    return this.read(this.engine.pool, false);
  }
  async set(data: Data): Promise<void> {
    await this.engine.ready();
    await writeSet(this.engine.pool, this, data);
  }
  async create(data: Data): Promise<void> {
    await this.engine.ready();
    await writeCreate(this.engine.pool, this, data);
  }
  update(data: Data): Promise<void> {
    return runTransaction(this.engine, (tx) => {
      tx.update(this, data);
      return Promise.resolve();
    });
  }
  delete(): Promise<void> {
    return runTransaction(this.engine, (tx) => {
      tx.delete(this);
      return Promise.resolve();
    });
  }
}

async function writeSet(runner: Runner, ref: DocumentReference, data: Data) {
  const { json, dates } = encodeDoc(data);
  await runner.query(
    `INSERT INTO \`${ref.table}\` (id, data, dates) VALUES (?, ?, ?) AS n
     ON DUPLICATE KEY UPDATE data = n.data, dates = n.dates`,
    [ref.id, json, dates],
  );
}

async function writeCreate(runner: Runner, ref: DocumentReference, data: Data) {
  const { json, dates } = encodeDoc(data);
  try {
    await runner.query(`INSERT INTO \`${ref.table}\` (id, data, dates) VALUES (?, ?, ?)`, [
      ref.id,
      json,
      dates,
    ]);
  } catch (error) {
    if ((error as { errno?: number }).errno === 1062) {
      throw storeError(`ALREADY_EXISTS: ${ref.path}`, 6);
    }
    throw error;
  }
}

interface Filter {
  readonly field: string;
  readonly op: Op;
  readonly value: unknown;
}

type Order = ReadonlyArray<{ field: string; direction: Direction }>;

export class Query {
  protected readonly engine: Engine;
  readonly table: string;
  private readonly filters: readonly Filter[];
  private readonly order: Order;
  private readonly cursor: readonly unknown[] | null;
  private readonly max: number | null;
  constructor(
    engine: Engine,
    table: string,
    filters: readonly Filter[] = [],
    order: Order = [],
    cursor: readonly unknown[] | null = null,
    max: number | null = null,
  ) {
    this.engine = engine;
    this.table = table;
    this.filters = filters;
    this.order = order;
    this.cursor = cursor;
    this.max = max;
  }

  where(field: string, op: Op, value: unknown): Query {
    return new Query(
      this.engine,
      this.table,
      [...this.filters, { field, op, value }],
      this.order,
      this.cursor,
      this.max,
    );
  }
  orderBy(field: string, direction: Direction = "asc"): Query {
    return new Query(
      this.engine,
      this.table,
      this.filters,
      [...this.order, { field, direction }],
      this.cursor,
      this.max,
    );
  }
  startAfter(...values: unknown[]): Query {
    return new Query(this.engine, this.table, this.filters, this.order, values, this.max);
  }
  limit(n: number): Query {
    return new Query(this.engine, this.table, this.filters, this.order, this.cursor, n);
  }

  /** WHERE clause and its parameters, pushed in placeholder order (paths and values are bound). */
  private where_(): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    const FIELD = "JSON_EXTRACT(data, ?)";
    const VALUE = "CAST(? AS JSON)";
    for (const { field, op, value } of this.filters) {
      const path = jsonPath(field);
      if (op === "in" || op === "array-contains-any") {
        const list = value as unknown[];
        if (list.length === 0) {
          parts.push("FALSE");
          continue;
        }
        const tests = list.map((item) => {
          if (op === "in") {
            params.push(path, encodeValue(item));
            return `${FIELD} = ${VALUE}`;
          }
          params.push(encodeValue(item), path);
          return `${VALUE} MEMBER OF (${FIELD})`;
        });
        parts.push(`(${tests.join(" OR ")})`);
      } else if (op === "array-contains") {
        params.push(encodeValue(value), path);
        parts.push(`${VALUE} MEMBER OF (${FIELD})`);
      } else if (op === "==") {
        params.push(path, encodeValue(value));
        parts.push(`${FIELD} = ${VALUE}`);
      } else {
        // Ranges never match a null field (Firestore compares only values of the same type).
        params.push(path, encodeValue(value), path);
        parts.push(`${FIELD} ${op} ${VALUE} AND JSON_TYPE(${FIELD}) <> 'NULL'`);
      }
    }
    // Like Firestore, ordering by a field leaves out documents without it.
    for (const { field } of this.order) {
      params.push(jsonPath(field));
      parts.push(`${FIELD} IS NOT NULL`);
    }
    if (this.cursor) {
      const after = this.cursor;
      const ors = after.map((_, i) => {
        const ands = this.order.slice(0, i + 1).map(({ field, direction }, j) => {
          params.push(jsonPath(field), encodeValue(after[j]));
          const op = j < i ? "=" : direction === "desc" ? "<" : ">";
          return `${FIELD} ${op} ${VALUE}`;
        });
        return `(${ands.join(" AND ")})`;
      });
      parts.push(`(${ors.join(" OR ")})`);
    }
    return { sql: parts.length > 0 ? ` WHERE ${parts.join(" AND ")}` : "", params };
  }

  async read(runner: Runner, lock: boolean): Promise<QuerySnapshot> {
    const { sql, params } = this.where_();
    const orderBy = [
      ...this.order.map(({ field, direction }) => {
        params.push(jsonPath(field));
        return `JSON_EXTRACT(data, ?) ${direction === "desc" ? "DESC" : "ASC"}`;
      }),
      "id",
    ].join(", ");
    const limit = this.max === null ? "" : ` LIMIT ${Math.max(0, Math.trunc(this.max))}`;
    const [rows] = await runner.query<RowDataPacket[]>(
      `SELECT id, data, dates FROM \`${this.table}\`${sql} ORDER BY ${orderBy}${limit}${lock ? " FOR UPDATE" : ""}`,
      params,
    );
    const docs = rows.map(
      (row) =>
        snapshotOf(
          new DocumentReference(this.engine, this.table, row["id"] as string),
          row,
        ) as QueryDocumentSnapshot,
    );
    return { docs, size: docs.length, empty: docs.length === 0 };
  }

  async get(): Promise<QuerySnapshot> {
    await this.engine.ready();
    return this.read(this.engine.pool, false);
  }

  count() {
    return {
      get: async () => {
        await this.engine.ready();
        const { sql, params } = this.where_();
        const [rows] = await this.engine.pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM \`${this.table}\`${sql}`,
          params,
        );
        const count = Number(rows[0]?.["n"] ?? 0);
        return { data: () => ({ count }) };
      },
    };
  }
}

export class CollectionReference extends Query {
  doc(id: string): DocumentReference {
    return new DocumentReference(this.engine, this.table, id);
  }
}

type Write =
  | { kind: "set" | "create" | "update"; ref: DocumentReference; data: Data }
  | { kind: "delete"; ref: DocumentReference };

async function applyWrite(runner: Runner, write: Write) {
  if (write.kind === "set") return writeSet(runner, write.ref, write.data);
  if (write.kind === "create") return writeCreate(runner, write.ref, write.data);
  if (write.kind === "delete") {
    await runner.query(`DELETE FROM \`${write.ref.table}\` WHERE id = ?`, [write.ref.id]);
    return;
  }
  const current = await write.ref.read(runner, true);
  if (!current.exists) throw storeError(`NOT_FOUND: ${write.ref.path}`, 5);
  await writeSet(runner, write.ref, { ...current.data(), ...write.data });
}

/**
 * Like a Firestore transaction: reads lock the rows they read (`FOR UPDATE`), every read comes
 * before the first write, and the writes are applied together at the end.
 */
export class Transaction {
  readonly writes: Write[] = [];
  private readonly connection: PoolConnection;
  constructor(connection: PoolConnection) {
    this.connection = connection;
  }

  get(target: DocumentReference): Promise<DocumentSnapshot>;
  get(target: Query): Promise<QuerySnapshot>;
  get(target: DocumentReference | Query): Promise<DocumentSnapshot | QuerySnapshot> {
    if (this.writes.length > 0) {
      throw new Error("Transactions require all reads before all writes.");
    }
    return target.read(this.connection, true);
  }
  set(ref: DocumentReference, data: Data): this {
    this.writes.push({ kind: "set", ref, data });
    return this;
  }
  create(ref: DocumentReference, data: Data): this {
    this.writes.push({ kind: "create", ref, data });
    return this;
  }
  update(ref: DocumentReference, data: Data): this {
    this.writes.push({ kind: "update", ref, data });
    return this;
  }
  delete(ref: DocumentReference): this {
    this.writes.push({ kind: "delete", ref });
    return this;
  }
}

/** Deadlock (1213) and lock wait timeout (1205): retried like Firestore retries contention. */
const RETRYABLE = new Set([1205, 1213]);
const ATTEMPTS = 5;

async function runTransaction<T>(engine: Engine, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  await engine.ready();
  for (let attempt = 1; ; attempt++) {
    const connection = await engine.pool.getConnection();
    try {
      await connection.beginTransaction();
      const tx = new Transaction(connection);
      const result = await fn(tx);
      for (const write of tx.writes) await applyWrite(connection, write);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      const retryable = RETRYABLE.has((error as { errno?: number }).errno ?? 0);
      if (retryable && attempt < ATTEMPTS) continue;
      if (retryable) throw storeError("ABORTED: too much contention, try again.", 10);
      throw error;
    } finally {
      connection.release();
    }
  }
}

export interface Database {
  collection(name: string): CollectionReference;
  /** `doc("users/u1")` (ops scripts). */
  doc(path: string): DocumentReference;
  getAll(...refs: DocumentReference[]): Promise<DocumentSnapshot[]>;
  runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  /** Writes without reads, applied together (ops scripts). */
  batch(): {
    set(ref: DocumentReference, data: Data): void;
    update(ref: DocumentReference, data: Data): void;
    delete(ref: DocumentReference): void;
    commit(): Promise<void>;
  };
  close(): Promise<void>;
}

const DDL = (table: string) =>
  `CREATE TABLE IF NOT EXISTS \`${table}\` (
    id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
    data JSON NOT NULL,
    dates JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

/** Creates missing tables (one table per collection in ./collections.ts). */
async function ensureTables(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  );
  const existing = new Set(rows.map((row) => row["name"] as string));
  for (const table of COLLECTIONS) if (!existing.has(table)) await pool.query(DDL(table));
}

export interface DatabaseConfig {
  /** `mysql://user:password@host:3306/database` */
  readonly url: string;
  /** Connections per server process (shared hosting: keep it small). */
  readonly connectionLimit?: number | undefined;
}

const databases = new Map<string, Database>();

/**
 * One pool per database URL per server process, reused for every request (never one connection
 * per request). Tables are created on first use.
 */
export function getDatabase(config: DatabaseConfig): Database {
  const cached = databases.get(config.url);
  if (cached) return cached;
  const pool = createPool({
    uri: config.url,
    connectionLimit: config.connectionLimit ?? 5,
    charset: "utf8mb4",
    timezone: "Z",
  });
  let ready: Promise<void> | null = null;
  const engine: Engine = {
    pool,
    ready: () => {
      ready ??= ensureTables(pool).catch((error: unknown) => {
        ready = null; // try again on the next call
        throw error;
      });
      return ready;
    },
  };
  const collection = (name: string) => {
    if (!(COLLECTIONS as readonly string[]).includes(name)) {
      throw new Error(
        `Unknown collection "${name}": add it to packages/db/src/sql/collections.ts.`,
      );
    }
    return new CollectionReference(engine, name);
  };
  const db: Database = {
    collection,
    doc(path) {
      const [name, id, ...rest] = path.split("/");
      if (!name || !id || rest.length > 0)
        throw new Error(`Expected "collection/id", got "${path}".`);
      return collection(name).doc(id);
    },
    async getAll(...refs) {
      if (refs.length === 0) return [];
      await engine.ready();
      const found = new Map<string, RowDataPacket>();
      for (const table of new Set(refs.map((r) => r.table))) {
        const ids = refs.filter((r) => r.table === table).map((r) => r.id);
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT id, data, dates FROM \`${table}\` WHERE id IN (?)`,
          [ids],
        );
        for (const row of rows) found.set(`${table}/${row["id"] as string}`, row);
      }
      return refs.map((ref) => snapshotOf(ref, found.get(ref.path)));
    },
    runTransaction: (fn) => runTransaction(engine, fn),
    batch() {
      const writes: Write[] = [];
      return {
        set: (ref, data) => void writes.push({ kind: "set", ref, data }),
        update: (ref, data) => void writes.push({ kind: "update", ref, data }),
        delete: (ref) => void writes.push({ kind: "delete", ref }),
        commit: () =>
          runTransaction(engine, (tx) => {
            tx.writes.push(...writes);
            return Promise.resolve();
          }),
      };
    },
    async close() {
      databases.delete(config.url);
      await pool.end();
    },
  };
  databases.set(config.url, db);
  return db;
}
