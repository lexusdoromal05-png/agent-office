import { Analysis, sameLocalDay } from './analyze';
import { CommandKind, ConnectorStatus, FollowUpCheck, OpsItem, SourceRecord } from './types';

const SYSTEM_NAMES: Record<string, string> = {
    slack: 'Slack', gmail: 'Gmail', calendar: 'Calendar', drive: 'Drive', jira: 'Jira',
    notion: 'Notion', discord: 'Discord', whatsapp: 'WhatsApp', ingest: 'Ingest',
};

export const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const byPriority = (a: OpsItem, b: OpsItem) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];

export interface RenderContext {
    command: CommandKind;
    arg: string;
    now: Date;
    since: Date;
    statuses: ConnectorStatus[];
    records: SourceRecord[];
    analysis: Analysis;
    followUps: FollowUpCheck[];
    pendingActions: number;
    followUpDrafts: string[];   // People with a follow-up draft waiting for approval
    identityConfigured: boolean;
}

function sourceLines(item: OpsItem): string[] {
    if (item.unsourced) return ['UNSOURCED — no record from a connected system supports this. Verify before acting.'];
    return ['Sources:', ...item.sources.map((s) => `  • [${s.id}] ${s.author || 'unknown'}, ${SYSTEM_NAMES[s.system]} — ${when(s.timestamp)}${s.url ? ` ${s.url}` : ''}`)];
}

function staleLine(item: OpsItem): string[] {
    return item.stale && !item.unsourced ? [`STATUS MAY BE STALE — Last confirmed update: ${item.lastEvidenceAt ? when(item.lastEvidenceAt) : 'unknown'}`] : [];
}

export function itemBlock(item: OpsItem): string {
    const lines = [
        `${item.priority} — ${item.title}`,
        `Status: ${item.status}`,
        [item.account && `Account: ${item.account}`, item.owner && `Owner: ${item.owner}`, item.deadline && `Deadline: ${item.deadline}`].filter(Boolean).join(' | '),
        item.summary && `Reality: ${item.summary}`,
        item.conflict && `⚠ Conflict: ${item.conflict}`,
        item.remainingAction && `Remaining action: ${item.remainingAction}`,
        ...sourceLines(item),
        ...staleLine(item),
    ];
    return lines.filter(Boolean).join('\n');
}

function section(title: string, items: OpsItem[], empty = 'Nothing found in the connected sources.'): string {
    const body = items.length ? items.sort(byPriority).map(itemBlock).join('\n\n') : empty;
    return `${title}\n${'─'.repeat(title.length)}\n${body}`;
}

function accessGaps(statuses: ConnectorStatus[]): string {
    const gaps = statuses.filter((s) => !s.ok);
    if (!gaps.length) return '';
    return gaps.map((s) => `ACCESS GAP\nSystem: ${s.label}\nProblem: ${s.reason}\nImpact: ${s.impact}`).join('\n\n');
}

function header(ctx: RenderContext, title: string): string {
    const checked = ctx.statuses.filter((s) => s.connected && s.reason.indexOf('Read failed') !== 0)
        .map((s) => `${s.label} (${s.records}${s.incomplete ? ', incomplete' : ''})`);
    return [
        `${title} — ${ctx.now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
        `Evidence window: ${when(ctx.since.toISOString())} → ${when(ctx.now.toISOString())}`,
        `Checked: ${checked.length ? checked.join(' · ') : 'no connected systems'}`,
        ctx.identityConfigured ? '' : 'Note: OPS_ME_NAMES is not set, so messages from you and mentions of you cannot be recognized.',
    ].filter(Boolean).join('\n');
}

function meetings(ctx: RenderContext): string {
    const events = ctx.records
        .filter((r) => r.system === 'calendar' && r.meta?.start)
        .sort((a, b) => a.meta.start.localeCompare(b.meta.start));
    const calendarStatus = ctx.statuses.find((s) => s.system === 'calendar');
    if (!calendarStatus?.ok && !events.length) return 'MEETINGS\n────────\nCalendar not available — see ACCESS GAP.';
    const today = events.filter((e) => sameLocalDay(new Date(e.meta.start), ctx.now));
    const later = events.filter((e) => !sameLocalDay(new Date(e.meta.start), ctx.now));
    const line = (e: SourceRecord) => `  • ${when(e.meta.start)} — ${e.channel}${e.accounts.length ? ` [${e.accounts.join(', ')}]` : ''} [${e.id}]`;
    return [
        'MEETINGS',
        '────────',
        'Today:',
        ...(today.length ? today.map(line) : ['  • No meetings on the calendar.']),
        'Tomorrow:',
        ...(later.length ? later.map(line) : ['  • No meetings on the calendar.']),
    ].join('\n');
}

function followUpBlocks(ctx: RenderContext): string {
    const blocks = ctx.followUps.map((f) => {
        const verdict = ctx.analysis.followUps[f.person];
        const facts = [
            `Last request: ${f.lastRequest ? `${when(f.lastRequest.timestamp)} [${f.lastRequest.id}]` : 'none found'}`,
            `Last response: ${f.lastResponse ? `${when(f.lastResponse.timestamp)} [${f.lastResponse.id}]` : 'none found'}`,
            verdict?.missing ? `Still missing: ${verdict.missing}` : '',
        ].filter(Boolean);
        if (!ctx.identityConfigured) {
            return [`FOLLOW-UP STATUS UNKNOWN — ${f.person.toUpperCase()}`, 'Cannot tell whether you already followed up today (set OPS_ME_NAMES).', ...facts].join('\n');
        }
        if (!verdict?.outstanding) return '';
        if (f.followUpSentToday) {
            return [`FOLLOW-UP ALREADY SENT TODAY — ${f.person.toUpperCase()}`, 'Do not ping again today.', ...facts].join('\n');
        }
        const draft = ctx.followUpDrafts.includes(f.person)
            ? 'Not sent. A draft is waiting in Pending actions for your approval.'
            : 'Not sent. No draft prepared yet.';
        return [`FOLLOW-UP REQUIRED — ${f.person.toUpperCase()}`, ...facts, draft].join('\n');
    }).filter(Boolean);
    return blocks.join('\n\n');
}

function clientBlock(c: Analysis['clients'][number], records: Map<string, SourceRecord>): string {
    const said = (list: { text: string; sourceId: string }[]) =>
        list.length ? list.map((s) => `  • ${s.text} [${s.sourceId}, ${records.get(s.sourceId)?.author || ''}, ${when(records.get(s.sourceId)?.timestamp || '')}]`) : ['  • Nothing in the connected sources.'];
    const last = c.lastInteraction ? records.get(c.lastInteraction) : undefined;
    return [
        `${c.account.toUpperCase()}`,
        `Client mood: ${c.mood}${c.moodEvidence.length ? ` (evidence: ${c.moodEvidence.join(', ')})` : ''}`,
        `Last meaningful client interaction: ${last ? `${when(last.timestamp)} via ${SYSTEM_NAMES[last.system]} [${last.id}]` : 'none found in this window'}`,
        'WHAT THE CLIENT SAID', ...said(c.clientSaid),
        'WHAT OUR TEAM SAID', ...said(c.teamSaid),
        'CURRENT REALITY', `  ${c.currentReality || 'Not established from the sources.'}`,
        'OPEN ACTION', ...(c.openActions.length ? c.openActions.map((a) => `  • ${a}`) : ['  • None found.']),
        'RISK', `  ${c.risk || 'None identified.'}`,
        'RECOMMENDED RESPONSE', `  ${c.recommendedResponse || '—'}`,
    ].join('\n');
}

function tail(ctx: RenderContext): string[] {
    const parts: string[] = [];
    if (ctx.analysis.questions.length) {
        parts.push(`QUESTIONS FOR YOU (not answerable from connected sources)\n${ctx.analysis.questions.map((q) => `  • ${q}`).join('\n')}`);
    }
    if (ctx.pendingActions) {
        parts.push(`PENDING ACTIONS\n${ctx.pendingActions} prepared action(s) are waiting for your approval. Nothing has been sent.`);
    }
    const gaps = accessGaps(ctx.statuses);
    if (gaps) parts.push(gaps);
    return parts;
}

export function renderBrief(ctx: RenderContext): string {
    const { items } = ctx.analysis;
    const recordMap = new Map(ctx.records.map((r) => [r.id, r]));
    const of = (...cats: string[]) => items.filter((i) => cats.includes(i.category));
    const parts: string[] = [];

    switch (ctx.command) {
        case 'start_my_day': {
            parts.push(header(ctx, 'DAILY EXECUTIVE BRIEF'));
            const top = items.filter((i) => (i.priority === 'P0' || i.priority === 'P1') && !i.unsourced).sort(byPriority).slice(0, 5);
            parts.push(section('WHAT MATTERS MOST', top, 'No P0/P1 items found in the connected sources.'));
            const rest = (cats: string[]) => of(...cats).filter((i) => !top.includes(i));
            parts.push(section('NEEDS YOUR ACTION', rest(['needs_me'])));
            parts.push(section('BLOCKED', rest(['blocked'])));
            parts.push(section('WAITING ON OTHERS', rest(['waiting_on_others'])));
            parts.push(section('CLIENT REQUESTS & DEADLINES', rest(['client', 'deadline'])));
            parts.push(meetings(ctx));
            if (ctx.analysis.clients.length) {
                parts.push(`CLIENT SITUATION\n────────────────\n${ctx.analysis.clients.map((c) => clientBlock(c, recordMap)).join('\n\n')}`);
            }
            parts.push(section('RISKS', rest(['risk', 'meeting'])));
            const followUps = followUpBlocks(ctx);
            if (followUps) parts.push(followUps);
            const onTrack = rest(['on_track']);
            if (onTrack.length) parts.push(`ON TRACK\n────────\n${onTrack.map((i) => `  • ${i.title}${i.owner ? ` (${i.owner})` : ''} [${i.sourceIds.join(', ')}]`).join('\n')}`);
            break;
        }
        case 'team': {
            parts.push(header(ctx, 'TEAM SITUATION'));
            parts.push(section('CRITICAL', items.filter((i) => i.priority === 'P0')));
            const nonCritical = items.filter((i) => i.priority !== 'P0');
            parts.push(section('NEEDS MY ACTION', nonCritical.filter((i) => i.category === 'needs_me')));
            parts.push(section('BLOCKED', nonCritical.filter((i) => i.category === 'blocked')));
            parts.push(section('WAITING', nonCritical.filter((i) => i.category === 'waiting_on_others')));
            parts.push(section('ON TRACK', nonCritical.filter((i) => i.category === 'on_track')));
            parts.push(section('POTENTIAL RISK', nonCritical.filter((i) => !['needs_me', 'blocked', 'waiting_on_others', 'on_track'].includes(i.category))));
            const followUps = followUpBlocks(ctx);
            if (followUps) parts.push(followUps);
            break;
        }
        case 'client': {
            parts.push(header(ctx, `CLIENT: ${ctx.arg.toUpperCase()}`));
            const client = ctx.analysis.clients.find((c) => c.account.toLowerCase() === ctx.arg.toLowerCase()) || ctx.analysis.clients[0];
            parts.push(client ? clientBlock(client, recordMap) : 'No client communication about this account was found in the connected sources.');
            parts.push(section('OPEN ITEMS', items));
            break;
        }
        case 'missing': {
            parts.push(header(ctx, 'WHAT YOU ARE MISSING'));
            parts.push(section('RANKED BY OPERATIONAL IMPORTANCE', items));
            const followUps = followUpBlocks(ctx);
            if (followUps) parts.push(followUps);
            break;
        }
        case 'do_now': {
            parts.push(header(ctx, 'WHAT TO DO NOW'));
            const ordered = items.filter((i) => !i.unsourced && i.status !== 'Done (verified)');
            const first = ordered[0];
            if (!first) {
                parts.push('DO THIS NOW\nNo sourced open action found in the connected systems.');
            } else {
                parts.push([
                    'DO THIS NOW',
                    `Task: ${first.title}`,
                    `Priority: ${first.priority}`,
                    `Status: ${first.status}`,
                    `Account: ${first.account || '—'}`,
                    `Owner: ${first.owner || '—'}`,
                    `Deadline: ${first.deadline || '—'}`,
                    ...sourceLines(first),
                    `Why: ${first.why || first.summary}`,
                    `Definition of done: ${first.definitionOfDone || first.remainingAction || '—'}`,
                    first.conflict ? `⚠ Conflict: ${first.conflict}` : '',
                    ...staleLine(first),
                ].filter(Boolean).join('\n'));
                const next = ordered.slice(1, 4);
                if (next.length) {
                    parts.push(['THEN', ...next.map((i, n) => `${n + 1}. ${i.priority} — ${i.title}${i.deadline ? ` (by ${i.deadline})` : ''} [${i.sourceIds.join(', ')}]`)].join('\n'));
                }
            }
            break;
        }
        case 'ask': {
            parts.push(header(ctx, 'ANSWER'));
            parts.push(ctx.analysis.answer || 'The connected sources do not answer this.');
            if (items.length) parts.push(section('RELATED ITEMS', items));
            break;
        }
    }

    parts.push(...tail(ctx));
    return parts.join('\n\n');
}
