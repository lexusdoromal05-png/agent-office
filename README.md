# 🏢 AgentOffice

**Self-growing AI teams in a pixel-art virtual office — powered by local LLMs.**

Watch AI agents walk to desks, think, collaborate, hire interns, assign tasks to each other, execute code, search the web, and grow their team — all rendered in real-time pixel art with persistent memory across sessions.

> **Zero lock-in.** Runs 100% locally with Ollama. Swap for any OpenAI-compatible API.



https://github.com/user-attachments/assets/da76e31d-ff34-4ce1-9092-5bf9e6ee2058



[https://youtu.be/GgrK8K9RlIA](https://youtu.be/GgrK8K9RlIA)

<img width="1697" height="1272" alt="Screenshot at Feb 25 00-15-59" src="https://github.com/user-attachments/assets/9ed16692-09d9-44e4-a258-f796f9479afb" />
<img width="1694" height="1272" alt="Screenshot at Feb 25 00-16-31" src="https://github.com/user-attachments/assets/f592359a-ba96-45fc-bb5e-07ec88583a10" />
<img width="1699" height="1278" alt="screencapture-localhost-5173-2026-02-25-00_05_15" src="https://github.com/user-attachments/assets/4a604b86-1aaf-4b0d-985b-51afe7d71586" />
<img width="1699" height="1278" alt="screencapture-localhost-5173-2026-02-25-00_04_54" src="https://github.com/user-attachments/assets/4f2811ff-a66e-47e3-9d0f-184123e75e01" />
<img width="1699" height="1278" alt="screencapture-localhost-5173-2026-02-25-00_04_44" src="https://github.com/user-attachments/assets/8773814e-9414-4c62-a098-8f5a205db187" />
<img width="1695" height="1270" alt="Screenshot at Feb 25 00-18-57" src="https://github.com/user-attachments/assets/1591cb0e-9aea-4728-8f01-9f7a2c8d5ac2" />
<img width="2018" height="1268" alt="Screenshot at Feb 25 00-34-36" src="https://github.com/user-attachments/assets/f719ad99-f4ba-4998-8c9b-68818061bc60" />

---

## ✨ What Can It Do?

| Feature | Description |
|---------|-------------|
| 🧠 **LLM-Powered Agents** | Each agent has their own Ollama-powered brain with personality traits |
| 💬 **Agent-to-Agent Conversations** | Agents talk to each other autonomously and respond to messages |
| 🎯 **Click-to-Follow Focus Mode** | Click any agent sprite to have the camera smoothly track them |
| 📋 **UI Task Assignment** | Assign tasks from the TaskBoard — or agents create tasks for each other |
| 🤝 **Dynamic Hiring** | Agents can hire new team members (interns, devs, designers) on their own |
| 🔧 **Tool Execution** | Sandboxed JS execution, web search, note-taking, file reading |
| 💾 **Persistent Memory** | SQLite-backed memories survive server restarts with importance-weighted recall |
| 🔍 **Semantic Memory Search** | Ollama embeddings + cosine similarity for intelligent memory retrieval |
| 🏗️ **Layout Editor** | Drag-and-drop furniture placement, saved to database |
| 📊 **System Activity Log** | Real-time feed of all agent events with deduplication |
| 💡 **Emote Bubbles** | Action-specific emoji (💻💬😌🔧🚶💡) above agent sprites |
| 🪑 **Furniture Interaction** | Agents walk TO desks to work, approach each other to talk |

---

## 🛰️ Cypher — Connector-First Operations Agent

🎃 **Halloween edition:** the pink pastel office is decorated with pumpkins, cobwebs, bat bunting, candles, spiders, candy, and a friendly ghost. The team is Mini-Vambby (operations), Lexus (community), Alon (outreach), and Gideon (engagement), and each server start hands out the witch, vampire, mummy, and pumpkin costumes at random.

**Team meetings:** open the 🎃 Team Meeting panel, press **Call meeting**, then use the buttons (updates, blockers, what's next, anything urgent) or type any question. Each agent answers from what they actually did today; name someone ("Alon, how is outreach going?") and only they answer. Anything you type in Office Chat during a meeting gets answered the same way.

The operations agent, Mini-Vambby (called **Cypher** below), is a chief-of-staff agent that reads your connected work systems, reconciles what each one says, and briefs you on what needs you. It lives at its desk in the office and in the **🛰️ Command Center** panel.

| Command | What Cypher does |
|---------|------------------|
| ☀️ **START MY DAY** | Sweeps every connector since the last sweep (or the previous working day) and builds the Daily Executive Brief |
| 👥 **WHAT IS HAPPENING WITH THE TEAM?** | Critical / Needs my action / Blocked / Waiting / On track / Potential risk |
| 🏢 **WHAT IS HAPPENING WITH THE CLIENT?** | What the client said vs. what our team said, current reality, open action, risk, recommended response |
| 🔍 **WHAT AM I MISSING?** | Broader two-week sweep ranked by operational importance |
| ▶️ **WHAT SHOULD I DO NOW?** | Refreshes, then DO THIS NOW + the next three |
| 💬 Any question | e.g. "Did Bobby approve the Tomoland deck?" — answered from sources, with citations |

**How it works**

1. **Sweep** — Slack, WhatsApp, Gmail, Jira, Calendar, Drive/Docs/Sheets/Slides, Notion, Discord, and anything pushed to the ingest API are read in parallel.
2. **Raw extraction** — every statement is kept verbatim with its source, author, and timestamp, and tagged with watched accounts and people (`packages/server/src/ops/watchlist.ts`).
3. **Reconciliation** — the model merges records about the same work into one item and must cite record IDs. Citations to anything that was not read are dropped and the item is marked **UNSOURCED**; chat alone can never mark work "Done (verified)"; client mood without the client's own words becomes **Unknown**; contradictions are shown, not resolved.
4. **Operational model** — items persist in SQLite and are updated on every sweep instead of being rebuilt from scratch.
5. **Brief** — rendered in fixed formats with sources, **STATUS MAY BE STALE** markers (evidence older than 48h), and an **ACCESS GAP** block for every connector that is disconnected, failing, or incomplete.

**Read before write.** Cypher only ever *proposes* messages or comments. They sit in *Pending actions* until you press **Approve & send**, and they are marked sent only when Slack or Jira returns a confirmation. Other action types (email, WhatsApp) are copy-and-send. Standing authorization per action type is opt-in through `OPS_STANDING_AUTH`.

**Anthony follow-up rule.** Every sweep looks back two weeks for your last request to Anthony and his last response. If reporting is still outstanding it flags **FOLLOW-UP REQUIRED — ANTHONY**, or says a follow-up was already sent today so you don't ping twice.

**Connecting systems.** Copy `.env.example` to `.env` and fill in only what you use; everything else shows up as an ACCESS GAP. Set `OPS_ME_NAMES` so Cypher can recognise your own messages and mentions. Notes:
- **WhatsApp** — uses the WhatsApp Business Cloud API webhook (`/api/webhooks/whatsapp`), so only messages to the connected business number are visible. Personal WhatsApp chats have no official API.
- **Everything else** (meeting transcripts, CRM, dashboards) — `POST /api/ops/ingest` with `Authorization: Bearer $OPS_INGEST_TOKEN` and `{ "source", "author", "text", "timestamp", "url" }`.
- **Model** — briefs use `OPS_MODEL` (falls back to `OLLAMA_MODEL`). Reconciling dozens of records works much better with a larger model than the 7B default.

**In Claude Code.** The same operating mode ships as a Claude Code subagent in [`.claude/agents/cypher.md`](.claude/agents/cypher.md). In a Claude Code session with your Slack, Gmail, Jira, Google Drive, or other MCP connectors attached, ask "START MY DAY" and Claude hands it to Cypher, which uses those connectors directly.

---

## 🎬 How It Works

```
You open the browser → pixel-art office loads → Alice (Engineer) and Bob (PM) spawn
  → Each agent runs a think loop every ~15s via Ollama
  → LLM returns: { thought, action, target, toolCall }
  → Server executes the action (move, talk, use_tool, hire_agent)
  → Colyseus syncs state to all connected browsers in real-time
  → Agents remember everything via SQLite + Ollama embeddings
  → Teams grow as agents decide to hire new members 🚀
```

---

## 🏗️ Architecture

```
agent-office/
├── packages/
│   ├── core/          # Agent state machine, Memory, Tasks, Office grid
│   ├── adapters/      # OllamaAdapter, OpenAICompatibleAdapter, PromptBuilder
│   ├── server/        # Colyseus rooms, ToolExecutor, MemoryStore (SQLite)
│   ├── ui/            # Phaser.js game + React overlay (Chat, TaskBoard, SystemLog)
│   └── cli/           # Scaffold & management commands
├── examples/
│   └── ollama-startup/  # Demo office with 2 agents
├── docs/              # Documentation (Docusaurus)
└── docker-compose.yml # One-command deployment
```

**Data Flow:**
```
Ollama ←→ OllamaAdapter ←→ Agent.think() ←→ Colyseus State ←→ Phaser + React UI
                                  ↕                  ↕
                           MemoryStore (SQLite)   ToolExecutor
                           Embeddings (Ollama)    (code, search, tasks)
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | ≥ 18 | Runtime |
| **npm** | ≥ 9 | Package manager (workspaces) |
| **Ollama** | Latest | Local LLM inference |

### Setup

```bash
# Clone & install
git clone https://github.com/AjStraworern/agent-office.git
cd agent-office
npm install

# Pull the model
ollama pull llama3.2

# Build all packages
npm run build

# Terminal 1: Start server
npm run start --workspace=@agent-office/server

# Terminal 2: Start UI
npm run dev --workspace=@agent-office/ui
```

Open **http://localhost:5173**, open the **🛰️ Command Center** panel, and press **START MY DAY**. Connect your systems first (see *Cypher* above).

---

## 🐳 Docker Deployment

```bash
docker compose up --build
```

This starts the **server** (port 3000), **UI** (port 80), **Ollama** (with GPU), and **Redis** (for scaling).

> For CPU-only, remove the `deploy.resources` section from `docker-compose.yml`.

---

## 🔧 Configuration

### Change the LLM Model

Edit `packages/server/src/rooms/OfficeRoom.ts`:

```typescript
inference: {
    provider: 'ollama',
    model: 'llama3.2:latest',  // ← Change to any Ollama model
    systemPrompt: '...',
},
```

### Use OpenAI / Gaia / OpenRouter

```typescript
import { OpenAICompatibleAdapter } from '@agent-office/adapters';

private adapter = new OpenAICompatibleAdapter(
    'https://api.openai.com/v1',
    'sk-your-key-here',
    'gpt-4o-mini'
);
```

### Add Agents Manually

```typescript
await setupCoreAgent('charlie', 'Charlie', 'Designer', 15, 15);
```

Or let existing agents hire them dynamically via LLM! 🤝

---

## 🍴 Fork It & Build Your Own

AgentOffice is designed to be forked and customized. Here's how:

### Step 1: Fork & Clone

```bash
# Fork on GitHub, then:
git clone https://github.com/YOUR_USERNAME/agent-office.git
cd agent-office && npm install
```

### Step 2: Customize Agents

Edit `packages/server/src/rooms/OfficeRoom.ts` to change agent names, roles, personalities, and system prompts. The personality traits (openness, conscientiousness, extraversion, agreeableness, neuroticism) directly influence agent behavior.

### Step 3: Add Custom Tools

Create new tools in `packages/server/src/tools/ToolExecutor.ts`:

```typescript
case 'my_custom_tool':
    return this.myCustomTool(params);
```

Then add the capability to the agent config.

### Step 4: Change the Office Layout

Modify `furnitureTargets` in `OfficeRoom.ts` or use the in-browser Layout Editor to place and save furniture.

---

## 💡 Ideas: What Can You Build With This?

| Use Case | Description |
|----------|-------------|
| 🎓 **AI Classroom** | Teacher agent assigns lessons, student agents learn and ask questions |
| 🏥 **Virtual Hospital** | Doctor, nurse, and patient agents simulate a medical workflow |
| 🏭 **Factory Simulation** | Agents manage assembly lines, quality control, and logistics |
| 🎮 **Game NPC Engine** | Use AgentOffice as the brain for NPCs in your game |
| 📊 **Business Simulation** | CEO, CTO, and team agents run a startup — watch strategy emerge |
| 🧪 **Research Lab** | Agents read papers, discuss findings, and write collaborative reports |
| 🤖 **AI Interview Simulator** | Interviewer and candidate agents practice technical interviews |
| 🎭 **Social Experiment** | Study emergent behavior in AI agent groups with different personalities |
| 📚 **Study Group** | Agents quiz each other, explain concepts, and track learning progress |
| 🏗️ **DevOps Team** | Agents monitor services, create incident tickets, and coordinate fixes |

---

## 📦 Package Overview

| Package | Description |
|---------|-------------|
| `@agent-office/core` | Agent lifecycle (Perceive → Think → Act), Office grid, Task system, Memory with importance scoring |
| `@agent-office/adapters` | InferenceAdapter interface, OllamaAdapter, OpenAICompatibleAdapter, PromptBuilder |
| `@agent-office/server` | Colyseus room, game loop, ToolExecutor (code/search/notes), MemoryStore (SQLite + embeddings), Cypher ops agent and connectors (`src/ops`) |
| `@agent-office/ui` | Phaser.js renderer, React overlay (Chat, TaskBoard, Inspector, SystemLog, LayoutEditor) |
| `@agent-office/cli` | `create-agent-office` scaffold, `add-agent` commands |

---

## 🧪 Testing

```bash
npm test                                    # All tests
npm test --workspace=@agent-office/core     # Core only
npm test --workspace=@agent-office/adapters # Adapters only
npx jest packages/server                    # Cypher ops agent
```

---

## 🗺️ Roadmap

- [x] Multi-agent conversations
- [x] UI task assignment
- [x] Persistent memory (SQLite)
- [x] Tool execution (code, search)
- [x] Custom layout editor
- [x] Agent Focus Mode
- [x] Dynamic agent hiring
- [x] Semantic memory search
- [x] System Activity Log
- [x] Emote Bubbles
- [ ] Voice mode (TTS/STT)
- [ ] GitHub PR integration
- [ ] Slack/Discord bridge
- [ ] Multiple office floors
- [ ] Plugin system for custom behaviors
- [ ] Mobile companion app

---

## 📘 Changelog

See release notes in [CHANGELOG.md](./CHANGELOG.md).

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

**Built with** Phaser.js · Colyseus · React · Ollama · SQLite · TypeScript

**Star ⭐ this repo** if you think AI agents deserve their own office!

💙 Shout out to @pablodelucca for building and inspiring this project with [https://github.com/pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents)
