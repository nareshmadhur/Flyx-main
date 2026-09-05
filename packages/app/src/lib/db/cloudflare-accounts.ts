import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface Account {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface StoredAccount extends Account {
  passwordHash: string;
}

function getDb(): any {
  const { env } = getCloudflareContext();
  const db = (env as any).DB;

  if (!db) {
    throw new Error("Cloudflare D1 binding 'DB' is not configured");
  }

  return db;
}

let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getDb();

      await db
        .prepare(`
          CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            passwordHash TEXT NOT NULL,
            isAdmin INTEGER NOT NULL DEFAULT 0,
            createdAt TEXT NOT NULL
          )
        `)
        .run();

      await db
        .prepare(`
          CREATE INDEX IF NOT EXISTS idx_accounts_username
          ON accounts(username)
        `)
        .run();
    })();
  }

  await schemaReady;
}

function mapAccount(row: any): StoredAccount {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    isAdmin: Boolean(row.isAdmin),
    createdAt: row.createdAt,
  };
}

export async function findAccountByUsername(
  username: string,
): Promise<StoredAccount | null> {
  await ensureSchema();

  const row = await getDb()
    .prepare(`
      SELECT id, username, passwordHash, isAdmin, createdAt
      FROM accounts
      WHERE username = ?
      LIMIT 1
    `)
    .bind(username)
    .first();

  return row ? mapAccount(row) : null;
}

export async function findAccountById(
  id: string,
): Promise<Account | null> {
  await ensureSchema();

  const row = await getDb()
    .prepare(`
      SELECT id, username, passwordHash, isAdmin, createdAt
      FROM accounts
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();

  if (!row) return null;

  const account = mapAccount(row);

  return {
    id: account.id,
    username: account.username,
    isAdmin: account.isAdmin,
    createdAt: account.createdAt,
  };
}

export async function createAccount(
  username: string,
  passwordHash: string,
  isAdmin = false,
): Promise<Account> {
  await ensureSchema();

  const existing = await findAccountByUsername(username);

  if (existing) {
    throw new Error(`Account "${username}" already exists`);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await getDb()
    .prepare(`
      INSERT INTO accounts (
        id,
        username,
        passwordHash,
        isAdmin,
        createdAt
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      username,
      passwordHash,
      isAdmin ? 1 : 0,
      createdAt,
    )
    .run();

  return {
    id,
    username,
    isAdmin,
    createdAt,
  };
}

export async function getAccountCount(): Promise<number> {
  await ensureSchema();

  const row = await getDb()
    .prepare("SELECT COUNT(*) AS count FROM accounts")
    .first();

  return Number(row?.count ?? 0);
}

export async function listAccounts(): Promise<Account[]> {
  await ensureSchema();

  const result = await getDb()
    .prepare(`
      SELECT id, username, isAdmin, createdAt
      FROM accounts
      ORDER BY createdAt ASC
    `)
    .all();

  return (result.results ?? []).map((row: any) => ({
    id: row.id,
    username: row.username,
    isAdmin: Boolean(row.isAdmin),
    createdAt: row.createdAt,
  }));
}

export async function deleteAccount(id: string): Promise<boolean> {
  await ensureSchema();

  const result = await getDb()
    .prepare("DELETE FROM accounts WHERE id = ?")
    .bind(id)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

export async function updateAccountPassword(
  id: string,
  passwordHash: string,
): Promise<boolean> {
  await ensureSchema();

  const result = await getDb()
    .prepare(`
      UPDATE accounts
      SET passwordHash = ?
      WHERE id = ?
    `)
    .bind(passwordHash, id)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}
