#!/usr/bin/env bun
import { connectExperimentBot } from './connect';
import { diffStateSummaries, summarizeState } from './state-summary';

function usage(code = 1): never {
    console.error('Usage: bun experiments/tick.ts <botname> [--server localhost] [--ticks 1] [--full]');
    process.exit(code);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) usage(0);
const botName = args.find(arg => !arg.startsWith('-'));
if (!botName) usage();

let server: string | undefined;
let ticks = 1;
let full = false;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--server') server = args[++i];
    if (arg === '--ticks') ticks = Number(args[++i] ?? '1');
    if (arg === '--full') full = true;
}

const connection = await connectExperimentBot(botName, server);
try {
    await connection.sdk.waitForReady(15000);
    const beforeState = connection.sdk.getState();
    if (!beforeState) throw new Error('No state available before waiting');
    const before = summarizeState(beforeState);
    const afterState = await connection.sdk.waitForTicks(ticks);
    const after = summarizeState(afterState);
    const delta = diffStateSummaries(before, after);

    console.log(JSON.stringify({
        capturedAt: new Date().toISOString(),
        botName: connection.botName,
        ticksRequested: ticks,
        before: full ? before : { tick: before.tick, position: before.position, inventory: before.inventory, ui: before.ui },
        after: full ? after : { tick: after.tick, position: after.position, inventory: after.inventory, ui: after.ui },
        delta,
    }, null, 2));
} finally {
    connection.disconnect();
}
