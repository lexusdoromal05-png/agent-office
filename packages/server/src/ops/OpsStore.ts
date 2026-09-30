import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { ActionType, CommandKind, OpsItem, RawRecord, SystemId } from './types';

export type ActionStatus = 'pending' | 'rejected' | 'executed' | 'failed';

export interface StoredAction {
    id: number;
    type: ActionType;
    target: string;
    body: string;
    reason: string;
    sourceIds: string[];
    status: ActionStatus;
    result: string;
    createdAt: string;
    updatedAt: string;
}

export interface StoredBrief {
    id: number;
    command: CommandKind;
    arg: string;
    text: string;
    createdAt: string;
}

export interface TrackedItem extends OpsItem {
    open: boolean;
    firstSeen: string;
    lastSeen: string;
}

export class OpsStore {
    private db?: Database;

    async initialize(dbPath: string = process.env.OPS_DB_PATH || './data/ops.db') {
        const { mkdir } = await import('fs/promises');
        const path = await import('path');
        if (dbPath !== ':memory:') await mkdir(path.dirname(dbPath), { recursive: true });

        this.db = await open({ filename: dbPath, driver: sqlite3.Database });
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS inbox (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                system TEXT NOT NULL,
                external_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                author TEXT NOT NULL,
                channel TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                url TEXT NOT NULL DEFAULT '',
                meta_json TEXT NOT NULL DEFAULT '{}',
                UNIQUE (system, external_id)
            );
            CREATE INDEX IF NOT EXISTS idx_inbox_time ON inbox(system, timestamp);

            CREATE TABLE IF NOT EXISTS briefs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command TEXT NOT NULL,
                arg TEXT NOT NULL DEFAULT '',
                text TEXT NOT NULL,
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            CREATE TABLE IF NOT EXISTS ops_items (
                key TEXT PRIMARY KEY,
                data_json TEXT NOT NULL,
                open INTEGER NOT NULL DEFAULT 1,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                target TEXT NOT NULL,
                body TEXT NOT NULL,
                reason TEXT NOT NULL,
                source_ids_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'pending',
                result TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);
    }

    private get conn(): Database {
        if (!this.db) throw new Error('Ops store is not initialized');
        return this.db;
    }

    // ─── Inbox: messages pushed in by webhooks (WhatsApp) or the ingest API ───

    async addInbox(record: RawRecord): Promise<boolean> {
        const result = await this.conn.run(
            `INSERT OR IGNORE INTO inbox (system, external_id, kind, author, channel, text, timestamp, url, meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [record.system, record.externalId, record.kind, record.author, record.channel, record.text,
                record.timestamp, record.url, JSON.stringify(record.meta || {})]
        );
        return (result.changes || 0) > 0;
    }

    async listInbox(system: SystemId, since: Date, limit = 300): Promise<RawRecord[]> {
        const rows = await this.conn.all(
            'SELECT * FROM inbox WHERE system = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?',
            [system, since.toISOString(), limit]
        );
        return rows.map((r) => ({
            system: r.system, externalId: r.external_id, kind: r.kind, author: r.author, channel: r.channel,
            text: r.text, timestamp: r.timestamp, url: r.url, meta: JSON.parse(r.meta_json),
        }));
    }

    async countInbox(system: SystemId): Promise<number> {
        const row = await this.conn.get('SELECT COUNT(*) AS n FROM inbox WHERE system = ?', [system]);
        return row?.n || 0;
    }

    // ─── Briefs ───

    async saveBrief(command: CommandKind, arg: string, text: string): Promise<StoredBrief> {
        const result = await this.conn.run('INSERT INTO briefs (command, arg, text) VALUES (?, ?, ?)', [command, arg, text]);
        const row = await this.conn.get('SELECT * FROM briefs WHERE id = ?', [result.lastID]);
        return { id: row.id, command: row.command, arg: row.arg, text: row.text, createdAt: row.created_at };
    }

    async listBriefs(limit = 20): Promise<StoredBrief[]> {
        const rows = await this.conn.all('SELECT * FROM briefs ORDER BY id DESC LIMIT ?', [limit]);
        return rows.map((row) => ({ id: row.id, command: row.command, arg: row.arg, text: row.text, createdAt: row.created_at }));
    }

    // ─── Operational model: persistent items updated on every run, never rebuilt from scratch ───

    async upsertItems(items: OpsItem[]): Promise<void> {
        const now = new Date().toISOString();
        for (const item of items) {
            const isOpen = item.status === 'Done (verified)' ? 0 : 1;
            await this.conn.run(
                `INSERT INTO ops_items (key, data_json, open, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json, open = excluded.open, last_seen = excluded.last_seen`,
                [item.key, JSON.stringify(item), isOpen, now, now]
            );
        }
    }

    async listItems(openOnly = true, limit = 60): Promise<TrackedItem[]> {
        const rows = await this.conn.all(
            `SELECT * FROM ops_items ${openOnly ? 'WHERE open = 1' : ''} ORDER BY last_seen DESC LIMIT ?`,
            [limit]
        );
        return rows.map((r) => ({ ...JSON.parse(r.data_json), open: Boolean(r.open), firstSeen: r.first_seen, lastSeen: r.last_seen }));
    }

    async closeItem(key: string): Promise<boolean> {
        const result = await this.conn.run('UPDATE ops_items SET open = 0 WHERE key = ?', [key]);
        return (result.changes || 0) > 0;
    }

    // ─── Proposed external actions (never executed without approval) ───

    async addAction(a: { type: ActionType; target: string; body: string; reason: string; sourceIds: string[] }): Promise<StoredAction> {
        const result = await this.conn.run(
            'INSERT INTO actions (type, target, body, reason, source_ids_json) VALUES (?, ?, ?, ?, ?)',
            [a.type, a.target, a.body, a.reason, JSON.stringify(a.sourceIds)]
        );
        return (await this.getAction(result.lastID!))!;
    }

    async getAction(id: number): Promise<StoredAction | null> {
        const row = await this.conn.get('SELECT * FROM actions WHERE id = ?', [id]);
        return row ? this.toAction(row) : null;
    }

    async listActions(limit = 50): Promise<StoredAction[]> {
        const rows = await this.conn.all('SELECT * FROM actions ORDER BY id DESC LIMIT ?', [limit]);
        return rows.map((r) => this.toAction(r));
    }

    async updateAction(id: number, fields: { status?: ActionStatus; result?: string; body?: string; target?: string }): Promise<StoredAction | null> {
        const sets: string[] = [];
        const values: any[] = [];
        for (const [column, value] of Object.entries(fields)) {
            if (value === undefined) continue;
            sets.push(`${column} = ?`);
            values.push(value);
        }
        if (sets.length) {
            sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
            await this.conn.run(`UPDATE actions SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
        }
        return this.getAction(id);
    }

    private toAction(row: any): StoredAction {
        return {
            id: row.id, type: row.type, target: row.target, body: row.body, reason: row.reason,
            sourceIds: JSON.parse(row.source_ids_json), status: row.status, result: row.result,
            createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }

    // ─── Settings ───

    async getSetting(key: string): Promise<string> {
        const row = await this.conn.get('SELECT value FROM settings WHERE key = ?', [key]);
        return row ? row.value : '';
    }

    async setSetting(key: string, value: string): Promise<void> {
        await this.conn.run(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [key, value]
        );
    }

    async close() {
        await this.db?.close();
    }
}
