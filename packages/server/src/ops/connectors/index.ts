import { Connector, ConnectorStatus, RawRecord, SearchScope, SourceRecord } from '../types';
import { OpsStore } from '../OpsStore';
import { isMe, matchAccounts, matchPeople, mentionsMe } from '../watchlist';
import { slack } from './slack';
import { calendar, drive, gmail } from './google';
import { jira } from './jira';
import { notion } from './notion';
import { discord } from './discord';
import { ingestConnector, whatsappConnector } from './inbox';

// Sweep order follows the daily sweep checklist.
export function buildConnectors(store: OpsStore): Connector[] {
    return [slack, whatsappConnector(store), gmail, jira, calendar, drive, notion, discord, ingestConnector(store)];
}

export interface SweepResult {
    records: SourceRecord[];
    statuses: ConnectorStatus[];
}

export function describeConnectors(connectors: Connector[]): ConnectorStatus[] {
    return connectors.map((c) => {
        const absent = c.missingConfig();
        return {
            system: c.system, label: c.label, connected: !absent, ok: !absent, records: 0, incomplete: false,
            reason: absent ? `Not connected (set ${absent})` : '', impact: absent ? c.impact : '',
        };
    });
}

// Reads every configured connector in parallel, once per scope. One failing connector never
// stops the sweep: it becomes an ACCESS GAP and the rest continue.
export async function sweep(connectors: Connector[], scopes: SearchScope[]): Promise<SweepResult> {
    const statuses: ConnectorStatus[] = [];
    const raw: RawRecord[] = [];

    await Promise.all(connectors.map(async (c) => {
        const absent = c.missingConfig();
        if (absent) {
            statuses.push({ system: c.system, label: c.label, connected: false, ok: false, records: 0, incomplete: false, reason: `Not connected (set ${absent})`, impact: c.impact });
            return;
        }
        const notes: string[] = [];
        let count = 0;
        try {
            for (const scope of scopes) {
                const result = await c.read(scope);
                raw.push(...result.records);
                count += result.records.length;
                if (result.incomplete) notes.push(result.incomplete);
            }
            statuses.push({
                system: c.system, label: c.label, connected: true, ok: !notes.length, records: count,
                incomplete: notes.length > 0, reason: notes.length ? `Incomplete: ${Array.from(new Set(notes)).join('; ')}` : '',
                impact: notes.length ? `Some ${c.label} activity may be missing from this view.` : '',
            });
        } catch (e: any) {
            statuses.push({
                system: c.system, label: c.label, connected: true, ok: false, records: count, incomplete: false,
                reason: `Read failed: ${String(e?.message || e).slice(0, 200)}`, impact: c.impact,
            });
        }
    }));

    const order = connectors.map((c) => c.system);
    statuses.sort((a, b) => order.indexOf(a.system) - order.indexOf(b.system));
    return { records: annotate(raw), statuses };
}

// Adds short citation IDs and watchlist tags, newest first.
export function annotate(raw: RawRecord[]): SourceRecord[] {
    const seen = new Set<string>();
    return raw
        .filter((r) => {
            const key = `${r.system}:${r.externalId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .map((r, i) => {
            const haystack = `${r.channel}\n${r.text}`;
            return {
                ...r,
                id: `R${i + 1}`,
                accounts: matchAccounts(haystack),
                people: Array.from(new Set([...matchPeople(r.author), ...matchPeople(haystack)])),
                mentionsMe: r.mentionsMe ?? mentionsMe(r.text),
                fromMe: r.fromMe ?? isMe(r.author),
            };
        });
}
