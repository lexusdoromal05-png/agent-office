import React, { useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { TaskBoard } from './components/TaskBoard';
import { LayoutEditor } from './components/LayoutEditor';
import { SystemLog } from './components/SystemLog';
import { ViralControlPanel } from './components/ViralControlPanel';
import { HighlightsFeed } from './components/HighlightsFeed';
import { AgentPulseBoard } from './components/AgentPulseBoard';
import { RelationshipGraph } from './components/RelationshipGraph';
import { EpisodeRecapPanel } from './components/EpisodeRecapPanel';
import { CommandCenter } from './components/CommandCenter';
import { PanelToolbar } from './components/PanelToolbar';

export function App() {
    const [panelsHidden, setPanelsHidden] = useState(false);

    return (
        <>
            <PanelToolbar hidden={panelsHidden} onToggleHidden={() => setPanelsHidden((h) => !h)} />
            <div style={{ display: panelsHidden ? 'none' : 'block' }}>
            <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white', backgroundColor: 'rgba(26,14,34,0.88)', padding: '12px 16px', borderRadius: '10px', zIndex: 10, border: '1px solid rgba(255,122,26,0.5)' }}>
                <h1 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: 8 }}>🎃 AgentOffice</h1>
                <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: '11px' }}>Haunted Halloween edition 👻</p>
            </div>
            <ChatPanel />
            <TaskBoard />
            <LayoutEditor />
            <SystemLog />
            <ViralControlPanel />
            <RelationshipGraph />
            <HighlightsFeed />
            <AgentPulseBoard />
            <EpisodeRecapPanel />
            <CommandCenter />
            </div>
        </>
    );
}
