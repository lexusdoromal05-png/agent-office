import { Connector, ConnectorResult, RawRecord, SearchScope } from '../types';
import { clip, env, getJson, missing } from './http';

const MAX_ISSUES = 100;

function auth() {
    return `Basic ${Buffer.from(`${env('JIRA_EMAIL')}:${env('JIRA_API_TOKEN')}`).toString('base64')}`;
}

const baseUrl = () => env('JIRA_BASE_URL').replace(/\/+$/, '');

// Flattens Atlassian Document Format into plain text.
export function adfToText(node: any): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.type === 'text') return node.text || '';
    if (node.type === 'mention') return node.attrs?.text || '';
    const inner = (node.content || []).map(adfToText).join(node.type === 'doc' ? '\n' : '');
    return node.type === 'paragraph' ? `${inner}\n` : inner;
}

function jiraDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const jira: Connector = {
    system: 'jira',
    label: 'Jira',
    impact: 'Ticket status, assignments, overdue and blocked work cannot be verified against the system of record.',
    missingConfig: () => missing('JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'),

    async read({ since, terms }: SearchScope): Promise<ConnectorResult> {
        const window = `(updated >= "${jiraDate(since)}" OR (duedate <= 3d AND statusCategory != Done))`;
        const termClause = terms.length ? ` AND (${terms.map((t) => `text ~ "\\"${t.replace(/"/g, '')}\\""`).join(' OR ')})` : '';
        const project = env('JIRA_PROJECTS') ? ` AND project in (${env('JIRA_PROJECTS')})` : '';
        const data = await getJson(`${baseUrl()}/rest/api/3/search/jql`, {
            method: 'POST',
            headers: { Authorization: auth(), 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                jql: `${window}${termClause}${project} ORDER BY updated DESC`,
                maxResults: MAX_ISSUES,
                fields: ['summary', 'status', 'assignee', 'reporter', 'priority', 'duedate', 'updated', 'labels', 'comment', 'project'],
            }),
        });
        const records: RawRecord[] = (data.issues || []).map((issue: any) => {
            const f = issue.fields || {};
            const comments = (f.comment?.comments || []).slice(-2)
                .map((c: any) => `${c.author?.displayName} (${c.updated}): ${adfToText(c.body).trim()}`)
                .join('\n');
            return {
                system: 'jira',
                externalId: issue.key,
                kind: 'ticket',
                author: f.assignee?.displayName || 'Unassigned',
                channel: f.project?.key || '',
                text: clip(`${issue.key} "${f.summary}" — status: ${f.status?.name}; priority: ${f.priority?.name || 'none'}; due: ${f.duedate || 'none'}; reporter: ${f.reporter?.displayName || ''}; labels: ${(f.labels || []).join(', ')}${comments ? `\nLatest comments:\n${comments}` : ''}`),
                timestamp: new Date(f.updated).toISOString(),
                url: `${baseUrl()}/browse/${issue.key}`,
                meta: { status: f.status?.name || '', statusCategory: f.status?.statusCategory?.key || '', due: f.duedate || '' },
            };
        });
        return { records, incomplete: data.nextPageToken ? `capped at ${MAX_ISSUES} tickets` : undefined };
    },
};

export async function addJiraComment(issueKey: string, text: string): Promise<string> {
    if (jira.missingConfig()) throw new Error(`Jira is not connected (${jira.missingConfig()}).`);
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey)) throw new Error(`"${issueKey}" is not a Jira issue key.`);
    const data = await getJson(`${baseUrl()}/rest/api/3/issue/${issueKey}/comment`, {
        method: 'POST',
        headers: { Authorization: auth(), 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
        }),
    });
    return `Jira confirmed comment ${data.id} on ${issueKey}`;
}
