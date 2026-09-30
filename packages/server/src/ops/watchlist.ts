// Accounts and people Cypher watches across every connector.
// Edit this file to add accounts, aliases, or people.

export interface WatchedAccount {
    name: string;
    aliases: string[];   // Search terms that refer to this account
}

export const ACCOUNTS: WatchedAccount[] = [
    { name: 'Bored2AI', aliases: ['Bored2AI', 'Bored 2 AI', 'Bored2 AI'] },
    { name: 'BoredSexy', aliases: ['BoredSexy', 'Bored Sexy'] },
    { name: 'Tomoland', aliases: ['Tomoland', 'Tomo Land'] },
    { name: 'OmenX', aliases: ['OmenX', 'Omen X'] },
    { name: 'Atomic Memory', aliases: ['Atomic Memory', 'AtomicMem', 'AtomicStrata', 'Atomic Strata', 'Supernet'] },
    { name: 'Kenji Origins', aliases: ['Kenji Origins', 'KenjiOrigins'] },
    { name: 'Emerge', aliases: ['Emerge'] },
];

export interface WatchedPerson {
    name: string;
    // Only aliases the user has confirmed belong to the same person. Never add a
    // name here just because it looks similar.
    aliases: string[];
}

export const PEOPLE: WatchedPerson[] = [
    { name: 'Gideon', aliases: [] },
    { name: 'Bobby', aliases: [] },
    { name: 'Roy', aliases: [] },
    { name: 'Nekko', aliases: [] },
    { name: 'Jimi', aliases: ['Jimidesuu'] },
    { name: 'Amanda', aliases: [] },
    { name: 'Lexus', aliases: [] },
    { name: 'Aaron', aliases: [] },
    { name: 'Ian', aliases: [] },
    { name: 'Cri', aliases: [] },
    { name: 'Kirt Patrick', aliases: [] },
    { name: 'Josie', aliases: [] },
    { name: 'Tracy', aliases: [] },
    { name: 'Eileen', aliases: [] },
    { name: 'Anthony', aliases: [] },
    { name: 'Hassan', aliases: ['Haxx'] },
];

// People whose outstanding reporting Cypher follows up on without re-pinging twice a day.
export const FOLLOW_UP_PEOPLE = ['Anthony'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (terms: string[]) => new RegExp(`(^|[^\\p{L}\\p{N}])(${terms.map(escape).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');

const accountPatterns = ACCOUNTS.map((a) => ({ name: a.name, re: wordPattern(a.aliases) }));
const personPatterns = PEOPLE.map((p) => ({ name: p.name, re: wordPattern([p.name, ...p.aliases]) }));

export function matchAccounts(text: string): string[] {
    return accountPatterns.filter((p) => p.re.test(text)).map((p) => p.name);
}

export function matchPeople(text: string): string[] {
    return personPatterns.filter((p) => p.re.test(text)).map((p) => p.name);
}

export function findAccount(nameOrAlias: string): WatchedAccount | undefined {
    const needle = nameOrAlias.trim().toLowerCase();
    return ACCOUNTS.find((a) => a.name.toLowerCase() === needle || a.aliases.some((x) => x.toLowerCase() === needle));
}

// Names that identify the user in author fields (OPS_ME_NAMES="Lexus,Lexus D").
export function myNames(): string[] {
    return (process.env.OPS_ME_NAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function isMe(author: string): boolean {
    const names = myNames().map((n) => n.toLowerCase());
    const a = author.trim().toLowerCase();
    return names.length > 0 && names.some((n) => a === n || a.startsWith(`${n} <`) || a.includes(`<${n}>`));
}

export function mentionsMe(text: string): boolean {
    const names = myNames();
    const slackId = process.env.SLACK_MY_USER_ID;
    if (slackId && text.includes(`<@${slackId}>`)) return true;
    return names.length > 0 && wordPattern(names).test(text);
}
