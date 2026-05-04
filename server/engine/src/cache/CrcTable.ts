import fs from 'fs';

import Packet from '#/io/Packet.js';
import Environment from '#/util/Environment.js';
import OnDemand from '#/engine/OnDemand.js';

export const CrcBuffer: Packet = new Packet(new Uint8Array(4 * 9));
export let CrcTable: number[] = [];
export let CrcBuffer32: number = 0;

const CLIENT_ARCHIVES = [
    '',
    'title',
    'config',
    'interface',
    'media',
    'versionlist',
    'textures',
    'wordenc',
    'sounds'
];

function readClientArchiveFallback(fileId: number): Uint8Array | null {
    const archiveName = CLIENT_ARCHIVES[fileId];
    if (!archiveName) {
        return null;
    }

    const path = `data/pack/client/${archiveName}`;
    if (!fs.existsSync(path)) {
        return null;
    }

    return fs.readFileSync(path);
}

export function makeCrcs() {
    CrcTable = [];

    CrcBuffer.pos = 0;

    const count = OnDemand.cache.count(0);
    for (let i = 0; i < count; i++) {
        const jag = OnDemand.cache.read(0, i) ?? readClientArchiveFallback(i);
        if (jag) {
            CrcBuffer.p4(Packet.getcrc(jag, 0, jag.length));
        } else {
            CrcBuffer.p4(0);
        }
    }

    CrcBuffer32 = Packet.getcrc(CrcBuffer.data, 0, CrcBuffer.data.length);
}

if (!Environment.STANDALONE_BUNDLE) {
    if (fs.existsSync('data/pack/client/')) {
        makeCrcs();
    }
}
