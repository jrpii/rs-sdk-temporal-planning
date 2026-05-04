#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { generateSave, TestPresets, type SaveConfig } from '../sdk/test/utils/save-generator';

type PresetName = keyof typeof TestPresets;

function usage(exitCode = 1): never {
    const presets = Object.keys(TestPresets).sort().join(', ');
    console.log(`
Create a binary .sav checkpoint for experiment starts.
This generates a synthetic checkpoint from an explicit preset or JSON config.
To save the current live browser bot state, use experiments/save-checkpoint.ts.

Usage:
  bun experiments/create-save.ts <botname> --preset <name> [--profile experiments]
  bun experiments/create-save.ts <botname> --config <config.json> [--profile experiments]
  bun experiments/create-save.ts <botname> --preset <name> --out runs/checkpoints/name.sav
  bun experiments/create-save.ts --list

Examples:
  bun experiments/create-save.ts McPlan --preset LUMBRIDGE_SPAWN --profile experiments
  bun experiments/create-save.ts McPlan --preset COOK_SHRIMP_LUMBRIDGE --out runs/checkpoints/cook-shrimp.sav
  bun experiments/create-save.ts ExpBot --preset FISHER_AT_ALKHARID --profile experiments
  bun experiments/create-save.ts CookBot --config experiments/save-configs/cook-shrimp.json --profile experiments

Available presets:
  ${presets}
`.trim());
    process.exit(exitCode);
}

function readJsonConfig(path: string): SaveConfig {
    return JSON.parse(readFileSync(path, 'utf-8')) as SaveConfig;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);
    if (args.includes('--list')) usage(0);

    const botName = args.find(arg => !arg.startsWith('-'));
    if (!botName) usage();

    let profile = 'experiments';
    let presetName = '';
    let configPath = '';
    let outPath = '';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--profile') {
            profile = args[++i] ?? profile;
        } else if (arg === '--preset') {
            presetName = args[++i] ?? presetName;
        } else if (arg === '--config') {
            configPath = args[++i] ?? '';
        } else if (arg === '--out') {
            outPath = args[++i] ?? '';
        }
    }

    if (!presetName && !configPath) {
        console.error('Missing required --preset or --config.');
        console.error('This command generates synthetic checkpoints; it does not save the live browser state.');
        console.error('For a live-state checkpoint, run: bun experiments/save-checkpoint.ts <botname> --out runs/checkpoints/name.sav');
        usage();
    }

    if (presetName && configPath) {
        console.error('Use either --preset or --config, not both.');
        usage();
    }

    const config = configPath
        ? readJsonConfig(configPath)
        : TestPresets[presetName as PresetName];

    if (!config) {
        console.error(`Unknown preset: ${presetName}`);
        usage();
    }

    const savePath = await generateSave(botName, config, profile);
    console.log(`Checkpoint ready: ${savePath}`);

    if (outPath) {
        mkdirSync(dirname(outPath), { recursive: true });
        copyFileSync(savePath, outPath);
        console.log(`Checkpoint copy ready: ${outPath}`);
    }

    console.log('If the bot is currently online, log it out/reload it or use Load checkpoint in the browser.');
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
