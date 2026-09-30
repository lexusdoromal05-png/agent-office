import { Connector, ConnectorResult, RawRecord, SearchScope } from '../types';
import { env, getJson, missing } from './http';

function titleOf(page: any): string {
    for (const prop of Object.values<any>(page.properties || {})) {
        if (prop?.type === 'title') return (prop.title || []).map((t: any) => t.plain_text).join('') || 'Untitled';
    }
    return (page.title || []).map((t: any) => t.plain_text).join('') || 'Untitled';
}

export const notion: Connector = {
    system: 'notion',
    label: 'Notion',
    impact: 'Notion pages and databases (plans, notes, trackers) cannot be checked for changes.',
    missingConfig: () => missing('NOTION_TOKEN'),

    async read({ since, terms }: SearchScope): Promise<ConnectorResult> {
        const queries = terms.length ? terms : [''];
        const seen = new Map<string, RawRecord>();
        for (const query of queries) {
            const data = await getJson('https://api.notion.com/v1/search', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${env('NOTION_TOKEN')}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, page_size: 50, sort: { direction: 'descending', timestamp: 'last_edited_time' } }),
            });
            for (const page of data.results || []) {
                if (new Date(page.last_edited_time) < since) continue;
                seen.set(page.id, {
                    system: 'notion',
                    externalId: page.id,
                    kind: 'page',
                    author: page.last_edited_by?.name || '',
                    channel: titleOf(page),
                    text: `${page.object} "${titleOf(page)}" edited ${page.last_edited_time}`,
                    timestamp: new Date(page.last_edited_time).toISOString(),
                    url: page.url || '',
                    meta: {},
                });
            }
        }
        return { records: Array.from(seen.values()) };
    },
};
