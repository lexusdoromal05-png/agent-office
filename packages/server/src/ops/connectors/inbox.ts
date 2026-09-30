import * as crypto from 'crypto';
import { Connector, ConnectorResult, RawRecord, SearchScope, SystemId } from '../types';
import { OpsStore } from '../OpsStore';
import { clip, env, missing } from './http';

// Systems that push to us instead of being polled read from the local inbox table.
function inboxConnector(store: OpsStore, system: SystemId, label: string, impact: string, required: string[]): Connector {
    return {
        system,
        label,
        impact,
        missingConfig: () => missing(...required),
        async read({ since, terms }: SearchScope): Promise<ConnectorResult> {
            const lowerTerms = terms.map((t) => t.toLowerCase());
            const records = (await store.listInbox(system, since))
                .filter((r) => !lowerTerms.length || lowerTerms.some((t) => `${r.channel} ${r.text}`.toLowerCase().includes(t)));
            return { records };
        },
    };
}

// WhatsApp Business Cloud API only delivers messages sent to the connected business
// number. Personal WhatsApp chats have no official read API.
export const whatsappConnector = (store: OpsStore) => inboxConnector(
    store, 'whatsapp', 'WhatsApp (Business webhook)',
    'Client and leadership WhatsApp messages cannot be verified; only messages received by the webhook since it was set up are visible.',
    ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'],
);

// Anything else (meeting transcripts, CRM, dashboards, other tools via Zapier/Make) can POST here.
export const ingestConnector = (store: OpsStore) => inboxConnector(
    store, 'ingest', 'Ingest API (transcripts, CRM, other tools)',
    'Meeting transcripts, CRM updates, and other pushed sources cannot be verified.',
    ['OPS_INGEST_TOKEN'],
);

export function verifyWhatsAppSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = env('WHATSAPP_APP_SECRET');
    if (!secret || !signatureHeader?.startsWith('sha256=')) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = signatureHeader.slice('sha256='.length);
    return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Pulls text messages out of a WhatsApp Cloud API webhook payload.
export function parseWhatsAppWebhook(payload: any): RawRecord[] {
    const records: RawRecord[] = [];
    for (const entry of payload?.entry || []) {
        for (const change of entry.changes || []) {
            const value = change.value || {};
            const names: Record<string, string> = {};
            for (const c of value.contacts || []) names[c.wa_id] = c.profile?.name || c.wa_id;
            for (const m of value.messages || []) {
                const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title
                    || (m.type ? `[${m.type} message]` : '');
                records.push({
                    system: 'whatsapp',
                    externalId: m.id,
                    kind: 'message',
                    author: names[m.from] || m.from,
                    channel: `WhatsApp ${names[m.from] || m.from}`,
                    text: clip(text),
                    timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
                    url: '',
                    meta: { from: m.from },
                });
            }
        }
    }
    return records;
}

export function parseIngest(body: any): RawRecord | string {
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return 'text is required';
    const time = body.timestamp ? new Date(body.timestamp) : new Date();
    if (Number.isNaN(time.getTime())) return 'timestamp must be an ISO date';
    const str = (v: any, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    return {
        system: 'ingest',
        externalId: str(body.externalId, 200) || crypto.createHash('sha1').update(`${body.source}|${time.toISOString()}|${text}`).digest('hex'),
        kind: str(body.kind, 40) || 'note',
        author: str(body.author, 200) || 'unknown',
        channel: str(body.source, 100) || 'ingest',
        text: clip(text, 6000),
        timestamp: time.toISOString(),
        url: str(body.url, 1000),
        meta: {},
    };
}
