import { InferenceAdapter } from '@agent-office/core';
import { OpsStore, StoredAction, StoredBrief } from './OpsStore';
import { buildConnectors, describeConnectors, sweep } from './connectors';
import { postSlackMessage } from './connectors/slack';
import { addJiraComment } from './connectors/jira';
import { list } from './connectors/http';
import { Analysis, followUpCheck, previousWorkingDayStart, STALE_AFTER_MS, formatRecordsForPrompt, selectRecords, sweepSince, validateAnalysis } from './analyze';
import { COMMAND_INSTRUCTIONS, OPERATING_RULES, OUTPUT_SCHEMA } from './operatingMode';
import { renderBrief, when } from './render';
import { completeJson } from './llm';
import { ActionType, CommandKind, Connector, SourceRecord } from './types';
import { OPS_AGENT_NAME } from '../team';
import { findAccount, FOLLOW_UP_PEOPLE, myNames } from './watchlist';

const DAY = 86_400_000;
const LAST_SWEEP_KEY = 'last_sweep_at';

export const COMMAND_LABELS: Record<CommandKind, string> = {
    start_my_day: 'START MY DAY',
    team: 'WHAT IS HAPPENING WITH THE TEAM?',
    client: 'WHAT IS HAPPENING WITH THE CLIENT?',
    missing: 'WHAT AM I MISSING?',
    do_now: 'WHAT SHOULD I DO NOW?',
    ask: 'Question',
};

// Only these action types can be executed, and only after the user approves them.
const EXECUTORS: Partial<Record<ActionType, (target: string, body: string) => Promise<string>>> = {
    slack_message: postSlackMessage,
    jira_comment: addJiraComment,
};

export class BusyError extends Error { }

// A problem with the request itself (unknown account, action already handled…).
export class UserError extends Error { }

export class OpsAgent {
    private connectors: Connector[];
    private running = false;

    constructor(private adapter: InferenceAdapter, private model: string, private store: OpsStore) {
        this.connectors = buildConnectors(store);
    }

    connectorStatus() {
        return describeConnectors(this.connectors);
    }

    async run(command: CommandKind, arg = ''): Promise<StoredBrief> {
        if (this.running) throw new BusyError(`${OPS_AGENT_NAME} is already running a sweep. Wait for it to finish.`);
        this.running = true;
        try {
            return await this.runSweep(command, arg);
        } finally {
            this.running = false;
        }
    }

    private async runSweep(command: CommandKind, arg: string): Promise<StoredBrief> {
        const now = new Date();
        const lastSweep = await this.store.getSetting(LAST_SWEEP_KEY);
        const daily = sweepSince(lastSweep, now);
        const account = command === 'client' ? findAccount(arg) : undefined;
        if (command === 'client' && !account) throw new UserError(`"${arg}" is not a watched account.`);

        const since = {
            start_my_day: daily,
            do_now: new Date(Math.min(daily.getTime(), previousWorkingDayStart(now).getTime())),
            missing: new Date(Math.min(daily.getTime(), now.getTime() - 7 * DAY)),
            team: new Date(now.getTime() - 7 * DAY),
            client: new Date(now.getTime() - 14 * DAY),
            ask: new Date(now.getTime() - 7 * DAY),
        }[command];

        // Follow-up rules need the last request and response even when they predate the sweep window.
        const scopes = [{ since, terms: account ? account.aliases : [] }];
        if (['start_my_day', 'team', 'missing', 'do_now'].includes(command)) {
            scopes.push({ since: new Date(now.getTime() - 14 * DAY), terms: FOLLOW_UP_PEOPLE });
        }
        const { records, statuses } = await sweep(this.connectors, scopes);

        const followUps = FOLLOW_UP_PEOPLE.map((p) => followUpCheck(p, records, now));
        const cap = command === 'start_my_day' || command === 'missing' ? 80 : 60;
        const shown = selectRecords(records, cap);
        for (const f of followUps) {
            for (const r of [f.lastRequest, f.lastResponse]) if (r && !shown.includes(r)) shown.push(r);
        }

        let analysis: Analysis = { items: [], clients: [], proposedActions: [], followUps: {}, questions: [], answer: '' };
        let analysisError = '';
        if (!shown.length) {
            // Nothing new arrived: carry the saved operational model forward with its original sources.
            analysis.items = (await this.store.listItems(true)).map((i) => ({
                ...i, stale: !i.lastEvidenceAt || now.getTime() - new Date(i.lastEvidenceAt).getTime() > STALE_AFTER_MS,
            }));
        } else {
            try {
                const raw = await completeJson(this.adapter, this.model, OPERATING_RULES, await this.prompt(command, arg, now, since, shown, statuses, followUps), 0.2);
                analysis = validateAnalysis(raw, records, now);
            } catch (e: any) {
                analysisError = String(e?.message || e);
            }
        }

        if (shown.length) await this.store.upsertItems(analysis.items);
        await this.queueActions(analysis);
        if (!account && ['start_my_day', 'do_now', 'missing'].includes(command) && statuses.some((s) => s.ok)) {
            await this.store.setSetting(LAST_SWEEP_KEY, now.toISOString());
        }

        const pending = (await this.store.listActions()).filter((a) => a.status === 'pending');
        const drafted = FOLLOW_UP_PEOPLE.filter((p) => pending.some((a) => `${a.target} ${a.body}`.toLowerCase().includes(p.toLowerCase())));
        let text = renderBrief({
            command, arg: account?.name || arg, now, since, statuses, records, analysis, followUps,
            pendingActions: pending.length, followUpDrafts: drafted, identityConfigured: myNames().length > 0,
        });
        if (!shown.length) {
            text = `NO NEW EVIDENCE — none of the connected systems returned activity since ${when(since.toISOString())}. Showing open items from earlier sweeps.\n\n${text}`;
        }
        if (analysisError) {
            text = `ANALYSIS UNAVAILABLE — ${analysisError}\nThe sweep ran (${records.length} records) but could not be reconciled. Sections below show only what could be read directly.\n\n${text}`;
        }
        return this.store.saveBrief(command, account?.name || arg, text);
    }

    private async prompt(command: CommandKind, arg: string, now: Date, since: Date, shown: SourceRecord[], statuses: ReturnType<typeof describeConnectors>, followUps: ReturnType<typeof followUpCheck>[]): Promise<string> {
        const prior = await this.store.listItems(true, 30);
        const gaps = statuses.filter((s) => !s.ok).map((s) => `- ${s.label}: ${s.reason}`).join('\n') || '- none';
        const followUpFacts = followUps.map((f) =>
            `- ${f.person}: last request from user ${f.lastRequest ? `[${f.lastRequest.id}]` : 'not found'}; last response ${f.lastResponse ? `[${f.lastResponse.id}]` : 'not found'}; follow-up sent today: ${f.followUpSentToday}. Only propose a follow-up message if reporting is still outstanding AND none was sent today.`
        ).join('\n');

        return [
            `NOW: ${now.toISOString()} (server local time ${now.toString()})`,
            `USER: ${myNames().join(', ') || 'not configured'}`,
            `COMMAND: ${COMMAND_LABELS[command]}${arg ? ` — ${arg}` : ''}`,
            COMMAND_INSTRUCTIONS[command],
            `EVIDENCE WINDOW: since ${since.toISOString()}`,
            `ACCESS GAPS (these systems could not be checked; do not claim anything about them):\n${gaps}`,
            `FOLLOW-UP CHECKS:\n${followUpFacts}`,
            `PRIOR OPERATIONAL MODEL (open items from earlier sweeps; update them, do not drop them silently):\n${prior.length
                ? prior.map((i) => `- ${i.priority} ${i.title} | ${i.status} | ${i.account || '-'} | owner ${i.owner || '-'} | due ${i.deadline || '-'} | last evidence ${i.lastEvidenceAt || 'none'}`).join('\n')
                : '- none yet'}`,
            `SOURCE RECORDS (${shown.length}, newest first):\n${formatRecordsForPrompt(shown)}`,
            OUTPUT_SCHEMA,
        ].join('\n\n');
    }

    private async queueActions(analysis: Analysis) {
        const existing = await this.store.listActions(200);
        const standing = new Set(list('OPS_STANDING_AUTH'));
        for (const a of analysis.proposedActions) {
            const duplicate = existing.some((e) => (e.status === 'pending' || e.status === 'failed') && e.type === a.type && e.target === a.target && e.body === a.body);
            if (duplicate) continue;
            const stored = await this.store.addAction(a);
            if (standing.has(a.type) && EXECUTORS[a.type]) await this.executeAction(stored.id);
        }
    }

    listActions() {
        return this.store.listActions();
    }

    async editAction(id: number, fields: { body?: string; target?: string }): Promise<StoredAction> {
        const action = await this.pendingAction(id);
        return (await this.store.updateAction(action.id, fields))!;
    }

    async rejectAction(id: number): Promise<StoredAction> {
        const action = await this.pendingAction(id);
        return (await this.store.updateAction(action.id, { status: 'rejected' }))!;
    }

    // Runs an approved action. Status becomes "executed" only when the tool returned a confirmation.
    async executeAction(id: number): Promise<StoredAction> {
        const action = await this.pendingAction(id);
        const executor = EXECUTORS[action.type];
        if (!executor) {
            throw new UserError(`${OPS_AGENT_NAME} cannot send ${action.type.replace('_', ' ')}s. Copy the text and send it yourself.`);
        }
        if (!action.target) throw new UserError('Set a target (channel ID or issue key) first.');
        try {
            const confirmation = await executor(action.target, action.body);
            return (await this.store.updateAction(id, { status: 'executed', result: confirmation }))!;
        } catch (e: any) {
            return (await this.store.updateAction(id, { status: 'failed', result: `Not sent: ${String(e?.message || e)}` }))!;
        }
    }

    // Failed actions stay open so they can be fixed and retried or rejected.
    private async pendingAction(id: number): Promise<StoredAction> {
        const action = await this.store.getAction(id);
        if (!action) throw new UserError('Action not found.');
        if (action.status !== 'pending' && action.status !== 'failed') throw new UserError(`This action is already ${action.status}.`);
        return action;
    }
}

// Maps what the user typed to a command, e.g. "start my day" or "what is happening with Tomoland?".
export function parseCommand(input: string): { command: CommandKind; arg: string } {
    const text = input.trim();
    const t = text.toLowerCase().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ');
    if (/^start my day$/.test(t)) return { command: 'start_my_day', arg: '' };
    if (/^what am i missing$/.test(t)) return { command: 'missing', arg: '' };
    if (/^what should i do( right)? now$/.test(t)) return { command: 'do_now', arg: '' };
    if (/^what('s| is) happening with (the )?team$/.test(t)) return { command: 'team', arg: '' };
    const client = t.match(/^what('s| is) happening with (the client )?(.+)$/);
    if (client && findAccount(client[3])) return { command: 'client', arg: findAccount(client[3])!.name };
    return { command: 'ask', arg: text };
}
