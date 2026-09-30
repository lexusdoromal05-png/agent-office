import express from 'express';
import { Server } from 'colyseus';
import { createServer } from 'http';
import { OfficeRoom } from './rooms/OfficeRoom';
import { OllamaAdapter } from '@agent-office/adapters';
import { AGENT_MODEL, OLLAMA_URL } from './config';
import { DEFAULT_AGENT_ID, TEAM } from './team';
import { OpsStore } from './ops/OpsStore';
import { BusyError, COMMAND_LABELS, UserError, OpsAgent, parseCommand } from './ops/OpsAgent';
import { parseIngest, parseWhatsAppWebhook, verifyWhatsAppSignature } from './ops/connectors/inbox';
import { env } from './ops/connectors/http';
import { ACCOUNTS } from './ops/watchlist';
import { CommandKind } from './ops/types';

// Setup Express. The raw body is kept so webhook signatures can be verified.
const app = express();
app.use(express.json({
    limit: '2mb',
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));

// Basic REST API for Office Management
app.get('/api/offices', (req, res) => {
    res.json({ status: 'ok', offices: [] });
});

app.post('/api/vote-chaos', (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (!room) {
        res.status(503).json({ ok: false, error: 'No active office room.' });
        return;
    }
    const { event, voterId } = req.body || {};
    const result = room.registerAudienceVote(event || 'server_outage', voterId);
    res.json({ ok: true, ...result });
});

app.get('/api/episode-recap', (req, res) => {
    const room = OfficeRoom.getActiveRoom();
    if (!room) {
        res.status(503).json({ ok: false, error: 'No active office room.' });
        return;
    }
    res.json({ ok: true, recap: room.getEpisodeRecap() });
});

// ─── Cypher: connector-first operations agent ───
const opsStore = new OpsStore();
const opsReady = opsStore.initialize();
const cypher = new OpsAgent(new OllamaAdapter(OLLAMA_URL), process.env.OPS_MODEL || AGENT_MODEL, opsStore);
const COMMANDS = Object.keys(COMMAND_LABELS) as CommandKind[];

type Handler = (req: express.Request, res: express.Response) => Promise<void>;
const route = (handler: Handler) => async (req: express.Request, res: express.Response) => {
    try {
        await opsReady;
        await handler(req, res);
    } catch (e: any) {
        res.status(e instanceof BusyError ? 409 : e instanceof UserError ? 400 : 500).json({ ok: false, error: String(e?.message || e) });
    }
};

const text = (value: any, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

app.get('/api/ops/status', route(async (req, res) => {
    const member = TEAM[DEFAULT_AGENT_ID];
    res.json({
        ok: true,
        agent: { id: DEFAULT_AGENT_ID, name: member.name, role: member.role },
        connectors: cypher.connectorStatus(),
        accounts: ACCOUNTS.map((a) => a.name),
        commands: COMMANDS.filter((c) => c !== 'ask').map((c) => ({ id: c, label: COMMAND_LABELS[c] })),
    });
}));

app.post('/api/ops/run', route(async (req, res) => {
    const typed = text(req.body?.text, 2000);
    const requested = COMMANDS.includes(req.body?.command) ? { command: req.body.command as CommandKind, arg: text(req.body?.arg, 2000) } : null;
    const { command, arg } = requested || parseCommand(typed);
    if (command === 'ask' && arg.length < 3) {
        res.status(400).json({ ok: false, error: 'Type a question or pick a command.' });
        return;
    }
    const room = OfficeRoom.getActiveRoom();
    const label = command === 'ask' ? `Question: ${arg.slice(0, 60)}` : COMMAND_LABELS[command];
    room?.startAgentJob(DEFAULT_AGENT_ID, label, `🛰️ Sweeping connected systems for "${label}"…`);
    try {
        const brief = await cypher.run(command, arg);
        room?.finishAgentJob(DEFAULT_AGENT_ID, '✅ Brief ready in the Command Center.');
        res.json({ ok: true, brief });
    } catch (e) {
        room?.finishAgentJob(DEFAULT_AGENT_ID, `⚠️ Sweep failed: ${(e as Error).message}`);
        throw e;
    }
}));

app.get('/api/ops/briefs', route(async (req, res) => {
    res.json({ ok: true, briefs: await opsStore.listBriefs() });
}));

app.get('/api/ops/items', route(async (req, res) => {
    res.json({ ok: true, items: await opsStore.listItems(req.query.all !== '1') });
}));

app.post('/api/ops/items/close', route(async (req, res) => {
    const ok = await opsStore.closeItem(text(req.body?.key, 200));
    res.status(ok ? 200 : 404).json({ ok });
}));

app.get('/api/ops/actions', route(async (req, res) => {
    res.json({ ok: true, actions: await cypher.listActions() });
}));

app.patch('/api/ops/actions/:id', route(async (req, res) => {
    const action = await cypher.editAction(Number(req.params.id), {
        body: typeof req.body?.body === 'string' ? req.body.body.slice(0, 4000) : undefined,
        target: typeof req.body?.target === 'string' ? req.body.target.trim().slice(0, 200) : undefined,
    });
    res.json({ ok: true, action });
}));

// Explicit user approval: the only path that performs an external write.
app.post('/api/ops/actions/:id/execute', route(async (req, res) => {
    if (req.body?.approved !== true) {
        res.status(400).json({ ok: false, error: 'Approval is required to execute an action.' });
        return;
    }
    const action = await cypher.executeAction(Number(req.params.id));
    res.status(action.status === 'executed' ? 200 : 502).json({ ok: action.status === 'executed', action, error: action.status === 'executed' ? undefined : action.result });
}));

app.post('/api/ops/actions/:id/reject', route(async (req, res) => {
    res.json({ ok: true, action: await cypher.rejectAction(Number(req.params.id)) });
}));

// WhatsApp Business Cloud API webhook: verification handshake, then signed message deliveries.
app.get('/api/webhooks/whatsapp', (req, res) => {
    const token = env('WHATSAPP_VERIFY_TOKEN');
    if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
        res.status(200).send(String(req.query['hub.challenge'] || ''));
        return;
    }
    res.sendStatus(403);
});

app.post('/api/webhooks/whatsapp', route(async (req, res) => {
    if (!verifyWhatsAppSignature((req as any).rawBody || Buffer.from(''), req.header('x-hub-signature-256'))) {
        res.sendStatus(401);
        return;
    }
    for (const record of parseWhatsAppWebhook(req.body)) await opsStore.addInbox(record);
    res.sendStatus(200);
}));

// Generic push endpoint for meeting transcripts, CRM events, dashboards, and other tools.
app.post('/api/ops/ingest', route(async (req, res) => {
    const token = env('OPS_INGEST_TOKEN');
    if (!token || req.header('authorization') !== `Bearer ${token}`) {
        res.status(401).json({ ok: false, error: 'Invalid or missing ingest token.' });
        return;
    }
    const entries = Array.isArray(req.body) ? req.body : [req.body];
    let added = 0;
    for (const entry of entries.slice(0, 200)) {
        const record = parseIngest(entry);
        if (typeof record === 'string') {
            res.status(400).json({ ok: false, error: record, added });
            return;
        }
        if (await opsStore.addInbox(record)) added++;
    }
    res.json({ ok: true, added });
}));

// Create HTTP and Colyseus server
const httpServer = createServer(app);
const colyseusServer = new Server({
    server: httpServer,
});

// Define Rooms
colyseusServer.define('office', OfficeRoom);

// Start listening
const PORT = Number(process.env.PORT || 3000);
colyseusServer.listen(PORT).then(() => {
    console.log(`[Server] AgentOffice Engine listening on ws://localhost:${PORT}`);
});
