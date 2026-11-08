import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Transactor } from '@opsis/core';
import { sql as migration001 } from './migrations/001-initial.js';
import { sql as migration002 } from './migrations/002-draft-revision.js';
import { sql as migration003 } from './migrations/003-session-rebase.js';
import { sql as migration004 } from './migrations/004-upload-slots.js';

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: migration001 },
  { version: 2, name: 'draft-revision', sql: migration002 },
  { version: 3, name: 'session-rebase', sql: migration003 },
  { version: 4, name: 'upload-slots', sql: migration004 },
];

export type Params = Record<string, SQLInputValue>;

/**
 * Thin wrapper around `node:sqlite` providing pragmas, migrations and (nested)
 * transactions. All access is synchronous, so a transaction can never interleave
 * with other work on the event loop.
 */
export class Database implements Transactor {
  readonly connection: DatabaseSync;
  #depth = 0;

  private constructor(connection: DatabaseSync) {
    this.connection = connection;
  }

  /** Opens (or creates) the database and applies pending migrations. Use ':memory:' for tests. */
  static open(location: string): Database {
    const connection = new DatabaseSync(location, { enableForeignKeyConstraints: true });
    const db = new Database(connection);
    if (location !== ':memory:') connection.exec('PRAGMA journal_mode = WAL');
    connection.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    db.migrate();
    return db;
  }

  close(): void {
    this.connection.close();
  }

  run<T>(work: () => T): T {
    const savepoint = `sp_${this.#depth}`;
    const outermost = this.#depth === 0;
    this.connection.exec(outermost ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    this.#depth += 1;
    try {
      const result = work();
      if (result instanceof Promise) {
        throw new Error(
          'Transaction work must be synchronous; do async work before or after the transaction',
        );
      }
      this.#depth -= 1;
      this.connection.exec(outermost ? 'COMMIT' : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.#depth -= 1;
      this.connection.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    }
  }

  all(query: string, params: Params = {}): Record<string, unknown>[] {
    return this.connection.prepare(query).all(params);
  }

  get(query: string, params: Params = {}): Record<string, unknown> | undefined {
    return this.connection.prepare(query).get(params);
  }

  execute(query: string, params: Params = {}): number {
    return Number(this.connection.prepare(query).run(params).changes);
  }

  get schemaVersion(): number {
    const row = this.get('SELECT MAX(version) AS v FROM schema_migrations');
    return typeof row?.['v'] === 'number' ? row['v'] : 0;
  }

  private migrate(): void {
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    const current = this.schemaVersion;
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.run(() => {
        this.connection.exec(migration.sql);
        this.execute('INSERT INTO schema_migrations (version, name, applied_at) VALUES (:v, :n, :at)', {
          v: migration.version,
          n: migration.name,
          at: new Date().toISOString(),
        });
      });
    }
  }
}
