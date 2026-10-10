import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Main app database — a single long-lived better-sqlite3 connection, schema
 * applied from schema.sql on first import. DATA_DIR/YOUTUBE_DB_PATH are the
 * only things that vary between environments; there is nothing else to
 * configure.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
export const DB_PATH = process.env.YOUTUBE_DB_PATH ?? path.join(DATA_DIR, 'youtube.db');

mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(process.cwd(), 'schema.sql');
db.exec(readFileSync(schemaPath, 'utf8'));

export function dbQuery<T = unknown>(sql: string, params: unknown[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

/** For INSERT/UPDATE/DELETE/DDL. Returns the underlying RunResult (lastInsertRowid, changes). */
export function dbExec(sql: string, params: unknown[] = []): Database.RunResult {
  return db.prepare(sql).run(...params);
}

export interface DbStatement {
  sql: string;
  params?: unknown[];
}

/** Runs multiple statements in one transaction — all succeed or all roll back. */
export function dbTransaction(statements: DbStatement[]): void {
  if (!statements.length) return;
  const run = db.transaction((stmts: DbStatement[]) => {
    for (const s of stmts) db.prepare(s.sql).run(...(s.params ?? []));
  });
  run(statements);
}

export default db;
