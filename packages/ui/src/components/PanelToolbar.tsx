import React, { useState } from 'react';
import { eventBus } from '../events';

const buttonStyle: React.CSSProperties = {
    border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
    background: 'rgba(26,14,34,0.92)', color: 'white', fontSize: 11, fontWeight: 700,
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
};

export function PanelToolbar({ hidden, onToggleHidden }: { hidden: boolean; onToggleHidden: () => void }) {
    const [fit, setFit] = useState(false);
    const minimizeAll = () => eventBus.dispatchEvent(new CustomEvent('panels-minimize-all'));
    const toggleFit = () => {
        eventBus.dispatchEvent(new CustomEvent('camera-fit', { detail: { fit: !fit } }));
        setFit(!fit);
    };

    const resetLayout = () => {
        try {
            Object.keys(window.localStorage)
                .filter((key) => key.startsWith('panel:'))
                .forEach((key) => window.localStorage.removeItem(key));
        } catch {
            // Storage unavailable; a reload still restores the default layout for this visit.
        }
        window.location.reload();
    };

    return (
        <div style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 6, zIndex: 50,
        }}>
            {!hidden && <button style={buttonStyle} onClick={minimizeAll} title="Shrink every panel to its title bar">➖ Minimize all</button>}
            <button style={{ ...buttonStyle, background: '#e2530f' }} onClick={onToggleHidden} title="Show or hide every panel">
                {hidden ? '👁 Show panels' : '🙈 Hide panels'}
            </button>
            <button style={buttonStyle} onClick={toggleFit} title="Zoom out to see the whole office, or zoom back in">
                {fit ? '🔍 Zoom in' : '🔍 Whole office'}
            </button>
            {!hidden && <button style={buttonStyle} onClick={resetLayout} title="Put every panel back where it started">↺ Reset layout</button>}
        </div>
    );
}
