import Phaser from 'phaser';
import * as Colyseus from 'colyseus.js';
import { OfficeState, AgentState } from './schema';
import { eventBus } from '../events';

// Agents wear the sprite sheet for their Halloween costume; anyone without one falls back to char_0.
const COSTUMES = ['witch', 'vampire', 'mummy', 'pumpkin'];
const SPRITE_KEYS = ['char_0', 'char_1', 'boss', ...COSTUMES.map((c) => `costume_${c}`)];

let activeRoom: Colyseus.Room<OfficeState> | undefined;

export function getColyseusRoom() {
    return activeRoom;
}

function resolveWsEndpoint(): string {
    if (typeof window !== 'undefined') {
        const queryWs = new URLSearchParams(window.location.search).get('ws');
        if (queryWs && queryWs.trim()) {
            window.localStorage.setItem('agent-office:ws-url', queryWs.trim());
            return queryWs.trim();
        }
        const savedWs = window.localStorage.getItem('agent-office:ws-url');
        if (savedWs && savedWs.trim()) return savedWs.trim();
    }
    const globalEndpoint = typeof window !== 'undefined'
        ? (window as any).__AGENT_OFFICE_WS_URL as string | undefined
        : undefined;
    if (globalEndpoint && globalEndpoint.trim()) return globalEndpoint.trim();
    if (typeof window !== 'undefined') {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.hostname}:3000`;
    }
    return 'ws://localhost:3000';
}

export class OfficeScene extends Phaser.Scene {
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private room?: Colyseus.Room;
    private agentSprites: Map<string, Phaser.GameObjects.Container> = new Map();
    private statusText!: Phaser.GameObjects.Text;
    private followTarget: Phaser.GameObjects.Container | null = null;
    private cinematicMode = true;
    private meetingView = false;
    private fitView = false;
    private cinematicReleaseAt = 0;
    private customLayoutLayer?: Phaser.GameObjects.Container;
    private layoutItems: Array<{ id: string; type: string; x: number; y: number; label?: string }> = [];
    private layoutEditMode = false;
    private layoutDragItemId: string | null = null;
    private gridSize = 40 * 16;
    private heldMoveKeys: Set<'left' | 'right' | 'up' | 'down'> = new Set();

    constructor() {
        super('OfficeScene');
    }

    private drawHalloweenDecor() {
        const deco = (x: number, y: number, emoji: string, size = 16, depth = 2) =>
            this.add.text(x, y, emoji, { fontSize: `${size}px` }).setOrigin(0.5).setDepth(depth);

        // Cobwebs in the corners
        deco(22, 22, '🕸️', 26);
        deco(this.gridSize - 22, 22, '🕸️', 26).setFlipX(true);
        deco(22, this.gridSize - 22, '🕸️', 22).setFlipY(true);
        deco(this.gridSize - 22, this.gridSize - 22, '🕸️', 22);

        // Flickering jack-o'-lanterns
        const lanterns = [[40, 200], [130, 200], [260, 200], [520, 360], [40, 470], [560, 185], [300, 560], [470, 560]];
        lanterns.forEach(([x, y], i) => {
            const glow = this.add.circle(x, y, 14, 0xff8c2e, 0.25).setDepth(1);
            const lantern = deco(x, y, '🎃', 18);
            this.tweens.add({ targets: [glow], alpha: 0.05, scale: 1.3, duration: 260 + i * 37, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
            this.tweens.add({ targets: lantern, angle: { from: -4, to: 4 }, duration: 900 + i * 50, yoyo: true, repeat: -1 });
        });

        // Candles on the meeting table and desks
        [[140, 70], [180, 70], [100, 250], [100, 330], [100, 410], [188, 250]].forEach(([x, y], i) => {
            const candle = deco(x, y, '🕯️', 11, 4);
            this.tweens.add({ targets: candle, alpha: 0.6, duration: 180 + i * 23, yoyo: true, repeat: -1 });
        });

        // Gravestones and a cauldron in the lounge
        deco(470, 110, '🪦', 18); deco(500, 120, '🪦', 16); deco(440, 125, '🪦', 14);
        const cauldron = deco(610, 300, '🫕', 20);
        const bubbles = deco(610, 285, '🟢', 6, 3);
        this.tweens.add({ targets: bubbles, y: 270, alpha: 0, duration: 1400, repeat: -1 });
        this.tweens.add({ targets: cauldron, scaleX: 1.05, duration: 700, yoyo: true, repeat: -1 });

        // Hanging spiders bobbing on their threads
        [120, 330, 590].forEach((x, i) => {
            const thread = this.add.line(0, 0, x, 0, x, 40, 0xd9c7e6, 0.6).setOrigin(0).setDepth(5);
            const spider = deco(x, 40, '🕷️', 12, 5);
            this.tweens.add({ targets: spider, y: 70, duration: 1800 + i * 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
            this.tweens.add({ targets: thread, scaleY: 1.75, duration: 1800 + i * 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        });

        // Bats and a ghost drifting across the office
        for (let i = 0; i < 5; i++) {
            const bat = deco(-30, 60 + i * 110, '🦇', 14, 60);
            this.tweens.add({
                targets: bat, x: this.gridSize + 30, y: `+=${(i % 2 ? -1 : 1) * 40}`,
                duration: 9000 + i * 1700, delay: i * 2300, repeat: -1, ease: 'Sine.easeInOut',
            });
        }
        const ghost = deco(this.gridSize + 40, 330, '👻', 22, 60).setAlpha(0.7);
        this.tweens.add({ targets: ghost, x: -40, duration: 16000, repeat: -1, delay: 4000 });
        this.tweens.add({ targets: ghost, y: 300, alpha: 0.35, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    preload() {
        for (const key of SPRITE_KEYS) {
            this.load.spritesheet(key, `/assets/characters/${key}.png`, {
                frameWidth: 16,
                frameHeight: 32
            });
        }
    }

    create() {
        try {
            console.log("Phaser create() started");
            this.statusText = this.add.text(10, 10, 'Colyseus Sync: Connecting...', { color: '#ffffaa', fontSize: '14px', backgroundColor: '#140c1acc', padding: { x: 6, y: 3 } });
            this.statusText.setScrollFactor(0);
            this.statusText.setDepth(100);

            let hasAnims = false;

            for (const key of SPRITE_KEYS) {
                if (!this.textures.exists(key)) continue;
                const anims = this.anims;
                anims.create({ key: `${key}-walk-down`, frames: anims.generateFrameNumbers(key, { start: 0, end: 2 }), frameRate: 8, repeat: -1 });
                anims.create({ key: `${key}-walk-up`, frames: anims.generateFrameNumbers(key, { start: 7, end: 9 }), frameRate: 8, repeat: -1 });
                anims.create({ key: `${key}-walk-right`, frames: anims.generateFrameNumbers(key, { start: 14, end: 16 }), frameRate: 8, repeat: -1 });
                hasAnims = true;
            }

            console.log("Animations created: ", hasAnims);

            const gridSize = this.gridSize;
            const g = this.add.graphics();

            // ═══════════════════════════════════════════
            //  FLOORING
            // ═══════════════════════════════════════════

            // Main office floor (warm grey carpet)
            g.fillStyle(0x2a1a33, 1);
            g.fillRect(0, 0, gridSize, gridSize);

            // Work area floor (slightly lighter)
            g.fillStyle(0x33203f, 1);
            g.fillRect(16, 16, gridSize - 32, gridSize - 32);

            // Meeting room carpet (purple-tinted)
            g.fillStyle(0x352447, 1);
            g.fillRect(32, 32, 200, 160);

            // Collab area carpet (warm orange-tinted)
            g.fillStyle(0x4a3520, 1);
            g.fillRect(280, 32, 200, 160);

            // Coffee area tiles (subtle checkerboard)
            for (let tx = 0; tx < 11; tx++) {
                for (let ty = 0; ty < 11; ty++) {
                    g.fillStyle((tx + ty) % 2 === 0 ? 0x3b2c1f : 0x2e2040, 1);
                    g.fillRect(350 + tx * 16, 350 + ty * 16, 16, 16);
                }
            }

            // ═══════════════════════════════════════════
            //  WALLS & PARTITIONS
            // ═══════════════════════════════════════════

            // Meeting room walls
            g.lineStyle(3, 0x6b3fa0, 0.9);
            g.strokeRect(32, 32, 200, 160);
            // Door gap (bottom-right of meeting room)
            g.fillStyle(0x33203f, 1);
            g.fillRect(192, 188, 40, 6);

            // Collab area walls
            g.lineStyle(3, 0xff7a1a, 0.9);
            g.strokeRect(280, 32, 200, 160);
            // Door gap
            g.fillStyle(0x33203f, 1);
            g.fillRect(280, 160, 40, 6);

            // Coffee area border
            g.lineStyle(2, 0xf2a007, 0.7);
            g.strokeRect(350, 350, 176, 176);
            // Door gap
            g.fillStyle(0x33203f, 1);
            g.fillRect(350, 410, 4, 40);

            // Room labels
            this.add.text(132, 46, '🏢 Meeting Room', { fontSize: '10px', color: '#b58be0' }).setOrigin(0.5);
            this.add.text(380, 46, '💡 Collab Area', { fontSize: '10px', color: '#ffb627' }).setOrigin(0.5);
            this.add.text(438, 364, '☕ Coffee & Pantry', { fontSize: '10px', color: '#ff8c2e' }).setOrigin(0.5);

            // ═══════════════════════════════════════════
            //  MEETING ROOM FURNITURE
            // ═══════════════════════════════════════════

            // Large meeting table
            g.fillStyle(0xc85a12, 1);
            g.fillRect(72, 80, 120, 60);
            g.fillStyle(0x3a2342, 1);
            g.fillRect(76, 84, 112, 52); // table top highlight

            // Chairs around meeting table (pixel circles)
            const chairColor = 0x3f2656;
            const chairs = [[92, 72], [132, 72], [172, 72], // top row
            [92, 148], [132, 148], [172, 148], // bottom row
            [64, 100], [64, 128], // left
            [200, 100], [200, 128]]; // right
            chairs.forEach(([cx, cy]) => {
                g.fillStyle(chairColor, 1);
                g.fillCircle(cx, cy, 6);
                g.fillStyle(0x302142, 1);
                g.fillCircle(cx, cy, 4);
            });

            // Whiteboard on meeting room wall
            g.fillStyle(0x3d2a4a, 1);
            g.fillRect(48, 36, 60, 30);
            g.lineStyle(2, 0x4b2d63, 1);
            g.strokeRect(48, 36, 60, 30);
            // Whiteboard scribbles
            g.lineStyle(1, 0x2b7f6b, 0.6);
            g.beginPath();
            g.moveTo(54, 46); g.lineTo(70, 42); g.lineTo(85, 50); g.lineTo(100, 44);
            g.strokePath();
            g.lineStyle(1, 0xe2530f, 0.6);
            g.beginPath();
            g.moveTo(54, 54); g.lineTo(75, 58); g.lineTo(95, 52);
            g.strokePath();

            // ═══════════════════════════════════════════
            //  COLLAB AREA FURNITURE
            // ═══════════════════════════════════════════

            // Standing desks (2 side by side)
            g.fillStyle(0xa6440f, 1);
            g.fillRect(300, 70, 48, 28);
            g.fillStyle(0x3f2547, 1);
            g.fillRect(302, 72, 44, 24);

            g.fillStyle(0xa6440f, 1);
            g.fillRect(410, 70, 48, 28);
            g.fillStyle(0x3f2547, 1);
            g.fillRect(412, 72, 44, 24);

            // Laptops on standing desks
            const drawLaptop = (lx: number, ly: number) => {
                g.fillStyle(0x4b2d63, 1);
                g.fillRect(lx, ly, 16, 10); // screen
                g.fillStyle(0x140c1a, 1);
                g.fillRect(lx + 1, ly + 1, 14, 8);
                g.fillStyle(0x4b2d63, 1);
                g.fillRect(lx - 1, ly + 10, 18, 3); // keyboard
            };
            drawLaptop(312, 76);
            drawLaptop(424, 76);

            // Bean bags / lounge chairs in collab
            g.fillStyle(0xff7a1a, 0.6);
            g.fillCircle(320, 150, 14);
            g.fillStyle(0xffb627, 0.6);
            g.fillCircle(370, 155, 14);
            g.fillStyle(0x6b3fa0, 0.6);
            g.fillCircle(430, 148, 14);

            // ═══════════════════════════════════════════
            //  WORK DESKS (with chairs in front)
            // ═══════════════════════════════════════════

            const drawWorkstation = (x: number, y: number, label: string, occupied: boolean) => {
                // Desk surface
                g.fillStyle(0xa6440f, 1);
                g.fillRect(x, y, 56, 28);
                g.fillStyle(0xc85a12, 1);
                g.fillRect(x + 2, y + 2, 52, 24);

                // Monitor
                g.fillStyle(0x140c1a, 1);
                g.fillRect(x + 6, y + 3, 22, 14); // bezel
                g.fillStyle(occupied ? 0x3ba88f : 0x140c1a, 1);
                g.fillRect(x + 8, y + 5, 18, 10); // screen glow
                g.fillStyle(0x4b2d63, 1);
                g.fillRect(x + 14, y + 17, 10, 3); // stand
                g.fillRect(x + 10, y + 20, 18, 2); // base

                // Keyboard
                g.fillStyle(0x5a3a70, 1);
                g.fillRect(x + 6, y + 22, 18, 4);

                // Mouse
                g.fillStyle(0x5a3a70, 1);
                g.fillRect(x + 28, y + 22, 5, 4);

                // Notepad
                g.fillStyle(0x5a3f1f, 1);
                g.fillRect(x + 36, y + 6, 12, 16);
                g.lineStyle(1, 0xffb627, 0.8);
                g.beginPath();
                g.moveTo(x + 38, y + 10); g.lineTo(x + 46, y + 10);
                g.moveTo(x + 38, y + 14); g.lineTo(x + 46, y + 14);
                g.moveTo(x + 38, y + 18); g.lineTo(x + 44, y + 18);
                g.strokePath();

                // Pen
                g.fillStyle(0x2b7f6b, 1);
                g.fillRect(x + 50, y + 8, 2, 12);

                // Coffee mug
                g.fillStyle(0xe2530f, 1);
                g.fillCircle(x + 37, y + 24, 3);
                g.fillStyle(0x140c1a, 1);
                g.fillCircle(x + 37, y + 24, 1.5);

                // Office chair (below desk)
                g.fillStyle(0x140c1a, 1);
                g.fillCircle(x + 22, y + 38, 8);
                g.fillStyle(occupied ? 0x6b3fa0 : 0x3f2656, 1);
                g.fillCircle(x + 22, y + 38, 6);

                // Label
                this.add.text(x + 28, y - 6, label, { fontSize: '8px', color: '#b58be0' }).setOrigin(0.5);
            };

            drawWorkstation(64, 240, '🧙 Witch\'s Desk', true);
            drawWorkstation(64, 320, '🧛 Vampire\'s Desk', true);
            drawWorkstation(64, 400, '🧟 Mummy\'s Desk', true);
            drawWorkstation(152, 240, '🎃 Pumpkin\'s Desk', true);

            // ═══════════════════════════════════════════
            //  HALLOWEEN DECOR
            // ═══════════════════════════════════════════
            this.drawHalloweenDecor();

            // ═══════════════════════════════════════════
            //  COFFEE & PANTRY AREA
            // ═══════════════════════════════════════════

            // Counter
            g.fillStyle(0xa6440f, 1);
            g.fillRect(370, 380, 80, 20);
            g.fillStyle(0xc85a12, 1);
            g.fillRect(372, 382, 76, 16);

            // Coffee machine
            g.fillStyle(0x140c1a, 1);
            g.fillRect(380, 370, 20, 24);
            g.fillStyle(0x4b2d63, 1);
            g.fillRect(382, 372, 16, 12);
            g.fillStyle(0xe2530f, 1);
            g.fillCircle(390, 390, 2); // power light

            // Microwave
            g.fillStyle(0x3d2a4a, 1);
            g.fillRect(410, 372, 20, 16);
            g.fillStyle(0x140c1a, 1);
            g.fillRect(412, 374, 12, 12);
            g.fillStyle(0xf2a007, 1);
            g.fillRect(427, 376, 2, 2); // light

            // Small table with snacks
            g.fillStyle(0xa6440f, 1);
            g.fillRect(380, 440, 40, 30);
            g.fillStyle(0xc85a12, 1);
            g.fillRect(382, 442, 36, 26);
            // Fruit bowl
            g.fillStyle(0xffb627, 1);
            g.fillCircle(392, 452, 4);
            g.fillStyle(0xff7a1a, 1);
            g.fillCircle(400, 450, 3);
            g.fillStyle(0xf2a007, 1);
            g.fillCircle(408, 454, 4);

            // Chairs around snack table
            g.fillStyle(0x3f2656, 1);
            g.fillCircle(375, 445, 5);
            g.fillCircle(375, 460, 5);
            g.fillCircle(425, 445, 5);
            g.fillCircle(425, 460, 5);

            // Water cooler
            g.fillStyle(0x3ba88f, 0.6);
            g.fillRect(470, 380, 12, 24);
            g.fillStyle(0x3d2a4a, 1);
            g.fillRect(468, 404, 16, 16);
            g.fillStyle(0x3ba88f, 0.4);
            g.fillRect(470, 382, 8, 16); // water level
            this.add.text(476, 424, '💧', { fontSize: '8px' }).setOrigin(0.5);

            // ═══════════════════════════════════════════
            //  GYM (agents come here to work out when bored)
            // ═══════════════════════════════════════════

            // Soft rubber floor + walls
            g.fillStyle(0x2b1d3a, 1);
            g.fillRect(160, 440, 176, 152);
            g.lineStyle(3, 0xff7a1a, 0.9);
            g.strokeRect(160, 440, 176, 152);
            g.fillStyle(0x33203f, 1);
            g.fillRect(290, 437, 40, 6); // door gap
            this.add.text(200, 452, '🏋️ Gym', { fontSize: '10px', color: '#ff8c2e' }).setOrigin(0.5);

            // Treadmill
            g.fillStyle(0x4b2d63, 1);
            g.fillRect(176, 468, 32, 24);
            g.fillStyle(0x140c1a, 1);
            g.fillRect(179, 472, 24, 17);
            g.fillStyle(0xff7a1a, 1);
            g.fillRect(205, 464, 6, 30);
            g.fillStyle(0x3ba88f, 1);
            g.fillRect(206, 466, 4, 5); // screen

            // Weight bench + dumbbell rack
            g.fillStyle(0x6b3fa0, 1);
            g.fillRect(244, 486, 28, 8);
            g.fillStyle(0xa6440f, 1);
            g.fillRect(236, 462, 44, 6);
            const dumbbellColors = [0xff7a1a, 0xffb627, 0x6b3fa0, 0x3ba88f];
            dumbbellColors.forEach((c, i) => {
                const dx = 241 + i * 11;
                g.fillStyle(c, 1);
                g.fillCircle(dx - 3, 465, 3);
                g.fillCircle(dx + 3, 465, 3);
                g.fillStyle(0xb58be0, 1);
                g.fillRect(dx - 2, 464, 4, 2);
            });

            // Mirror
            g.fillStyle(0x243238, 1);
            g.fillRect(292, 450, 36, 10);
            g.lineStyle(1, 0x6b3fa0, 1);
            g.strokeRect(292, 450, 36, 10);

            // Yoga mats
            g.fillStyle(0x6b3fa0, 1);
            g.fillRect(176, 536, 32, 14);
            g.fillStyle(0xffb627, 1);
            g.fillRect(224, 536, 32, 14);

            // Exercise ball
            g.fillStyle(0xff7a1a, 1);
            g.fillCircle(304, 548, 10);
            g.fillStyle(0x3a2342, 1);
            g.fillCircle(301, 545, 3);

            // Kettlebells
            g.fillStyle(0xb58be0, 1);
            g.fillCircle(290, 580, 4);
            g.fillStyle(0xe2530f, 1);
            g.fillCircle(302, 580, 4);
            g.fillStyle(0xf2a007, 1);
            g.fillCircle(314, 580, 4);

            this.add.text(176, 576, '💖', { fontSize: '8px' }).setOrigin(0.5);
            this.add.text(240, 578, '✨', { fontSize: '8px' }).setOrigin(0.5);

            // ═══════════════════════════════════════════
            //  DECORATIONS
            // ═══════════════════════════════════════════

            // Potted plants
            const drawPlant = (px: number, py: number) => {
                // Pot
                g.fillStyle(0xff8c2e, 1);
                g.fillRect(px - 5, py, 10, 8);
                g.fillStyle(0xb34d12, 1);
                g.fillRect(px - 4, py + 1, 8, 6);
                // Soil
                g.fillStyle(0x4a2e1f, 1);
                g.fillRect(px - 3, py, 6, 2);
                // Leaves
                g.fillStyle(0x4fcf2a, 1);
                g.fillCircle(px, py - 4, 6);
                g.fillStyle(0x7dff4a, 1);
                g.fillCircle(px - 3, py - 6, 4);
                g.fillCircle(px + 4, py - 5, 4);
            };

            drawPlant(24, 210);   // near desks
            drawPlant(140, 210);  // between meeting room and desks
            drawPlant(250, 210);  // center
            drawPlant(530, 380);  // near coffee area
            drawPlant(24, 500);   // bottom left
            drawPlant(550, 200);  // right side

            // Bookshelf on right wall
            g.fillStyle(0xa6440f, 1);
            g.fillRect(540, 50, 40, 80);
            g.fillStyle(0xc85a12, 1);
            g.fillRect(542, 52, 36, 18); // shelf 1
            g.fillRect(542, 72, 36, 18); // shelf 2
            g.fillRect(542, 92, 36, 18); // shelf 3
            // Books
            const bookColors = [0xe2530f, 0x2b7f6b, 0xffb627, 0xf2a007, 0x6b3fa0, 0xff7a1a];
            for (let b = 0; b < 6; b++) {
                g.fillStyle(bookColors[b], 1);
                g.fillRect(544 + b * 5, 54, 4, 14);
            }
            for (let b = 0; b < 5; b++) {
                g.fillStyle(bookColors[b + 1], 1);
                g.fillRect(544 + b * 6, 74, 4, 14);
            }

            // Printer
            g.fillStyle(0x3d2a4a, 1);
            g.fillRect(540, 140, 30, 18);
            g.fillStyle(0x5a3a70, 1);
            g.fillRect(542, 142, 26, 10);
            g.fillStyle(0x140c1a, 1);
            g.fillRect(545, 155, 6, 2); // paper slot
            this.add.text(555, 164, '🖨️', { fontSize: '8px' }).setOrigin(0.5);

            // Welcome mat / rug at center
            g.fillStyle(0x6b3fa0, 0.15);
            g.fillRect(200, 240, 120, 80);
            g.lineStyle(1, 0x6b3fa0, 0.3);
            g.strokeRect(200, 240, 120, 80);

            // ═══════════════════════════════════════════
            //  SUBTLE GRID (very faint)
            // ═══════════════════════════════════════════
            g.lineStyle(1, 0x7a2e0e, 0.12);
            g.beginPath();
            for (let i = 0; i <= gridSize; i += 16) {
                g.moveTo(i, 0).lineTo(i, gridSize);
                g.moveTo(0, i).lineTo(gridSize, i);
            }
            g.strokePath();

            this.cameras.main.setBackgroundColor('#120a18');
            this.cameras.main.setZoom(2);
            this.cameras.main.centerOn(gridSize / 2, gridSize / 2);
            this.cameras.main.setBounds(0, 0, gridSize, gridSize);

            // Meeting room: lights up and shows you at the head of the table during a meeting.
            const meetingGlow = this.add.graphics().setDepth(3).setVisible(false);
            meetingGlow.fillStyle(0xff7a1a, 0.15);
            meetingGlow.fillRect(32, 32, 200, 160);
            meetingGlow.lineStyle(3, 0xe2530f, 1);
            meetingGlow.strokeRect(30, 30, 204, 164);
            const meetingSign = this.add.text(132, 180, '📣 Meeting in progress', {
                fontSize: '9px', color: '#ffffff', backgroundColor: '#e2530f', padding: { x: 4, y: 2 }
            }).setOrigin(0.5).setDepth(6).setVisible(false);
            const you = this.add.container(58, 118).setDepth(5).setVisible(false);
            if (this.textures.exists('boss')) {
                you.add(this.add.sprite(0, -8, 'boss', 14));
            }
            you.add(this.add.text(0, 10, 'You 👑', {
                fontSize: '8px', color: '#ffffff', backgroundColor: '#6b3fa0cc', padding: { x: 2, y: 1 }
            }).setOrigin(0.5, 0));

            eventBus.addEventListener('camera-fit', (event: Event) => {
                const cam = this.cameras.main;
                this.fitView = Boolean((event as CustomEvent).detail?.fit);
                if (this.fitView) {
                    cam.removeBounds();
                    cam.setZoom(Math.min(cam.width, cam.height) / this.gridSize * 0.95);
                    cam.centerOn(this.gridSize / 2, this.gridSize / 2);
                } else {
                    cam.setZoom(2);
                    if (!this.meetingView) cam.setBounds(0, 0, this.gridSize, this.gridSize);
                    cam.centerOn(this.gridSize / 2, this.gridSize / 2);
                }
            });

            let meetingShown = false;
            eventBus.addEventListener('meeting-state', (event: Event) => {
                const active = Boolean((event as CustomEvent).detail?.active);
                if (active === meetingShown) return;
                meetingShown = active;
                meetingGlow.setVisible(active);
                meetingSign.setVisible(active);
                you.setVisible(active);
                this.meetingView = active;
                if (active) this.cameras.main.removeBounds();
                else if (!this.fitView) this.cameras.main.setBounds(0, 0, this.gridSize, this.gridSize);
            });
            this.customLayoutLayer = this.add.container(0, 0);
            this.customLayoutLayer.setDepth(4);

            if (this.input.keyboard) {
                this.cursors = this.input.keyboard.createCursorKeys();
            }

            eventBus.addEventListener('cinematic-toggle', (e: Event) => {
                const detail = (e as CustomEvent).detail as { enabled: boolean };
                this.cinematicMode = Boolean(detail?.enabled);
                if (!this.cinematicMode) {
                    this.cinematicReleaseAt = 0;
                }
            });
            eventBus.addEventListener('layout-preview-update', (e: Event) => {
                const detail = (e as CustomEvent).detail as { items: Array<{ id: string; type: string; x: number; y: number; label?: string }> };
                this.layoutItems = Array.isArray(detail?.items) ? detail.items : [];
                this.renderCustomLayout(this.layoutItems);
            });
            eventBus.addEventListener('layout-edit-mode', (e: Event) => {
                const detail = (e as CustomEvent).detail as { enabled: boolean };
                this.layoutEditMode = Boolean(detail?.enabled);
                if (!this.layoutEditMode) this.layoutDragItemId = null;
            });

            this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
                if (!this.layoutEditMode || !this.layoutDragItemId || !pointer.isDown) return;
                const gx = Phaser.Math.Clamp(Math.round(pointer.worldX / 16), 2, 36);
                const gy = Phaser.Math.Clamp(Math.round(pointer.worldY / 16), 2, 36);
                this.layoutItems = this.layoutItems.map((item) =>
                    item.id === this.layoutDragItemId ? { ...item, x: gx, y: gy } : item
                );
                this.renderCustomLayout(this.layoutItems);
                eventBus.dispatchEvent(new CustomEvent('layout-item-moved', { detail: { items: this.layoutItems } }));
            });
            this.input.on('pointerup', () => {
                this.layoutDragItemId = null;
            });
            this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
                const nextZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 1, 3);
                this.cameras.main.setZoom(nextZoom);
            });

            const toMoveDirection = (event: KeyboardEvent): 'left' | 'right' | 'up' | 'down' | null => {
                const key = (event.key || '').toLowerCase();
                const code = (event.code || '').toLowerCase();
                if (key === 'arrowleft' || key === 'a' || code === 'arrowleft' || code === 'keya') return 'left';
                if (key === 'arrowright' || key === 'd' || code === 'arrowright' || code === 'keyd') return 'right';
                if (key === 'arrowup' || key === 'w' || code === 'arrowup' || code === 'keyw') return 'up';
                if (key === 'arrowdown' || key === 's' || code === 'arrowdown' || code === 'keys') return 'down';
                return null;
            };

            const keyDownHandler = (event: KeyboardEvent) => {
                const dir = toMoveDirection(event);
                if (!dir) return;
                const active = document.activeElement as HTMLElement | null;
                const isEditable = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.isContentEditable;
                if (isEditable) return;
                this.heldMoveKeys.add(dir);
                event.preventDefault();
            };
            const keyUpHandler = (event: KeyboardEvent) => {
                const dir = toMoveDirection(event);
                if (!dir) return;
                this.heldMoveKeys.delete(dir);
            };
            window.addEventListener('keydown', keyDownHandler, { capture: true });
            window.addEventListener('keyup', keyUpHandler, { capture: true });
            document.addEventListener('keydown', keyDownHandler, { capture: true });
            document.addEventListener('keyup', keyUpHandler, { capture: true });
            window.addEventListener('blur', () => this.heldMoveKeys.clear());
            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
                window.removeEventListener('keydown', keyDownHandler, true);
                window.removeEventListener('keyup', keyUpHandler, true);
                document.removeEventListener('keydown', keyDownHandler, true);
                document.removeEventListener('keyup', keyUpHandler, true);
                this.heldMoveKeys.clear();
            });

            this.connectToServer();
        } catch (e) {
            console.error("CRITICAL PHASER ERROR", e);
        }
    }

    async connectToServer() {
        try {
            console.log("Connecting to Colyseus...");
            const wsEndpoint = resolveWsEndpoint();
            this.statusText.setText(`Colyseus Sync: Connecting to ${wsEndpoint}...`).setColor('#ffffaa');
            const client = new Colyseus.Client(wsEndpoint);
            this.room = await client.joinOrCreate('office');

            console.log("Room joined successfully!", this.room.sessionId);
            this.statusText.setText('Colyseus Sync: Connected (Waiting for state...)').setColor('#aaffaa');

            // Wait for the first actual state payload from the server before reading
            this.room.onStateChange.once((state: any) => {
                activeRoom = this.room as Colyseus.Room<OfficeState>;
                console.log("First state payload arrived!", state.toJSON());
                console.log("Agents map size:", state.agents?.size);
                this.statusText.setText('Colyseus Sync: Active!').setColor('#00ff00');

                // Bind chat bus
                this.room!.onMessage('chat', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('chat-message', { detail: message }));
                });
                this.room!.onMessage('highlight-event', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('highlight-event', { detail: message }));
                    if (this.cinematicMode && message?.agentId) {
                        this.focusAgentTemporarily(message.agentId);
                    }
                });
                this.room!.onMessage('scenario-event', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('scenario-event', { detail: message }));
                });
                this.room!.onMessage('relationship-update', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('relationship-update', { detail: message }));
                });
                this.room!.onMessage('layout-sync', (message: any) => {
                    this.layoutItems = Array.isArray(message?.layout) ? message.layout : [];
                    this.renderCustomLayout(this.layoutItems);
                    eventBus.dispatchEvent(new CustomEvent('layout-sync', { detail: { items: this.layoutItems } }));
                });

                state.agents.onAdd((agent: AgentState, sessionId: string) => {
                    console.log(`[Colyseus] Agent added: ${agent.name} at (${agent.x}, ${agent.y})`);
                    const container = this.add.container(agent.x * 16, agent.y * 16);

                    let sprite;
                    const costumeSprite = `costume_${agent.costume}`;
                    const charKey = SPRITE_KEYS.includes(costumeSprite) ? costumeSprite : 'char_0';

                    if (this.textures.exists(charKey)) {
                        sprite = this.add.sprite(0, -8, charKey, 0);
                    } else {
                        sprite = this.add.rectangle(0, -8, 16, 32, 0x6b3fa0);
                    }

                    // Thought bubble (word-wrapped)
                    const thoughtBubble = this.add.text(0, -36, '', {
                        fontSize: '9px',
                        color: '#ffffff',
                        backgroundColor: '#4b2d63ee',
                        padding: { x: 5, y: 4 },
                        align: 'center',
                        wordWrap: { width: 130, useAdvancedWrap: true }
                    }).setOrigin(0.5, 1);
                    thoughtBubble.setVisible(false);

                    // Emote bubble (emoji above head)
                    const emoteBubble = this.add.text(8, -24, '', {
                        fontSize: '12px'
                    }).setOrigin(0.5);
                    emoteBubble.setVisible(false);

                    // Name label
                    const label = this.add.text(0, 16, agent.name, {
                        fontSize: '10px', color: '#ffffff',
                        backgroundColor: '#6b3fa0cc', padding: { x: 2, y: 1 }
                    }).setOrigin(0.5, 0);

                    // Focus highlight ring (hidden by default)
                    const focusRing = this.add.graphics();
                    focusRing.lineStyle(1, 0x6b3fa0, 0.8);
                    focusRing.strokeCircle(0, 0, 14);
                    focusRing.setVisible(false);

                    container.add([focusRing, sprite, thoughtBubble, emoteBubble, label]);
                    container.setSize(32, 48);
                    container.setInteractive();
                    this.agentSprites.set(sessionId, container);

                    // --- FOCUS MODE: Click to follow ---
                    container.on('pointerdown', () => {
                        if (this.followTarget === container) {
                            // Unfollow on second click
                            this.followTarget = null;
                            focusRing.setVisible(false);
                            eventBus.dispatchEvent(new CustomEvent('agent-focus', { detail: null }));
                        } else {
                            // Unfollow previous
                            if (this.followTarget) {
                                const prevRing = this.followTarget.getAt(0) as Phaser.GameObjects.Graphics;
                                prevRing?.setVisible(false);
                            }
                            this.followTarget = container;
                            focusRing.setVisible(true);
                            eventBus.dispatchEvent(new CustomEvent('agent-focus', { detail: { name: agent.name, id: sessionId } }));
                        }
                    });

                    let prevX = agent.x;
                    let prevY = agent.y;
                    let lastAction = '';

                    agent.onChange(() => {
                        this.tweens.add({
                            targets: container,
                            x: agent.x * 16,
                            y: agent.y * 16,
                            duration: 100,
                            onComplete: () => {
                                if (sprite.type === 'Sprite') {
                                    (sprite as Phaser.GameObjects.Sprite).stop();
                                }
                            }
                        });

                        // Walk animation
                        if (sprite.type === 'Sprite') {
                            const s = sprite as Phaser.GameObjects.Sprite;
                            if (agent.x > prevX) { s.play(`${charKey}-walk-right`, true); s.setFlipX(false); }
                            else if (agent.x < prevX) { s.play(`${charKey}-walk-right`, true); s.setFlipX(true); }
                            else if (agent.y > prevY) { s.play(`${charKey}-walk-down`, true); }
                            else if (agent.y < prevY) { s.play(`${charKey}-walk-up`, true); }
                            else { s.stop(); }
                        }

                        // --- EMOTE BUBBLES based on action ---
                        const emoteMap: Record<string, string> = {
                            'work': '💻', 'talk': '💬', 'idle': '😌', 'workout': '🏋️', 'break': '☕', 'meeting': '📣',
                            'use_tool': '🔧', 'move': '🚶', 'think': '💡'
                        };
                        const emote = emoteMap[agent.action] || '';
                        if (emote && agent.action !== lastAction) {
                            emoteBubble.setText(emote);
                            emoteBubble.setVisible(true);
                            // Auto-hide after 3s
                            this.time.delayedCall(3000, () => emoteBubble.setVisible(false));
                        }

                        // Thought bubble
                        if (agent.thought && agent.thought !== '') {
                            thoughtBubble.setText(agent.thought);
                            thoughtBubble.setVisible(true);
                            this.time.delayedCall(6000, () => thoughtBubble.setVisible(false));
                        }

                        // --- SYSTEM LOG EVENT ---
                        if (agent.action !== lastAction || agent.thought !== '') {
                            eventBus.dispatchEvent(new CustomEvent('activity-log', {
                                detail: {
                                    agent: agent.name,
                                    action: agent.action,
                                    thought: agent.thought,
                                    time: new Date().toLocaleTimeString()
                                }
                            }));
                        }
                        eventBus.dispatchEvent(new CustomEvent('agent-telemetry', {
                            detail: {
                                id: sessionId,
                                name: agent.name,
                                mood: Number(agent.mood || 0),
                                reputation: Number(agent.reputation || 0),
                                riskLevel: Number(agent.riskLevel || 0),
                                momentum: Number(agent.momentum || 0),
                                action: agent.action
                            }
                        }));

                        lastAction = agent.action;
                        prevX = agent.x;
                        prevY = agent.y;
                    });
                });

                state.agents.onRemove((agent: AgentState, sessionId: string) => {
                    const sprite = this.agentSprites.get(sessionId);
                    if (sprite) {
                        sprite.destroy();
                        this.agentSprites.delete(sessionId);
                    }
                });
            });

        } catch (e) {
            console.error(e);
            const wsEndpoint = resolveWsEndpoint();
            this.statusText.setText(`Colyseus Sync: Failed (${wsEndpoint})`).setColor('#ffaaaa');
        }
    }

    update() {
        if (this.cinematicReleaseAt > 0 && Date.now() > this.cinematicReleaseAt) {
            this.cinematicReleaseAt = 0;
            this.followTarget = null;
        }
        const speed = 5;
        const manualPan =
            this.heldMoveKeys.size > 0 ||
            Boolean(this.cursors?.left.isDown) ||
            Boolean(this.cursors?.right.isDown) ||
            Boolean(this.cursors?.up.isDown) ||
            Boolean(this.cursors?.down.isDown);
        if (manualPan) {
            // User input should always win over cinematic follow.
            this.followTarget = null;
            this.cinematicReleaseAt = 0;
            if (this.cursors?.left.isDown || this.heldMoveKeys.has('left')) this.cameras.main.scrollX -= speed;
            if (this.cursors?.right.isDown || this.heldMoveKeys.has('right')) this.cameras.main.scrollX += speed;
            if (this.cursors?.up.isDown || this.heldMoveKeys.has('up')) this.cameras.main.scrollY -= speed;
            if (this.cursors?.down.isDown || this.heldMoveKeys.has('down')) this.cameras.main.scrollY += speed;
        }
        if (this.fitView) return;
        // During a meeting, hold the meeting room in the middle of the screen, clear of the side panels.
        if (this.meetingView && !manualPan) {
            const cam = this.cameras.main;
            // Phaser zooms around the view's center, so centering on a point means scroll = point - half the view.
            const targetX = 132 - cam.width / 2;
            const targetY = 112 - cam.height / 2;
            cam.scrollX += (targetX - cam.scrollX) * 0.08;
            cam.scrollY += (targetY - cam.scrollY) * 0.08;
            return;
        }
        // If following an agent, smoothly track them
        if (this.followTarget && !manualPan) {
            const cam = this.cameras.main;
            const targetX = this.followTarget.x - cam.width / (2 * cam.zoom);
            const targetY = this.followTarget.y - cam.height / (2 * cam.zoom);
            cam.scrollX += (targetX - cam.scrollX) * 0.08;
            cam.scrollY += (targetY - cam.scrollY) * 0.08;
        }
        const cam = this.cameras.main;
        const maxScrollX = Math.max(0, this.gridSize - cam.width / cam.zoom);
        const maxScrollY = Math.max(0, this.gridSize - cam.height / cam.zoom);
        cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, maxScrollX);
        cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, maxScrollY);
    }

    private focusAgentTemporarily(agentId: string) {
        const target = this.agentSprites.get(agentId);
        if (!target) return;
        this.followTarget = target;
        this.cinematicReleaseAt = Date.now() + 7000;
    }

    private renderCustomLayout(items: Array<{ type: string; x: number; y: number; label?: string }>) {
        if (!this.customLayoutLayer) return;
        this.customLayoutLayer.removeAll(true);
        for (let index = 0; index < items.length; index++) {
            const source = items[index] as { id?: string; type: string; x: number; y: number; label?: string };
            const item = {
                ...source,
                id: source.id || `layout_${index}`
            };
            const x = Math.round(item.x) * 16;
            const y = Math.round(item.y) * 16;
            const group = this.add.container(x, y);
            const g = this.add.graphics();
            switch (item.type) {
                case 'plant':
                    g.fillStyle(0xff8c2e, 1);
                    g.fillRect(-5, 0, 10, 8);
                    g.fillStyle(0x4fcf2a, 1);
                    g.fillCircle(0, -5, 6);
                    g.fillStyle(0x7dff4a, 1);
                    g.fillCircle(-3, -7, 4);
                    g.fillCircle(4, -6, 4);
                    break;
                case 'desk':
                    g.fillStyle(0xc85a12, 1);
                    g.fillRect(-12, -8, 24, 16);
                    g.fillStyle(0x140c1a, 1);
                    g.fillRect(-8, -6, 10, 6);
                    break;
                case 'bookshelf':
                    g.fillStyle(0xc85a12, 1);
                    g.fillRect(-8, -12, 16, 24);
                    g.fillStyle(0xffb627, 1);
                    g.fillRect(-6, -8, 3, 6);
                    g.fillStyle(0x2b7f6b, 1);
                    g.fillRect(-2, -8, 3, 6);
                    g.fillStyle(0xff7a1a, 1);
                    g.fillRect(2, -8, 3, 6);
                    break;
                case 'coffee_machine':
                    g.fillStyle(0x140c1a, 1);
                    g.fillRect(-6, -8, 12, 16);
                    g.fillStyle(0xe2530f, 1);
                    g.fillCircle(0, 4, 2);
                    break;
                case 'table':
                    g.fillStyle(0xc85a12, 1);
                    g.fillRect(-10, -6, 20, 12);
                    break;
                case 'chair':
                    g.fillStyle(0x3f2656, 1);
                    g.fillCircle(0, 0, 6);
                    break;
                case 'whiteboard':
                    g.fillStyle(0x3d2a4a, 1);
                    g.fillRect(-10, -6, 20, 12);
                    g.lineStyle(1, 0x4b2d63, 1);
                    g.strokeRect(-10, -6, 20, 12);
                    break;
                default:
                    g.fillStyle(0x5a3a70, 1);
                    g.fillRect(-6, -6, 12, 12);
            }
            group.add(g);
            if (item.label) {
                const label = this.add.text(0, 10, item.label.slice(0, 8), { fontSize: '8px', color: '#b58be0' }).setOrigin(0.5, 0);
                group.add(label);
            }
            group.setSize(22, 22);
            group.setInteractive(new Phaser.Geom.Rectangle(-11, -11, 22, 22), Phaser.Geom.Rectangle.Contains);
            group.on('pointerdown', () => {
                if (!this.layoutEditMode) return;
                this.layoutDragItemId = item.id;
            });
            this.customLayoutLayer.add(group);
        }
    }
}

export function setupPhaser(parentId: string) {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: parentId,
        width: window.innerWidth,
        height: window.innerHeight,
        scene: [OfficeScene],
        pixelArt: true,
        scale: {
            mode: Phaser.Scale.RESIZE,
        },
        input: {
            keyboard: {
                capture: [] // Don't capture ANY keys globally — let React inputs work
            }
        }
    };

    const game = new Phaser.Game(config);

    // When ANY input/textarea/select is focused, fully disable Phaser keyboard
    // When they blur, re-enable it
    document.addEventListener('focusin', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            game.input.keyboard?.enabled && (game.input.keyboard.enabled = false);
        }
    });
    document.addEventListener('focusout', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            game.input.keyboard && (game.input.keyboard.enabled = true);
        }
    });

    return game;
}
