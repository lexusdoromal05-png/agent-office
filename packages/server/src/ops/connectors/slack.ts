import { Connector, ConnectorResult, RawRecord, SearchScope } from '../types';
import { clip, env, getJson, missing } from './http';

const MAX_PAGES = 3;

// Slack's `after:` is exclusive, so search from the day before and filter by timestamp.
function afterDate(since: Date): string {
    const d = new Date(since.getTime() - 86_400_000);
    return d.toISOString().slice(0, 10);
}

export const slack: Connector = {
    system: 'slack',
    label: 'Slack',
    impact: 'Slack DMs, mentions, threads, and project/client channels cannot be verified.',
    // search.messages only works with a user token (xoxp-) that has the search:read scope.
    missingConfig: () => missing('SLACK_USER_TOKEN'),

    async read({ since, terms }: SearchScope): Promise<ConnectorResult> {
        const termQuery = terms.length ? `(${terms.map((t) => `"${t}"`).join(' OR ')}) ` : '';
        const query = `${termQuery}after:${afterDate(since)}`;
        const records: RawRecord[] = [];
        let incomplete: string | undefined;

        for (let page = 1; page <= MAX_PAGES; page++) {
            const params = new URLSearchParams({ query, count: '100', page: String(page), sort: 'timestamp', sort_dir: 'desc' });
            const data = await getJson(`https://slack.com/api/search.messages?${params}`, {
                headers: { Authorization: `Bearer ${env('SLACK_USER_TOKEN')}` },
            });
            if (!data.ok) throw new Error(`Slack: ${data.error}`);
            for (const m of data.messages?.matches || []) {
                const time = new Date(Number(m.ts) * 1000);
                if (time < since) continue;
                records.push({
                    system: 'slack',
                    externalId: `${m.channel?.id}:${m.ts}`,
                    kind: m.channel?.is_im ? 'dm' : 'message',
                    author: m.username || m.user || 'unknown',
                    channel: m.channel?.is_im ? 'DM' : `#${m.channel?.name || m.channel?.id}`,
                    text: clip(m.text || ''),
                    timestamp: time.toISOString(),
                    url: m.permalink || '',
                    meta: { threadTs: m.thread_ts || '' },
                });
            }
            const pages = data.messages?.paging?.pages || 1;
            if (page >= pages) break;
            if (page === MAX_PAGES) incomplete = `capped at ${MAX_PAGES * 100} messages`;
        }
        return { records, incomplete };
    },
};

export async function postSlackMessage(channel: string, text: string): Promise<string> {
    const token = env('SLACK_BOT_TOKEN') || env('SLACK_USER_TOKEN');
    if (!token) throw new Error('No Slack token configured (SLACK_BOT_TOKEN or SLACK_USER_TOKEN).');
    const data = await getJson('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ channel, text }),
    });
    if (!data.ok) throw new Error(`Slack: ${data.error}`);
    return `Slack confirmed message ts ${data.ts} in ${data.channel}`;
}
