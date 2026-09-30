import {
    ACTION_TYPES, ClientPicture, FollowUpCheck, ITEM_CATEGORIES, ITEM_STATUSES, ItemCategory, ItemStatus,
    Mood, MOODS, OpsItem, Priority, ProposedAction, SourceRecord, Statement,
} from './types';
import { matchPeople } from './watchlist';

export const STALE_AFTER_MS = 48 * 3_600_000;
const MAX_LOOKBACK_MS = 14 * 86_400_000;

// Start of the previous working day (Mon-Fri) in server local time.
export function previousWorkingDayStart(now: Date): Date {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    do {
        d.setDate(d.getDate() - 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return d;
}

// Daily sweep window: since the last executive sweep, or since the previous working day
// when there has been none. Never looks back more than two weeks.
export function sweepSince(lastSweepAt: string, now: Date): Date {
    const floor = new Date(now.getTime() - MAX_LOOKBACK_MS);
    const last = lastSweepAt ? new Date(lastSweepAt) : null;
    const since = last && !Number.isNaN(last.getTime()) ? last : previousWorkingDayStart(now);
    return since < floor ? floor : since;
}

export function sameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// What the model sees: the most operationally relevant records, clipped.
export function selectRecords(records: SourceRecord[], cap: number): SourceRecord[] {
    const score = (r: SourceRecord) =>
        (r.mentionsMe ? 8 : 0) + (r.accounts.length ? 5 : 0) + (r.people.length ? 3 : 0)
        + (r.system === 'calendar' || r.system === 'jira' ? 4 : 0) + (r.kind === 'dm' ? 4 : 0)
        + (r.system === 'whatsapp' ? 3 : 0) + (r.meta?.watched === 'true' ? 6 : 0);
    return [...records]
        .map((r, i) => ({ r, i, s: score(r) }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .slice(0, cap)
        .map(({ r }) => r)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function formatRecordsForPrompt(records: SourceRecord[], textLimit = 600): string {
    return records.map((r) => {
        const tags = [
            r.accounts.length ? `accounts=${r.accounts.join('/')}` : '',
            r.mentionsMe ? 'mentions-user' : '',
            r.fromMe ? 'from-user' : '',
            ...Object.entries(r.meta || {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`),
        ].filter(Boolean).join(' ');
        const text = r.text.length > textLimit ? `${r.text.slice(0, textLimit)}…` : r.text;
        return `[${r.id}] ${r.system} | ${r.timestamp} | ${r.channel} | from ${r.author}${tags ? ` | ${tags}` : ''}\n${text}`;
    }).join('\n\n');
}

export function followUpCheck(person: string, records: SourceRecord[], now: Date): FollowUpCheck {
    const newestFirst = [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const fromPerson = (r: SourceRecord) => matchPeople(r.author).includes(person);
    const lastRequest = newestFirst.find((r) => r.fromMe && !fromPerson(r) && r.people.includes(person)) || null;
    const lastResponse = newestFirst.find(fromPerson) || null;
    return {
        person,
        lastRequest,
        lastResponse,
        followUpSentToday: Boolean(lastRequest && sameLocalDay(new Date(lastRequest.timestamp), now)),
    };
}

const str = (v: any, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: any, allowed: readonly T[], fallback: T): T => {
    const s = str(v).toLowerCase();
    return allowed.find((a) => a.toLowerCase() === s) || fallback;
};

export function itemKey(account: string, title: string): string {
    return `${account}|${title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '-').replace(/-+/g, '-').slice(0, 160);
}

function citedIds(v: any, known: Map<string, SourceRecord>): string[] {
    const ids = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [];
    return Array.from(new Set(ids.map((id: any) => str(id).toUpperCase()).filter((id: string) => known.has(id))));
}

export interface Analysis {
    items: OpsItem[];
    clients: ClientPicture[];
    proposedActions: ProposedAction[];
    followUps: Record<string, { outstanding: boolean; missing: string }>;
    questions: string[];
    answer: string;
}

// Turns the model's JSON into trusted structures. Anything that cites a record we did not
// read is flagged as unsourced; client mood without client evidence becomes Unknown.
export function validateAnalysis(raw: any, records: SourceRecord[], now: Date): Analysis {
    const known = new Map(records.map((r) => [r.id, r]));

    const items: OpsItem[] = (Array.isArray(raw?.items) ? raw.items : [])
        .filter((i: any) => str(i?.title))
        .map((i: any): OpsItem => {
            const sourceIds = citedIds(i.sourceIds, known);
            const sources = sourceIds.map((id) => known.get(id)!);
            const lastEvidenceAt = sources.map((s) => s.timestamp).sort().pop() || '';
            let status = oneOf<ItemStatus>(i.status, ITEM_STATUSES, 'Unknown');
            // Chat alone never verifies completion.
            if (status === 'Done (verified)' && !sources.some((s) => ['jira', 'drive', 'notion', 'ingest'].includes(s.system))) {
                status = 'Done (unconfirmed)';
            }
            const title = str(i.title, 160);
            const account = str(i.account, 60);
            return {
                key: itemKey(account, title),
                title,
                priority: oneOf<Priority>(i.priority, ['P0', 'P1', 'P2', 'P3'], 'P2'),
                status,
                category: oneOf<ItemCategory>(i.category, ITEM_CATEGORIES, 'risk'),
                account,
                owner: str(i.owner, 80),
                deadline: str(i.deadline, 60),
                summary: str(i.summary),
                conflict: str(i.conflict),
                remainingAction: str(i.remainingAction, 300),
                definitionOfDone: str(i.definitionOfDone, 300),
                why: str(i.why, 300),
                sourceIds,
                sources: sources.map((s) => ({ id: s.id, system: s.system, author: s.author, timestamp: s.timestamp, url: s.url })),
                unsourced: sourceIds.length === 0,
                lastEvidenceAt,
                stale: !lastEvidenceAt || now.getTime() - new Date(lastEvidenceAt).getTime() > STALE_AFTER_MS,
            };
        })
        .sort((a: OpsItem, b: OpsItem) => Number(a.unsourced) - Number(b.unsourced));

    const statement = (s: any): Statement | null => {
        const id = str(s?.sourceId).toUpperCase();
        return str(s?.text) && known.has(id) ? { text: str(s.text), sourceId: id } : null;
    };

    const clients: ClientPicture[] = (Array.isArray(raw?.clients) ? raw.clients : [])
        .filter((c: any) => str(c?.account))
        .map((c: any): ClientPicture => {
            const moodEvidence = citedIds(c.moodEvidence, known);
            const mood = oneOf<Mood>(c.mood, MOODS, 'Unknown');
            return {
                account: str(c.account, 60),
                mood: moodEvidence.length ? mood : 'Unknown',
                moodEvidence,
                clientSaid: (c.clientSaid || []).map(statement).filter(Boolean),
                teamSaid: (c.teamSaid || []).map(statement).filter(Boolean),
                currentReality: str(c.currentReality),
                openActions: (Array.isArray(c.openActions) ? c.openActions : []).map((a: any) => str(a, 300)).filter(Boolean),
                risk: str(c.risk),
                recommendedResponse: str(c.recommendedResponse),
                lastInteraction: known.has(str(c.lastInteraction).toUpperCase()) ? str(c.lastInteraction).toUpperCase() : '',
            };
        });

    const proposedActions: ProposedAction[] = (Array.isArray(raw?.proposedActions) ? raw.proposedActions : [])
        .filter((a: any) => str(a?.body))
        .map((a: any) => ({
            type: oneOf(a.type, ACTION_TYPES, 'other'),
            target: str(a.target, 200),
            body: str(a.body, 4000),
            reason: str(a.reason, 300),
            sourceIds: citedIds(a.sourceIds, known),
        }));

    const followUps: Analysis['followUps'] = {};
    for (const [person, v] of Object.entries<any>(raw?.followUpOutstanding || {})) {
        if (v && typeof v === 'object') followUps[person] = { outstanding: Boolean(v.outstanding), missing: str(v.missing, 300) };
    }

    return {
        items,
        clients,
        proposedActions,
        followUps,
        questions: (Array.isArray(raw?.questionsForUser) ? raw.questionsForUser : []).map((q: any) => str(q, 300)).filter(Boolean),
        answer: str(raw?.answer, 4000),
    };
}
