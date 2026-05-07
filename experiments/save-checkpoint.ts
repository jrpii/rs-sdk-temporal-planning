#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

function usage(exitCode = 1): never {
    console.log(`
Save the current live bot state as a binary .sav checkpoint.

Usage:
  bun experiments/save-checkpoint.ts <botname> --out runs/checkpoints/name.sav [--api http://localhost:8888]

Examples:
  bun experiments/save-checkpoint.ts McPlan --out runs/checkpoints/McPlan-cook-shrimp-alkharid.sav
  bun experiments/save-checkpoint.ts McPlan --api http://localhost:8888 --out runs/checkpoints/McPlan-current.sav

Notes:
  This calls the same /api/experiment/save endpoint as the browser Save checkpoint button.
  The bot should be online if you want the current live state, otherwise the engine falls back
  to the saved .sav on disk for the active NODE_PROFILE.
`.trim());
    process.exit(exitCode);
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);

    const botName = args.find(arg => !arg.startsWith('-'));
    if (!botName) usage();

    let api = 'http://localhost:8888';
    let outPath = join('runs', 'checkpoints', `${botName}-${timestamp()}.sav`);

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--api') {
            api = (args[++i] ?? api).replace(/\/$/, '');
        } else if (arg === '--out') {
            outPath = args[++i] ?? outPath;
        }
    }

    return { botName, api, outPath };
}

async function main() {
    const { botName, api, outPath } = parseArgs();
    const response = await fetch(`${api}/api/experiment/save?username=${encodeURIComponent(botName)}`);

    if (!response.ok) {
        let message = `Request failed: ${response.status}`;
        try {
            const result = await response.json();
            message = result.error || message;
        } catch {
            // Endpoint may return a non-JSON failure.
        }
        throw new Error(message);
    }

    const save = Buffer.from(await response.arrayBuffer());
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, save);
    console.log(`Live checkpoint saved: ${outPath}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
