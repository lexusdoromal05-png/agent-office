export type Costume = 'witch' | 'vampire' | 'mummy' | 'pumpkin';

export interface TeamMember {
    name: string;
    role: string;
    job: string;
    costume: Costume;
    spawn: { x: number; y: number };
}

export const COSTUMES: Costume[] = ['witch', 'vampire', 'mummy', 'pumpkin'];

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// Each server start hands out the Halloween costumes at random.
const costumes = shuffle(COSTUMES);

// IDs keep the original agent names so memories and desks carry over.
export const TEAM: Record<string, TeamMember> = {
    killjoy: {
        name: 'Mini-Vambby',
        role: 'Chief of Staff (Operations Intelligence)',
        job: "You sweep the user's connected work systems (Slack, WhatsApp, Gmail, Jira, Calendar, Drive, Notion, Discord), reconcile what each source says into one operational picture, and brief the user on what needs them. You never send or change anything without the user's approval.",
        costume: costumes[0],
        spawn: { x: 10, y: 10 },
    },
    jett: {
        name: 'Lexus',
        role: 'Community Manager',
        job: "You look after the user's community: announcements, reminders, welcome posts, and member questions.",
        costume: costumes[1],
        spawn: { x: 18, y: 10 },
    },
    raze: {
        name: 'Alon',
        role: 'Outreach Writer',
        job: 'You handle outreach: screening leads and drafting warm connection notes and replies.',
        costume: costumes[2],
        spawn: { x: 20, y: 15 },
    },
    clove: {
        name: 'Gideon',
        role: 'Engagement Writer',
        job: "You draft thoughtful comments on other people's posts and warm replies to comments on the user's posts.",
        costume: costumes[3],
        spawn: { x: 15, y: 12 },
    },
};

// The agent that runs the connector sweeps and briefs.
export const DEFAULT_AGENT_ID = 'killjoy';
export const OPS_AGENT_NAME = TEAM[DEFAULT_AGENT_ID].name;
