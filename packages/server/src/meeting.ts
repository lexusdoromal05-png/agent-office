import { InferenceAdapter } from '@agent-office/core';
import { OfficeRoom } from './rooms/OfficeRoom';
import { DEFAULT_AGENT_ID, TEAM } from './team';
import { OpsStore } from './ops/OpsStore';
import { completeJson } from './ops/llm';

export interface MeetingReply {
    agentId: string;
    name: string;
    costume: string;
    reply: string;
}

// Canned questions offered as buttons in the meeting panel.
export const MEETING_PROMPTS = [
    'How is the team? Give me your update on what you have done today.',
    'Any blockers or anything you need from me?',
    'What are you working on next?',
    'Anything urgent I should know about?',
];

// Agents named in the question answer; if nobody is named, the whole team answers.
export function addressedAgents(question: string): string[] {
    const q = question.toLowerCase();
    const named = Object.entries(TEAM)
        .filter(([, m]) => new RegExp(`(^|[^a-z0-9])${m.name.toLowerCase().replace(/[-]/g, '[- ]?')}([^a-z0-9]|$)`).test(q))
        .map(([id]) => id);
    return named.length ? named : Object.keys(TEAM);
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// Answers the user's question in the meeting: every agent replies in turn, grounded only in
// what they actually did today (and, for the operations agent, the saved operational model).
export class MeetingService {
    private answering = false;

    constructor(private adapter: InferenceAdapter, private model: string, private opsStore: OpsStore) { }

    async answer(question: string): Promise<MeetingReply[]> {
        const room = OfficeRoom.getActiveRoom();
        if (!room) throw new Error('Open the office in your browser first.');
        if (this.answering) throw new Error('The team is still answering your last question.');
        this.answering = true;
        try {
            const replies: MeetingReply[] = [];
            for (const id of addressedAgents(question)) {
                const member = TEAM[id];
                const reply = await this.replyFor(room, id, question);
                room.agentSays(id, reply);
                replies.push({ agentId: id, name: member.name, costume: member.costume, reply });
            }
            return replies;
        } finally {
            this.answering = false;
        }
    }

    private async replyFor(room: OfficeRoom, agentId: string, question: string): Promise<string> {
        const member = TEAM[agentId];
        const activity = room.todaysActivity(agentId);
        const facts: string[] = activity.map((a) => `- ${time(a.time)}: ${a.text}`);

        if (agentId === DEFAULT_AGENT_ID) {
            const items = await this.opsStore.listItems(true, 8);
            const [brief] = await this.opsStore.listBriefs(1);
            if (brief) facts.push(`- Latest brief (${brief.command.replace(/_/g, ' ')}) at ${time(brief.createdAt)}`);
            for (const i of items) {
                facts.push(`- Open item: ${i.priority} ${i.title} | ${i.status}${i.owner ? ` | owner ${i.owner}` : ''}${i.deadline ? ` | due ${i.deadline}` : ''}${i.conflict ? ` | conflict: ${i.conflict}` : ''}`);
            }
        }

        const prompt = [
            `You are ${member.name}, the ${member.role}, in a team meeting with your boss. It is Halloween and you are dressed as a ${member.costume}.`,
            `Your job: ${member.job}`,
            `Your boss asked: "${question}"`,
            `WHAT YOU ACTUALLY DID OR KNOW TODAY:\n${facts.length ? facts.join('\n') : '- Nothing recorded today.'}`,
            'Answer the question directly in 1-3 short sentences, speaking as yourself.',
            'Use only the facts above. Never invent work, numbers, people, or results. If you have nothing to report for this question, say so plainly (for example "No updates from me yet today.").',
            'A light Halloween touch is fine, but the facts come first.',
            'Reply with ONLY JSON: { "reply": "..." }',
        ].join('\n\n');

        try {
            const raw = await completeJson(this.adapter, this.model, `You are ${member.name}, a helpful teammate.`, prompt, 0.4);
            const reply = typeof raw?.reply === 'string' ? raw.reply.trim() : '';
            if (reply) return reply.slice(0, 600);
        } catch {
            // Fall through to a plain factual answer.
        }
        return activity.length
            ? `Today I: ${activity.slice(-3).map((a) => a.text).join('; ')}.`
            : 'No updates from me yet today.';
    }
}
