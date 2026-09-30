export interface TeamMember {
    name: string;
    role: string;
    job: string;
    spawn: { x: number; y: number };
}

export const TEAM: Record<string, TeamMember> = {
    cypher: {
        name: 'Cypher',
        role: 'Chief of Staff (Operations Intelligence)',
        job: "You sweep the user's connected work systems (Slack, WhatsApp, Gmail, Jira, Calendar, Drive, Notion, Discord), reconcile what each source says into one operational picture, and brief the user on what needs them. You never send or change anything without the user's approval.",
        spawn: { x: 10, y: 10 },
    },
};

export const DEFAULT_AGENT_ID = 'cypher';
