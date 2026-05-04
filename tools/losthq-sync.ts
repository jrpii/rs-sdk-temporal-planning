#!/usr/bin/env bun
/**
 * Download LostHQ (2004.losthq.rs) static game databases used by the site UI.
 * Respects polite use: low volume, custom User-Agent. Site robots.txt allows
 * general access; do not use for bulk model training.
 *
 *   bun tools/losthq-sync.ts
 *   LOSTHQ_GAME_VER=254 bun tools/losthq-sync.ts
 */

// @ts-ignore
import { mkdir, writeFile } from "fs/promises";
// @ts-ignore
import { dirname, join } from "path";

const BASE = "https://2004.losthq.rs";
const VER = (globalThis as any).process?.env?.LOSTHQ_GAME_VER ?? "254";
const OUT_DIR = join("data", "losthq");
const UA =
    "rs-sdk-temporal-planning/1.0 (academic game-research; local agent RAG; low frequency)";

const FILES: [string, string][] = [
    [`${BASE}/js/npcdb/npc_data.json?v=${VER}`, "npc_data.json"],
    [`${BASE}/js/itemdb/item_data.json?v=${VER}`, "item_data.json"],
    [`${BASE}/js/npcdb/shared_drops.json?v=${VER}`, "shared_drops.json"],
];

async function main(): Promise<void> {
    await mkdir(OUT_DIR, { recursive: true });
    for (const [url, name] of FILES) {
        const dest = join(OUT_DIR, name);
        process.stderr.write(`Fetching ${url} -> ${dest} ... `);
        const res = await fetch(url, {
            headers: { "User-Agent": UA, Accept: "application/json,*/*" },
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} for ${url}`);
        }
        const buf = await res.arrayBuffer();
        await writeFile(dest, Buffer.from(buf));
        process.stderr.write(`${buf.byteLength} bytes\n`);
    }
    process.stderr.write("Done.\n");
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
