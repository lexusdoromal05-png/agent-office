// One distinct statement pulled from a connected system (STEP 1 RAW EXTRACTION).
// Records are kept verbatim before any consolidation so every claim can be traced back.
export interface SourceRecord {
    id: string;              // Short stable reference the LLM cites, e.g. "R12"
    system: SystemId;
    externalId: string;      // ID inside the source system (message ts, ticket key, file id…)
    kind: string;            // message | email | ticket | event | file | page | ingest
    author: string;
    channel: string;         // Slack channel, email subject, Jira project, calendar name…
    text: string;
    timestamp: string;       // ISO time of the statement itself
    url: string;
    accounts: string[];      // Watched accounts this record mentions
    people: string[];        // Watched people who authored or are named in it
    mentionsMe: boolean;
    fromMe: boolean;
    meta: Record<string, string>;
}

export type SystemId =
    | 'slack' | 'gmail' | 'calendar' | 'drive' | 'jira' | 'notion' | 'discord' | 'whatsapp' | 'ingest';

export type RawRecord = Omit<SourceRecord, 'id' | 'accounts' | 'people' | 'mentionsMe' | 'fromMe'>
    & Partial<Pick<SourceRecord, 'mentionsMe' | 'fromMe'>>;

export interface ConnectorStatus {
    system: SystemId;
    label: string;
    connected: boolean;      // Credentials are configured
    ok: boolean;             // Last read succeeded completely
    reason: string;          // Why it is not ok (empty when ok)
    impact: string;          // What cannot be verified while it is not ok
    records: number;
    incomplete: boolean;     // Read succeeded but was capped or partially failed
}

export interface SearchScope {
    since: Date;
    terms: string[];         // Extra search terms (account aliases, a person, a topic); empty = everything
}

export interface ConnectorResult {
    records: RawRecord[];
    incomplete?: string;     // Set when the read hit a cap or a sub-request failed
}

export interface Connector {
    system: SystemId;
    label: string;
    impact: string;
    missingConfig(): string | null;   // Env vars still needed, or null when configured
    read(scope: SearchScope): Promise<ConnectorResult>;
}

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export const ITEM_STATUSES = ['To-do', 'In progress', 'Blocked', 'Waiting', 'Done (verified)', 'Done (unconfirmed)', 'Unknown'] as const;
export type ItemStatus = typeof ITEM_STATUSES[number];

export const ITEM_CATEGORIES = ['needs_me', 'blocked', 'waiting_on_others', 'client', 'deadline', 'meeting', 'risk', 'on_track'] as const;
export type ItemCategory = typeof ITEM_CATEGORIES[number];

// One consolidated operational item: person ↔ task ↔ account ↔ deadline ↔ sources.
export interface OpsItem {
    key: string;
    title: string;
    priority: Priority;
    status: ItemStatus;
    category: ItemCategory;
    account: string;
    owner: string;
    deadline: string;
    summary: string;
    conflict: string;
    remainingAction: string;
    definitionOfDone: string;
    why: string;
    sourceIds: string[];
    sources: Array<{ id: string; system: SystemId; author: string; timestamp: string; url: string }>;
    unsourced: boolean;       // The model cited nothing we actually read
    lastEvidenceAt: string;   // Newest cited source timestamp
    stale: boolean;
}

export const MOODS = ['Positive', 'Neutral', 'Concerned', 'Negative', 'Unknown'] as const;
export type Mood = typeof MOODS[number];

export interface Statement { text: string; sourceId: string }

export interface ClientPicture {
    account: string;
    mood: Mood;
    moodEvidence: string[];
    clientSaid: Statement[];
    teamSaid: Statement[];
    currentReality: string;
    openActions: string[];
    risk: string;
    recommendedResponse: string;
    lastInteraction: string;
}

export const ACTION_TYPES = ['slack_message', 'jira_comment', 'email', 'whatsapp_message', 'other'] as const;
export type ActionType = typeof ACTION_TYPES[number];

export interface ProposedAction {
    type: ActionType;
    target: string;   // Slack channel ID, Jira issue key, email address, phone…
    body: string;
    reason: string;
    sourceIds: string[];
}

export type CommandKind = 'start_my_day' | 'team' | 'client' | 'missing' | 'do_now' | 'ask';

export interface FollowUpCheck {
    person: string;
    lastRequest: SourceRecord | null;
    lastResponse: SourceRecord | null;
    followUpSentToday: boolean;
}
