// OverlayUI.ts - DOM management for bot overlay and packet log panel
// Handles all UI creation, styling, and user interaction

import type { Client } from '#/client/Client.js';
import type { PacketLogEntry } from './types.js';

export interface OverlayUICallbacks {
    onPacketLogToggle(): void;
}

export class OverlayUI {
    private container: HTMLDivElement;
    private content: HTMLPreElement;
    private actionLog: HTMLPreElement;
    private terminalOutput: HTMLPreElement;
    private terminalInput: HTMLInputElement;
    private packetLogContainer: HTMLDivElement;
    private packetLogContent!: HTMLPreElement;

    private visible: boolean = true;
    private minimized: boolean = false;
    private packetLogVisible: boolean = false;
    private packetLogEnabled: boolean = false;

    private actionLogEntries: string[] = [];
    private static readonly MAX_LOG_ENTRIES = 50;

    private client: Client;
    private callbacks: OverlayUICallbacks;
    private panelsContainer: HTMLDivElement | null = null;

    private injectScrollbarStyles(): void {
        // Check if styles already injected
        if (document.getElementById('bot-sdk-scrollbar-styles')) return;

        const style = document.createElement('style');
        style.id = 'bot-sdk-scrollbar-styles';
        style.textContent = `
            .dark-scrollbar {
                scrollbar-width: none;
            }
            .dark-scrollbar::-webkit-scrollbar {
                display: none;
            }
        `;
        document.head.appendChild(style);
    }

    constructor(client: Client, callbacks: OverlayUICallbacks) {
        this.client = client;
        this.callbacks = callbacks;

        // Inject dark mode scrollbar styles
        this.injectScrollbarStyles();

        // Create main overlay container with side-by-side layout
        this.container = document.createElement('div');
        this.container.id = 'bot-sdk-overlay';
        this.container.style.cssText = `
            width: min(96vw, 1400px);
            max-width: 1400px;
            min-width: 700px;
            min-height: 520px;
            display: flex;
            flex-direction: column;
            background: rgba(0, 0, 0, 0.85);
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 11px;
            color: #04A800;
            resize: both;
            overflow: auto;
            margin-top: 10px;
        `;

        // Create panels container for side-by-side layout
        const panelsContainer = document.createElement('div');
        panelsContainer.style.cssText = `
            display: flex;
            flex-direction: row;
            flex: 1;
            height: 700px;
            max-height: 75vh;
            min-height: 0;
        `;

        // Create BOT SDK panel (left side)
        const sdkPanel = document.createElement('div');
        sdkPanel.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0;
            border-right: 1px solid rgba(4, 168, 0, 0.3);
        `;

        const sdkHeader = document.createElement('div');
        sdkHeader.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 10px;
            background: rgba(4, 168, 0, 0.15);
            font-weight: bold;
            font-size: 10px;
        `;
        sdkHeader.innerHTML = `
            <span>WORLD STATE</span>
            <span>
                <button id="world-copy" style="background: none; border: 1px solid #04A800; color: #04A800; cursor: pointer; padding: 2px 8px; margin-left: 4px; font-size: 10px;">Copy</button>
                <button id="world-save-text" style="background: none; border: 1px solid #04A800; color: #04A800; cursor: pointer; padding: 2px 8px; margin-left: 4px; font-size: 10px;">Save Text</button>
                <button id="world-save-json" style="background: none; border: 1px solid #04A800; color: #04A800; cursor: pointer; padding: 2px 8px; margin-left: 4px; font-size: 10px;">Save JSON</button>
            </span>
        `;

        // Create content area (world state)
        this.content = document.createElement('pre');
        this.content.id = 'bot-sdk-content';
        this.content.className = 'dark-scrollbar';
        this.content.style.cssText = `
            margin: 0;
            padding: 10px;
            overflow-y: auto;
            overflow-x: hidden;
            max-height: none;
            white-space: pre-wrap;
            word-break: break-word;
            tab-size: 4;
            flex: 1;
        `;

        sdkPanel.appendChild(sdkHeader);
        sdkPanel.appendChild(this.content);

        // Create SDK ACTIONS panel (right side)
        const actionsPanel = document.createElement('div');
        actionsPanel.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0;
        `;

        const actionHeader = document.createElement('div');
        actionHeader.style.cssText = `
            padding: 4px 10px;
            background: rgba(255, 215, 0, 0.15);
            font-weight: bold;
            font-size: 10px;
            color: #FFD700;
            position: relative;
        `;
        actionHeader.innerHTML = `
            SDK ACTIONS
            <button id="bot-packets" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: 1px solid #04A800; color: #04A800; cursor: pointer; padding: 2px 8px; font-size: 10px;">PKT</button>
        `;

        this.actionLog = document.createElement('pre');
        this.actionLog.id = 'bot-sdk-actions';
        this.actionLog.className = 'dark-scrollbar';
        this.actionLog.style.cssText = `
            margin: 0;
            padding: 10px;
            overflow-y: auto;
            overflow-x: hidden;
            max-height: none;
            white-space: pre-wrap;
            word-break: break-word;
            color: #FFD700;
            font-size: 10px;
            flex: 1;
            text-align: left;
        `;
        this.actionLog.textContent = 'Download the SDK to get started:\ngithub.com/MaxBittker/rs-sdk\n\n(waiting for SDK actions...)';

        const terminalPanel = document.createElement('div');
        terminalPanel.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
            border-top: 1px solid rgba(4, 168, 0, 0.3);
        `;

        const terminalHeader = document.createElement('div');
        terminalHeader.style.cssText = `
            padding: 4px 10px;
            background: rgba(4, 168, 0, 0.12);
            font-weight: bold;
            font-size: 10px;
            color: #04A800;
        `;
        terminalHeader.textContent = 'BROWSER TERMINAL';

        this.terminalOutput = document.createElement('pre');
        this.terminalOutput.id = 'bot-terminal-output';
        this.terminalOutput.className = 'dark-scrollbar';
        this.terminalOutput.style.cssText = `
            margin: 0;
            padding: 10px;
            overflow-y: auto;
            overflow-x: auto;
            white-space: pre-wrap;
            word-break: break-word;
            color: #04A800;
            font-size: 10px;
            flex: 1;
            text-align: left;
        `;
        this.terminalOutput.textContent = [
            'Browser terminal ready. Type "help".',
            'Examples: state | npcs | walk 3221 3222 | rel 1 0 | dialog 1',
            'JS: client.getBotState() | await helpers.pause()'
        ].join('\n');

        this.terminalInput = document.createElement('input');
        this.terminalInput.id = 'bot-terminal-input';
        this.terminalInput.placeholder = 'enter command...';
        this.terminalInput.style.cssText = `
            box-sizing: border-box;
            width: 100%;
            padding: 7px 10px;
            background: #050505;
            color: #04A800;
            border: 0;
            border-top: 1px solid rgba(4, 168, 0, 0.35);
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 11px;
            outline: none;
        `;

        terminalPanel.appendChild(terminalHeader);
        terminalPanel.appendChild(this.terminalOutput);
        terminalPanel.appendChild(this.terminalInput);

        actionsPanel.appendChild(actionHeader);
        actionsPanel.appendChild(this.actionLog);
        actionsPanel.appendChild(terminalPanel);

        // Assemble panels
        panelsContainer.appendChild(sdkPanel);
        panelsContainer.appendChild(actionsPanel);

        this.container.appendChild(panelsContainer);
        this.panelsContainer = panelsContainer;

        // Mount to sdk-panel-container if it exists, otherwise fall back to body
        const sdkContainer = document.getElementById('sdk-panel-container');
        if (sdkContainer) {
            sdkContainer.appendChild(this.container);
        } else {
            document.body.appendChild(this.container);
        }

        // Create packet log panel
        this.packetLogContainer = this.createPacketLogPanel();
        document.body.appendChild(this.packetLogContainer);

        // Setup event handlers
        this.setupEventHandlers();
    }

    private createPacketLogPanel(): HTMLDivElement {
        const panel = document.createElement('div');
        panel.id = 'bot-packet-log';
        panel.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            width: 450px;
            max-height: 500px;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid #FF6600;
            border-radius: 8px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 10px;
            color: #FF6600;
            z-index: 10001;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            display: none;
        `;

        // Packet log header
        const packetHeader = document.createElement('div');
        packetHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 10px;
            background: rgba(255, 102, 0, 0.2);
            border-bottom: 1px solid #FF6600;
            cursor: move;
        `;
        packetHeader.innerHTML = `
            <span style="font-weight: bold;">PACKET LOG</span>
            <div>
                <button id="pkt-toggle" style="background: #333; border: 1px solid #FF6600; color: #FF6600; cursor: pointer; padding: 2px 8px; margin-right: 4px; font-size: 10px;">OFF</button>
                <button id="pkt-clear" style="background: none; border: 1px solid #FF6600; color: #FF6600; cursor: pointer; padding: 2px 8px; margin-right: 4px; font-size: 10px;">Clear</button>
                <button id="pkt-copy" style="background: none; border: 1px solid #FF6600; color: #FF6600; cursor: pointer; padding: 2px 8px; margin-right: 4px; font-size: 10px;">Copy</button>
                <button id="pkt-close" style="background: none; border: 1px solid #FF6600; color: #FF6600; cursor: pointer; padding: 2px 8px;">X</button>
            </div>
        `;

        // Packet log content
        this.packetLogContent = document.createElement('pre');
        this.packetLogContent.id = 'bot-packet-content';
        this.packetLogContent.style.cssText = `
            margin: 0;
            padding: 10px;
            overflow-y: auto;
            max-height: 430px;
            white-space: pre;
            word-wrap: normal;
            overflow-x: auto;
        `;
        this.packetLogContent.textContent = 'Packet logging disabled. Click "OFF" button to enable.\n\nUsage:\n1. Click "OFF" to toggle logging ON\n2. Perform actions in-game\n3. Click "Copy" to copy log to clipboard\n4. Click "Clear" to clear the log';

        panel.appendChild(packetHeader);
        panel.appendChild(this.packetLogContent);

        // Make draggable
        this.makeDraggable(packetHeader, panel);

        return panel;
    }

    private setupEventHandlers(): void {
        const worldCopy = document.getElementById('world-copy');
        const worldSaveText = document.getElementById('world-save-text');
        const worldSaveJson = document.getElementById('world-save-json');
        const packetsBtn = document.getElementById('bot-packets');
        const pktToggle = document.getElementById('pkt-toggle');
        const pktClear = document.getElementById('pkt-clear');
        const pktCopy = document.getElementById('pkt-copy');
        const pktClose = document.getElementById('pkt-close');

        worldCopy?.addEventListener('click', () => this.copyWorldState());
        worldSaveText?.addEventListener('click', () => this.saveWorldStateText());
        worldSaveJson?.addEventListener('click', () => this.saveWorldStateJson());
        packetsBtn?.addEventListener('click', () => this.togglePacketLog());
        pktToggle?.addEventListener('click', () => this.togglePacketLogging());
        pktClear?.addEventListener('click', () => this.clearPacketLog());
        pktCopy?.addEventListener('click', () => this.copyPacketLog());
        pktClose?.addEventListener('click', () => this.togglePacketLog());

        this.terminalInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            const command = this.terminalInput.value.trim();
            if (!command) return;
            this.terminalInput.value = '';
            void this.runTerminalCommand(command);
        });
    }

    private makeDraggable(handle: HTMLElement, container: HTMLElement): void {
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            if (container.style.left) {
                startLeft = parseInt(container.style.left) || 10;
            } else {
                startLeft = window.innerWidth - container.offsetWidth - (parseInt(container.style.right) || 10);
            }
            startTop = parseInt(container.style.top) || 10;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            container.style.left = `${startLeft + dx}px`;
            container.style.right = 'auto';
            container.style.top = `${startTop + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // Packet log methods
    togglePacketLog(): void {
        this.packetLogVisible = !this.packetLogVisible;
        this.packetLogContainer.style.display = this.packetLogVisible ? 'block' : 'none';

        // Auto-enable logging when opening, auto-disable when closing
        if (this.packetLogVisible && !this.packetLogEnabled) {
            this.setPacketLogging(true);
        } else if (!this.packetLogVisible && this.packetLogEnabled) {
            this.setPacketLogging(false);
        }
    }

    togglePacketLogging(): void {
        this.setPacketLogging(!this.packetLogEnabled);
    }

    private setPacketLogging(enabled: boolean): void {
        this.packetLogEnabled = enabled;
        this.client.setPacketLogging(enabled);

        const toggleBtn = document.getElementById('pkt-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = enabled ? 'ON' : 'OFF';
            toggleBtn.style.background = enabled ? '#FF6600' : '#333';
            toggleBtn.style.color = enabled ? '#000' : '#FF6600';
        }

        if (enabled) {
            this.client.setPacketLogCallback((entry) => this.addPacketLogEntry(entry));
            this.packetLogContent.textContent = '--- Packet logging started ---\n';
        } else {
            this.client.setPacketLogCallback(null);
            this.packetLogContent.textContent += '\n--- Packet logging stopped ---\n';
        }
    }

    addPacketLogEntry(entry: PacketLogEntry): void {
        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
        const line = `[${time}] ${entry.name.padEnd(20)} | size: ${entry.size.toString().padStart(3)} | ${entry.data}\n`;
        this.packetLogContent.textContent += line;

        // Auto-scroll to bottom
        this.packetLogContent.scrollTop = this.packetLogContent.scrollHeight;
    }

    clearPacketLog(): void {
        this.client.clearPacketLog();
        this.packetLogContent.textContent = this.packetLogEnabled
            ? '--- Log cleared ---\n'
            : 'Packet logging disabled. Click "OFF" button to enable.\n';
    }

    copyPacketLog(): void {
        const text = this.packetLogContent.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
            const copyBtn = document.getElementById('pkt-copy');
            if (copyBtn) {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                copyBtn.style.background = '#FF6600';
                copyBtn.style.color = '#000';
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.style.background = 'none';
                    copyBtn.style.color = '#FF6600';
                }, 1000);
            }
        }).catch(err => {
            console.error('Failed to copy packet log:', err);
        });
    }

    isPacketLoggingEnabled(): boolean {
        return this.packetLogEnabled;
    }

    private flashButton(id: string, text: string, color: string = '#04A800'): void {
        const button = document.getElementById(id);
        if (!button) return;

        const originalText = button.textContent;
        const originalBackground = button.style.background;
        const originalColor = button.style.color;
        button.textContent = text;
        button.style.background = color;
        button.style.color = '#000';
        setTimeout(() => {
            button.textContent = originalText;
            button.style.background = originalBackground;
            button.style.color = originalColor;
        }, 1000);
    }

    private downloadText(filename: string, text: string, type: string): void {
        const blob = new Blob([text], { type });
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(href);
    }

    private getBotUsername(): string {
        const credentials = typeof (this.client as any).getCredentials === 'function'
            ? (this.client as any).getCredentials()
            : null;
        const username = credentials?.username || 'bot';
        return String(username).replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    private copyWorldState(): void {
        navigator.clipboard.writeText(this.content.textContent || '').then(() => {
            this.flashButton('world-copy', 'Copied!');
        }).catch(err => {
            console.error('Failed to copy world state:', err);
        });
    }

    private saveWorldStateText(): void {
        this.downloadText(`${this.getBotUsername()}-world-state-${Date.now()}.txt`, this.content.textContent || '', 'text/plain');
        this.flashButton('world-save-text', 'Saved!');
    }

    private saveWorldStateJson(): void {
        const state = typeof (this.client as any).getBotState === 'function'
            ? (this.client as any).getBotState()
            : null;
        const payload = {
            capturedAt: new Date().toISOString(),
            url: window.location.href,
            state
        };
        this.downloadText(`${this.getBotUsername()}-world-state-${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
        this.flashButton('world-save-json', 'Saved!');
    }

    private appendTerminal(text: string): void {
        this.terminalOutput.textContent += `\n${text}`;
        this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
    }

    private async runTerminalCommand(command: string): Promise<void> {
        this.appendTerminal(`> ${command}`);

        try {
            const result = await this.executeTerminalCommand(command);
            if (result !== undefined) {
                this.appendTerminal(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.appendTerminal(`ERROR: ${message}`);
        }
    }

    private async executeTerminalCommand(command: string): Promise<unknown> {
        const parts = command.split(/\s+/);
        const op = parts[0]?.toLowerCase();
        const c = this.client as any;

        if (op === 'help') {
            return [
                'Commands:',
                '  help',
                '  clear',
                '  state',
                '  npcs',
                '  walk <x> <z>',
                '  rel <dx> <dz>',
                '  talk <npc name>',
                '  dialog <optionIndex>',
                '  pause | resume | step',
                '  save',
                '  load',
                '  js <expression or statements>',
                '',
                'JS context: client, helpers. Examples:',
                '  js client.getBotState()',
                '  js await helpers.step()',
                '  js client.walkTo(3221, 3222)'
            ].join('\n');
        }

        if (op === 'clear') {
            this.terminalOutput.textContent = 'Browser terminal ready.';
            return undefined;
        }

        if (op === 'state') {
            return typeof c.getBotState === 'function' ? c.getBotState() : null;
        }

        if (op === 'npcs') {
            return typeof c.getNearbyNpcs === 'function' ? c.getNearbyNpcs() : [];
        }

        if (op === 'walk') {
            const x = Number(parts[1]);
            const z = Number(parts[2]);
            if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Usage: walk <x> <z>');
            return c.walkTo(x, z);
        }

        if (op === 'rel') {
            const dx = Number(parts[1]);
            const dz = Number(parts[2]);
            if (!Number.isFinite(dx) || !Number.isFinite(dz)) throw new Error('Usage: rel <dx> <dz>');
            return c.walkRelative(dx, dz);
        }

        if (op === 'talk') {
            const name = command.slice('talk'.length).trim();
            if (!name) throw new Error('Usage: talk <npc name>');
            const npcIndex = c.findNpcByName(name);
            if (npcIndex < 0) throw new Error(`NPC not found: ${name}`);
            return c.talkToNpc(npcIndex);
        }

        if (op === 'dialog') {
            const option = Number(parts[1] ?? 0);
            if (!Number.isFinite(option)) throw new Error('Usage: dialog <optionIndex>');
            return c.clickDialogOption(option);
        }

        const helpers = {
            state: () => typeof c.getBotState === 'function' ? c.getBotState() : null,
            npcs: () => typeof c.getNearbyNpcs === 'function' ? c.getNearbyNpcs() : [],
            pause: async () => (await fetch('/api/experiment/pause', { method: 'POST' })).json(),
            resume: async () => (await fetch('/api/experiment/resume', { method: 'POST' })).json(),
            step: async (ticks = 1) => (await fetch('/api/experiment/step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticks })
            })).json(),
            save: () => {
                const download = (window as any).downloadSaveCheckpoint;
                if (typeof download !== 'function') throw new Error('Save checkpoint control is unavailable');
                download();
                return 'Save checkpoint download started.';
            },
            load: () => {
                const select = (window as any).selectSaveCheckpoint;
                if (typeof select !== 'function') throw new Error('Load checkpoint control is unavailable');
                select();
                return 'Choose a .sav checkpoint file to load.';
            }
        };

        if (op === 'pause') return helpers.pause();
        if (op === 'resume') return helpers.resume();
        if (op === 'step') return helpers.step(Number(parts[1] ?? 1));
        if (op === 'save') return helpers.save();
        if (op === 'load') return helpers.load();

        const js = op === 'js' ? command.slice(2).trim() : command;
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        try {
            return await new AsyncFunction('client', 'helpers', `"use strict"; return (${js});`)(c, helpers);
        } catch (expressionError) {
            try {
                return await new AsyncFunction('client', 'helpers', `"use strict"; ${js}`)(c, helpers);
            } catch {
                throw expressionError;
            }
        }
    }

    // Main overlay methods
    toggleMinimize(): void {
        this.minimized = !this.minimized;
        const display = this.minimized ? 'none' : 'flex';
        // Hide/show the panels container (which holds both side-by-side panels)
        if (this.panelsContainer) {
            this.panelsContainer.style.display = display;
        }
        this.container.style.maxHeight = this.minimized ? 'auto' : '600px';
    }

    toggle(): void {
        this.visible = !this.visible;
        this.container.style.display = this.visible ? 'block' : 'none';
    }

    show(): void {
        this.visible = true;
        this.container.style.display = 'block';
    }

    hide(): void {
        this.visible = false;
        this.container.style.display = 'none';
    }

    isVisible(): boolean {
        return this.visible;
    }

    isMinimized(): boolean {
        return this.minimized;
    }

    updateContent(text: string): void {
        this.content.textContent = text;
    }

    logAction(type: string, detail: string): void {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const entry = `[${time}] ${type}: ${detail}`;
        this.actionLogEntries.unshift(entry);
        if (this.actionLogEntries.length > OverlayUI.MAX_LOG_ENTRIES) {
            this.actionLogEntries.pop();
        }
        this.actionLog.textContent = this.actionLogEntries.join('\n');
    }

    destroy(): void {
        this.container.remove();
        this.packetLogContainer.remove();
    }
}
