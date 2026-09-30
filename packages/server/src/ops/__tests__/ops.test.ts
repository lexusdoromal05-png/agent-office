import * as crypto from 'crypto';
import { annotate } from '../connectors';
import { followUpCheck, previousWorkingDayStart, sweepSince, validateAnalysis } from '../analyze';
import { parseCommand } from '../OpsAgent';
import { renderBrief } from '../render';
import { parseIngest, parseWhatsAppWebhook, verifyWhatsAppSignature } from '../connectors/inbox';
import { adfToText } from '../connectors/jira';
import { matchAccounts, matchPeople } from '../watchlist';
import { RawRecord } from '../types';

const raw = (over: Partial<RawRecord>): RawRecord => ({
    system: 'slack', externalId: Math.random().toString(36), kind: 'message', author: 'Someone', channel: '#general',
    text: '', timestamp: '2026-09-30T09:00:00.000Z', url: '', meta: {}, ...over,
});

beforeEach(() => {
    process.env.OPS_ME_NAMES = 'Lexus';
    delete process.env.SLACK_MY_USER_ID;
});

describe('sweep window', () => {
    it('uses the previous working day, skipping the weekend', () => {
        const monday = new Date(2026, 8, 28, 9, 0);
        expect(previousWorkingDayStart(monday)).toEqual(new Date(2026, 8, 25, 0, 0));
        const wednesday = new Date(2026, 8, 30, 9, 0);
        expect(previousWorkingDayStart(wednesday)).toEqual(new Date(2026, 8, 29, 0, 0));
    });

    it('prefers the last sweep, capped at two weeks', () => {
        const now = new Date(2026, 8, 30, 9, 0);
        expect(sweepSince('2026-09-30T06:00:00.000Z', now)).toEqual(new Date('2026-09-30T06:00:00.000Z'));
        expect(sweepSince('2026-01-01T00:00:00.000Z', now)).toEqual(new Date(now.getTime() - 14 * 86_400_000));
        expect(sweepSince('', now)).toEqual(previousWorkingDayStart(now));
    });
});

describe('watchlist matching', () => {
    it('matches account aliases on word boundaries', () => {
        expect(matchAccounts('Supernet deck needs review')).toEqual(['Atomic Memory']);
        expect(matchAccounts('omen x launch moved')).toEqual(['OmenX']);
        expect(matchAccounts('an emergency fix')).toEqual([]);
    });

    it('only uses configured aliases for people', () => {
        expect(matchPeople('Haxx pushed the build')).toEqual(['Hassan']);
        expect(matchPeople('Jimidesuu sent assets')).toEqual(['Jimi']);
        expect(matchPeople('Adrian said hi')).toEqual([]);
    });
});

describe('validateAnalysis', () => {
    const records = annotate([
        raw({ author: 'Aaron', text: 'Login is fixed', timestamp: '2026-09-30T08:00:00.000Z' }),
        raw({ system: 'jira', kind: 'ticket', author: 'Aaron', text: 'APP-12 Login — status: In Progress', timestamp: '2026-09-29T08:00:00.000Z' }),
    ]);
    const now = new Date('2026-09-30T10:00:00.000Z');

    it('drops citations to records that were never read and flags unsourced items', () => {
        const result = validateAnalysis({
            items: [
                { title: 'Invented thing', priority: 'P0', status: 'To-do', category: 'needs_me', sourceIds: ['R99'] },
                { title: 'Confirm login fix', priority: 'P1', status: 'In progress', category: 'blocked', sourceIds: ['R1', 'r2'] },
            ],
        }, records, now);
        expect(result.items[0].title).toBe('Confirm login fix');
        expect(result.items[0].sourceIds).toEqual(['R1', 'R2']);
        expect(result.items[1].unsourced).toBe(true);
    });

    it('never treats chat alone as verified completion', () => {
        const result = validateAnalysis({ items: [{ title: 'Login', status: 'Done (verified)', sourceIds: ['R1'] }] }, records, now);
        expect(result.items[0].status).toBe('Done (unconfirmed)');
    });

    it('marks items stale when the newest evidence is old', () => {
        const later = new Date('2026-10-03T10:00:00.000Z');
        const result = validateAnalysis({ items: [{ title: 'Login', sourceIds: ['R1'] }] }, records, later);
        expect(result.items[0].stale).toBe(true);
    });

    it('requires evidence for client mood', () => {
        const result = validateAnalysis({ clients: [{ account: 'Tomoland', mood: 'Negative', moodEvidence: [] }] }, records, now);
        expect(result.clients[0].mood).toBe('Unknown');
    });
});

describe('follow-up rule', () => {
    it('detects a follow-up already sent today', () => {
        const records = annotate([
            raw({ author: 'Lexus', text: 'Anthony, any update on the KPI report?', timestamp: '2026-09-30T08:00:00.000Z' }),
            raw({ author: 'Anthony', text: 'Will send numbers soon', timestamp: '2026-09-29T15:00:00.000Z' }),
        ]);
        const check = followUpCheck('Anthony', records, new Date('2026-09-30T12:00:00.000Z'));
        expect(check.lastRequest?.author).toBe('Lexus');
        expect(check.lastResponse?.author).toBe('Anthony');
        expect(check.followUpSentToday).toBe(true);
    });

    it('requires a follow-up when the last request was on an earlier day', () => {
        const records = annotate([raw({ author: 'Lexus', text: 'Anthony can you send the report', timestamp: '2026-09-28T08:00:00.000Z' })]);
        const check = followUpCheck('Anthony', records, new Date('2026-09-30T12:00:00.000Z'));
        expect(check.followUpSentToday).toBe(false);
    });
});

describe('parseCommand', () => {
    it('recognizes the operating commands', () => {
        expect(parseCommand('START MY DAY')).toEqual({ command: 'start_my_day', arg: '' });
        expect(parseCommand('What am I missing?')).toEqual({ command: 'missing', arg: '' });
        expect(parseCommand('what should I do now')).toEqual({ command: 'do_now', arg: '' });
        expect(parseCommand('What is happening with the team?')).toEqual({ command: 'team', arg: '' });
        expect(parseCommand("What's happening with AtomicMem?")).toEqual({ command: 'client', arg: 'Atomic Memory' });
        expect(parseCommand('Did Bobby approve this?')).toEqual({ command: 'ask', arg: 'Did Bobby approve this?' });
    });
});

describe('renderBrief', () => {
    it('reports access gaps, conflicts, sources, and never claims sending', () => {
        const records = annotate([
            raw({ author: 'Aaron', text: 'Login is fixed', timestamp: '2026-09-30T08:00:00.000Z' }),
            raw({ system: 'jira', author: 'Aaron', text: 'APP-12 open', timestamp: '2026-09-30T07:00:00.000Z' }),
        ]);
        const now = new Date('2026-09-30T10:00:00.000Z');
        const analysis = validateAnalysis({
            items: [{
                title: 'Confirm login fix', priority: 'P0', status: 'In progress', category: 'needs_me',
                conflict: 'Aaron says fixed in Slack [R1]; Jira APP-12 still open [R2]', sourceIds: ['R1', 'R2'],
            }],
            followUpOutstanding: { Anthony: { outstanding: true, missing: 'September KPI numbers' } },
        }, records, now);
        const text = renderBrief({
            command: 'start_my_day', arg: '', now, since: new Date('2026-09-29T00:00:00.000Z'), records, analysis,
            statuses: [
                { system: 'slack', label: 'Slack', connected: true, ok: true, reason: '', impact: '', records: 1, incomplete: false },
                { system: 'gmail', label: 'Gmail', connected: false, ok: false, reason: 'Not connected (set GOOGLE_REFRESH_TOKEN)', impact: 'Client emails cannot be verified.', records: 0, incomplete: false },
            ],
            followUps: [followUpCheck('Anthony', records, now)],
            pendingActions: 1,
            followUpDrafts: [],
            identityConfigured: true,
        });
        expect(text).toContain('P0 — Confirm login fix');
        expect(text).toContain('⚠ Conflict: Aaron says fixed');
        expect(text).toContain('[R2] Aaron, Jira');
        expect(text).toContain('ACCESS GAP\nSystem: Gmail');
        expect(text).toContain('FOLLOW-UP REQUIRED — ANTHONY');
        expect(text).toContain('Nothing has been sent.');
        expect(text).not.toMatch(/\b(Sent|Updated|Scheduled)\.\s/);
    });
});

describe('inbox parsing', () => {
    it('parses WhatsApp Cloud API messages and verifies signatures', () => {
        process.env.WHATSAPP_APP_SECRET = 'secret';
        const payload = {
            entry: [{ changes: [{ value: {
                contacts: [{ wa_id: '6591234567', profile: { name: 'Bobby' } }],
                messages: [{ id: 'wamid.1', from: '6591234567', timestamp: '1790000000', type: 'text', text: { body: 'Move the Tomoland deadline to Friday' } }],
            } }] }],
        };
        const body = Buffer.from(JSON.stringify(payload));
        const sig = `sha256=${crypto.createHmac('sha256', 'secret').update(body).digest('hex')}`;
        expect(verifyWhatsAppSignature(body, sig)).toBe(true);
        expect(verifyWhatsAppSignature(body, 'sha256=bad')).toBe(false);
        const [record] = parseWhatsAppWebhook(payload);
        expect(record.author).toBe('Bobby');
        expect(record.text).toContain('Tomoland deadline');
    });

    it('validates ingest payloads', () => {
        expect(parseIngest({})).toBe('text is required');
        const record = parseIngest({ source: 'Fireflies', text: 'Meeting notes', timestamp: '2026-09-30T08:00:00Z' });
        expect(typeof record).toBe('object');
    });

    it('flattens Jira ADF comments', () => {
        expect(adfToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Still testing' }] }] }).trim()).toBe('Still testing');
    });
});
