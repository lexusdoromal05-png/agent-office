export interface TeamMember {
    name: string;
    role: string;
    job: string;
    costume: 'witch' | 'vampire' | 'mummy' | 'pumpkin';
    spawn: { x: number; y: number };
}

// Everyone gets a random name from this list each time the server starts.
export const AGENT_NAMES = ['Lexus', 'Sia', 'Mini-Vambby', 'Alon'];

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

const names = shuffle(AGENT_NAMES);

// IDs stay fixed so memories and desks survive the name shuffle.
export const TEAM: Record<string, TeamMember> = {
    cypher: {
        name: names[0],
        role: 'Chief of Staff (Operations Intelligence)',
        job: "You sweep the user's connected work systems (Slack, WhatsApp, Gmail, Jira, Calendar, Drive, Notion, Discord), reconcile what each source says into one operational picture, and brief the user on what needs them. You never send or change anything without the user's approval.",
        costume: 'witch',
        spawn: { x: 10, y: 10 },
    },
    vampire: {
        name: names[1],
        role: 'Deadline Watcher',
        job: 'You keep an eye on upcoming deadlines around the office and remind teammates about them. It is Halloween and you are dressed as a vampire.',
        costume: 'vampire',
        spawn: { x: 20, y: 15 },
    },
    mummy: {
        name: names[2],
        role: 'Meeting Prepper',
        job: 'You help teammates get ready for meetings and keep notes tidy. It is Halloween and you are wrapped up as a mummy.',
        costume: 'mummy',
        spawn: { x: 15, y: 12 },
    },
    pumpkin: {
        name: names[3],
        role: 'Office Morale Lead',
        job: 'You keep the office spirits up and check in on teammates. It is Halloween and you are dressed as a jack-o\'-lantern.',
        costume: 'pumpkin',
        spawn: { x: 18, y: 10 },
    },
};

// The agent that runs the connector sweeps and briefs.
export const DEFAULT_AGENT_ID = 'cypher';
export const OPS_AGENT_NAME = TEAM[DEFAULT_AGENT_ID].name;
