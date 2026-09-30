import { Connector, ConnectorResult, RawRecord, SearchScope } from '../types';
import { clip, env, getJson, getText, list, missing } from './http';

// Gmail, Calendar, and Drive share one OAuth refresh token (read-only scopes:
// gmail.readonly, calendar.readonly, drive.readonly).
const GOOGLE_VARS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const data = await getJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: env('GOOGLE_CLIENT_ID'),
            client_secret: env('GOOGLE_CLIENT_SECRET'),
            refresh_token: env('GOOGLE_REFRESH_TOKEN'),
            grant_type: 'refresh_token',
        }),
    });
    cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    return cached.token;
}

async function google(url: string): Promise<any> {
    return getJson(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
}

const header = (headers: any[], name: string) =>
    (headers || []).find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

const MAX_EMAILS = 50;

export const gmail: Connector = {
    system: 'gmail',
    label: 'Gmail',
    impact: 'Client emails, approvals, contracts, invoices, and follow-ups cannot be verified.',
    missingConfig: () => missing(...GOOGLE_VARS),

    async read({ since, terms }: SearchScope): Promise<ConnectorResult> {
        const termQuery = terms.length ? ` {${terms.map((t) => `"${t}"`).join(' ')}}` : '';
        const q = `after:${Math.floor(since.getTime() / 1000)} -category:promotions -category:social${termQuery}`;
        const listing = await google(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(MAX_EMAILS) })}`);
        const ids: string[] = (listing.messages || []).map((m: any) => m.id);
        const records: RawRecord[] = [];
        let failed = 0;
        await Promise.all(ids.map(async (id) => {
            try {
                const params = new URLSearchParams({ format: 'metadata' });
                ['From', 'To', 'Subject', 'Date'].forEach((h) => params.append('metadataHeaders', h));
                const m = await google(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?${params}`);
                const h = m.payload?.headers || [];
                records.push({
                    system: 'gmail',
                    externalId: id,
                    kind: 'email',
                    author: header(h, 'From'),
                    channel: header(h, 'Subject') || '(no subject)',
                    text: clip(`To: ${header(h, 'To')}\n${m.snippet || ''}`),
                    timestamp: new Date(Number(m.internalDate)).toISOString(),
                    url: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
                    meta: { threadId: m.threadId, unread: String((m.labelIds || []).includes('UNREAD')) },
                });
            } catch {
                failed++;
            }
        }));
        const notes = [];
        if (listing.nextPageToken) notes.push(`capped at ${MAX_EMAILS} emails`);
        if (failed) notes.push(`${failed} emails could not be read`);
        return { records, incomplete: notes.join('; ') || undefined };
    },
};

export const calendar: Connector = {
    system: 'calendar',
    label: 'Google Calendar',
    impact: "Today's and tomorrow's meetings cannot be verified.",
    missingConfig: () => missing(...GOOGLE_VARS),

    // Calendar ignores the sweep window: it always covers the start of today through end of tomorrow.
    async read({ terms }: SearchScope): Promise<ConnectorResult> {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 2 * 86_400_000);
        const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID') || 'primary');
        const params = new URLSearchParams({
            timeMin: start.toISOString(), timeMax: end.toISOString(),
            singleEvents: 'true', orderBy: 'startTime', maxResults: '100',
        });
        if (terms.length === 1) params.set('q', terms[0]);
        const data = await google(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`);
        const records: RawRecord[] = (data.items || [])
            .filter((e: any) => e.status !== 'cancelled')
            .map((e: any) => {
                const startAt = e.start?.dateTime || e.start?.date || '';
                const attendees = (e.attendees || []).map((a: any) => a.displayName || a.email).join(', ');
                return {
                    system: 'calendar',
                    externalId: e.id,
                    kind: 'event',
                    author: e.organizer?.displayName || e.organizer?.email || '',
                    channel: e.summary || '(untitled event)',
                    text: clip(`Starts ${startAt}, ends ${e.end?.dateTime || e.end?.date || ''}. Attendees: ${attendees}. ${e.description || ''}`, 800),
                    timestamp: new Date(e.updated || startAt).toISOString(),
                    url: e.htmlLink || '',
                    meta: { start: startAt, end: e.end?.dateTime || e.end?.date || '' },
                };
            });
        return { records };
    },
};

const EXPORTABLE: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
};
const MAX_EXPORTS = 6;

export const drive: Connector = {
    system: 'drive',
    label: 'Google Drive / Docs / Sheets / Slides',
    impact: 'Product sheets, trackers, decks, and deliverables cannot be checked for changes or current figures.',
    missingConfig: () => missing(...GOOGLE_VARS),

    async read({ since, terms }: SearchScope): Promise<ConnectorResult> {
        const termQuery = terms.length ? ` and (${terms.map((t) => `fullText contains '${t.replace(/'/g, "\\'")}'`).join(' or ')})` : '';
        const q = `modifiedTime > '${since.toISOString()}' and trashed = false${termQuery}`;
        const params = new URLSearchParams({
            q, orderBy: 'modifiedTime desc', pageSize: '50',
            fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,lastModifyingUser(displayName))',
            supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
        });
        const data = await google(`https://www.googleapis.com/drive/v3/files?${params}`);
        const files: any[] = data.files || [];

        // Always include explicitly watched files (product sheet, KPI sheet…), even if unchanged.
        const watched = list('GOOGLE_WATCH_FILE_IDS');
        for (const id of watched) {
            if (files.some((f) => f.id === id)) continue;
            try {
                files.push(await google(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,modifiedTime,webViewLink,lastModifyingUser(displayName)&supportsAllDrives=true`));
            } catch { /* reported below as incomplete */ }
        }

        let exported = 0;
        let failed = 0;
        const token = await accessToken();
        const records: RawRecord[] = [];
        for (const f of files) {
            let content = '';
            const exportType = EXPORTABLE[f.mimeType];
            if (exportType && (watched.includes(f.id) || exported < MAX_EXPORTS)) {
                try {
                    content = await getText(`https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent(exportType)}`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    exported++;
                } catch {
                    failed++;
                }
            }
            records.push({
                system: 'drive',
                externalId: f.id,
                kind: 'file',
                author: f.lastModifyingUser?.displayName || '',
                channel: f.name,
                text: clip(`${f.mimeType?.replace('application/vnd.google-apps.', '')} modified ${f.modifiedTime}${content ? `\n${content}` : ''}`, 3000),
                timestamp: f.modifiedTime,
                url: f.webViewLink || '',
                meta: { watched: String(watched.includes(f.id)) },
            });
        }
        const notes = [];
        if (data.nextPageToken) notes.push('capped at 50 changed files');
        if (failed) notes.push(`${failed} file contents could not be exported`);
        return { records, incomplete: notes.join('; ') || undefined };
    },
};
