#!/usr/bin/env bun
import { writeFileSync } from 'fs';
import { connectExperimentBot } from './connect';
import { summarizeState } from './state-summary';

function usage(code = 1): never {
    console.error('Usage: bun experiments/snapshot.ts <botname> [--server localhost] [--full] [--out file.json]');
    process.exit(code);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) usage(0);
const botName = args.find(arg => !arg.startsWith('-'));
if (!botName) usage();

let server: string | undefined;
let full = false;
let out: string | undefined;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--server') server = args[++i];
    if (arg === '--full') full = true;
    if (arg === '--out') out = args[++i];
}

const connection = await connectExperimentBot(botName, server);
try {
    await connection.sdk.waitForReady(15000);
    const state = connection.sdk.getState();
    if (!state) throw new Error('No state available');

    const payload = {
        capturedAt: new Date().toISOString(),
        botName: connection.botName,
        summary: summarizeState(state),
        fullState: full ? state : undefined,
    };
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    if (out) {
        writeFileSync(out, json, 'utf8');
        console.log(`Wrote snapshot to ${out}`);
    } else {
        console.log(json);
    }
} finally {
    connection.disconnect();
}
