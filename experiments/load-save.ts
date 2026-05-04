#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { basename, dirname, join } from 'path';

function usage(exitCode = 1): never {
    console.log(`
Load a binary .sav checkpoint for a bot.

Usage:
  bun experiments/load-save.ts <botname> <checkpoint.sav> [--profile experiments]
  bun experiments/load-save.ts <botname> <checkpoint.sav> --api http://localhost:8888

Examples:
  bun experiments/load-save.ts McPlan server/engine/data/players/experiments/mcplan.sav --profile experiments
  bun experiments/load-save.ts McPlan runs/checkpoints/cook-shrimp.sav --api http://localhost:8888

Notes:
  Without --api, this copies the file into server/engine/data/players/<profile>/<botname>.sav.
  Use this while the bot is offline, or refresh/relog the browser afterward.

  With --api, the running local engine verifies and installs the save, and disconnects
  an online player without saving over the checkpoint. Refresh/relog the browser afterward.
`.trim());
    process.exit(exitCode);
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);

    const positional = args.filter(arg => !arg.startsWith('-'));
    const botName = positional[0];
    const checkpointPath = positional[1];
    if (!botName || !checkpointPath) usage();

    let profile = 'experiments';
    let api = '';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--profile') {
            profile = args[++i] ?? profile;
        } else if (arg === '--api') {
            api = (args[++i] ?? '').replace(/\/$/, '');
        }
    }

    return { botName, checkpointPath, profile, api };
}

async function loadViaApi(botName: string, checkpointPath: string, api: string) {
    const save = readFileSync(checkpointPath);
    const response = await fetch(`${api}/api/experiment/load-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: botName,
            filename: basename(checkpointPath),
            saveBase64: Buffer.from(save).toString('base64')
        })
    });

    const result = await response.json();
    if (!response.ok || result.success === false) {
        throw new Error(result.error || `Request failed: ${response.status}`);
    }

    console.log(result.message || `Loaded checkpoint for ${botName}`);
    if (result.relogRequired) {
        console.log('Refresh/relog the browser bot page to start from this checkpoint.');
    }
}

function loadByCopy(botName: string, checkpointPath: string, profile: string) {
    const targetPath = join(process.cwd(), 'server', 'engine', 'data', 'players', profile, `${botName.toLowerCase()}.sav`);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(checkpointPath, targetPath);
    console.log(`Checkpoint copied to: ${targetPath}`);
    console.log('If the bot is online, refresh/relog it so the server loads this checkpoint.');
}

async function main() {
    const { botName, checkpointPath, profile, api } = parseArgs();
    if (!existsSync(checkpointPath)) {
        throw new Error(`Checkpoint not found: ${checkpointPath}`);
    }

    if (api) {
        await loadViaApi(botName, checkpointPath, api);
    } else {
        loadByCopy(botName, checkpointPath, profile);
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
