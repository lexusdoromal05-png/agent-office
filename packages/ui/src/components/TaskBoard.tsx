import React, { useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { FloatingPanel } from './FloatingPanel';

interface TaskItem {
    id: number;
    title: string;
    assigned_to: string;
    status: string;
}

export function TaskBoard() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');

    useEffect(() => {
        const checkRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                room.onMessage('task-update', (data: any) => {
                    setTasks(prev => {
                        const existing = prev.find(t => t.title === data.task);
                        if (existing) {
                            return prev.map(t => t.title === data.task ? { ...t, status: data.status, assigned_to: data.agentId } : t);
                        }
                        return [...prev, { id: Date.now(), title: data.task, assigned_to: data.agentId, status: data.status }];
                    });
                });
                room.onMessage('tasks-sync', (serverTasks: any[]) => {
                    setTasks(serverTasks.map(t => ({
                        id: t.id,
                        title: t.title,
                        assigned_to: t.assigned_to || '',
                        status: t.status
                    })));
                });
                clearInterval(checkRoom);
            }
        }, 500);
        return () => clearInterval(checkRoom);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('assign-task', { title: newTask, agentId: targetAgent === 'auto' ? undefined : targetAgent });
            setNewTask('');
        }
    };

    const statusColor = (s: string) => {
        if (s === 'completed') return '#00b894';
        if (s === 'in_progress') return '#fdcb6e';
        return '#dfe6e9';
    };

    const statusIcon = (s: string) => {
        if (s === 'completed') return '✅';
        if (s === 'in_progress') return '🔄';
        return '⏳';
    };

    return (
        <FloatingPanel id="task-board" title="📋 Task Board" width={280} defaultDock="left" defaultY={20} zIndex={16}>
        <div style={{ maxHeight: '45vh', display: 'flex', flexDirection: 'column' }}>

            {/* Task Assignment Form */}
            <form onSubmit={handleSubmit} style={{ marginBottom: 10 }}>
                <input
                    type="text"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    placeholder="Assign a task..."
                    style={{
                        width: '100%', padding: '8px 10px', borderRadius: 6,
                        border: '1px solid #c9a7eb', backgroundColor: '#7a5a93',
                        color: 'white', fontSize: '12px', outline: 'none',
                        boxSizing: 'border-box', marginBottom: 6
                    }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                    <select
                        value={targetAgent}
                        onChange={(e) => setTargetAgent(e.target.value)}
                        style={{
                            flex: 1, padding: '6px', borderRadius: 6,
                            border: '1px solid #c9a7eb', backgroundColor: '#7a5a93',
                            color: '#aaa', fontSize: '11px'
                        }}
                    >
                        <option value="auto">🤖 Auto-assign</option>
                        <option value="killjoy">Mini-Vambby (Operations)</option>
                        <option value="jett">Lexus (Community)</option>
                        <option value="raze">Alon (Outreach)</option>
                        <option value="clove">Gideon (Engagement)</option>
                    </select>
                    <button type="submit" style={{
                        padding: '6px 14px', borderRadius: 6, border: 'none',
                        backgroundColor: '#e58fb6', color: 'white', fontSize: '11px',
                        cursor: 'pointer', fontWeight: 'bold'
                    }}>
                        Assign
                    </button>
                </div>
            </form>

            {/* Task List */}
            <div style={{ flex: 1, overflowY: 'auto', fontSize: '12px' }}>
                {tasks.length === 0 && (
                    <p style={{ color: '#e6d6f0', fontStyle: 'italic', margin: 0, fontSize: '11px' }}>
                        No tasks yet. Type above to assign work to agents!
                    </p>
                )}
                {tasks.map(task => (
                    <div key={task.id} style={{
                        padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        borderLeft: `3px solid ${statusColor(task.status)}`
                    }}>
                        <div style={{ fontWeight: 'bold', fontSize: '11px' }}>
                            {statusIcon(task.status)} {task.title}
                        </div>
                        <div style={{ fontSize: '10px', color: '#f2e6fa', marginTop: 2 }}>
                            → {task.assigned_to || 'Unassigned'}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: 8, fontSize: '10px', color: '#e6d6f0', borderTop: '1px solid #c9a7eb', paddingTop: 6 }}>
                🤖 Engine: Ollama Local • 💾 SQLite Persistence
            </div>
        </div>
        </FloatingPanel>
    );
}
