import { Connector, ConnectorResult, RawRecord, SearchScope } from '../types';
import { clip, env, getJson, list, missing } from './http';

export const discord: Connector = {
    system: 'discord',
    label: 'Discord',
    impact: 'Community and client Discord channels cannot be verified.',
    missingConfig: () => missing('DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_IDS'),

    async read({ since, terms }: SearchScope): Promise<ConnectorResult> {
        const records: RawRecord[] = [];
        const failed: string[] = [];
        const capped: string[] = [];
        const lowerTerms = terms.map((t) => t.toLowerCase());
        for (const channelId of list('DISCORD_CHANNEL_IDS')) {
            try {
                const [channel, messages] = await Promise.all([
                    getJson(`https://discord.com/api/v10/channels/${channelId}`, { headers: { Authorization: `Bot ${env('DISCORD_BOT_TOKEN')}` } }),
                    getJson(`https://discord.com/api/v10/channels/${channelId}/messages?limit=100`, { headers: { Authorization: `Bot ${env('DISCORD_BOT_TOKEN')}` } }),
                ]);
                const oldest = messages?.[messages.length - 1];
                if (messages?.length === 100 && oldest && new Date(oldest.timestamp) >= since) capped.push(channel.name || channelId);
                for (const m of messages || []) {
                    if (new Date(m.timestamp) < since) continue;
                    if (lowerTerms.length && !lowerTerms.some((t) => String(m.content).toLowerCase().includes(t))) continue;
                    records.push({
                        system: 'discord',
                        externalId: m.id,
                        kind: 'message',
                        author: m.author?.global_name || m.author?.username || '',
                        channel: `#${channel.name || channelId}`,
                        text: clip(m.content || ''),
                        timestamp: new Date(m.timestamp).toISOString(),
                        url: channel.guild_id ? `https://discord.com/channels/${channel.guild_id}/${channelId}/${m.id}` : '',
                        meta: {},
                    });
                }
            } catch {
                failed.push(channelId);
            }
        }
        const notes = [];
        if (failed.length) notes.push(`could not read channels ${failed.join(', ')}`);
        if (capped.length) notes.push(`only the latest 100 messages read in ${capped.join(', ')}`);
        return { records, incomplete: notes.join('; ') || undefined };
    },
};
