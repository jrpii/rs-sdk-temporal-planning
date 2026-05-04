import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../sdk';
import { BotActions } from '../sdk/actions';

export interface ExperimentConnection {
    sdk: BotSDK;
    bot: BotActions;
    botName: string;
    disconnect: () => void;
}

function readBotEnv(botName: string): Record<string, string> {
    const envPath = join(process.cwd(), 'bots', botName, 'bot.env');
    if (!existsSync(envPath)) {
        return {};
    }

    const env: Record<string, string> = {};
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
            env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
        }
    }
    return env;
}

export async function connectExperimentBot(botName: string, serverOverride?: string): Promise<ExperimentConnection> {
    const env = readBotEnv(botName);
    const username = env.BOT_USERNAME || botName;
    const password = env.PASSWORD || (serverOverride === 'localhost' ? '' : 'test');
    const server = serverOverride || env.SERVER || 'localhost';

    const sdk = new BotSDK({
        botUsername: username,
        password,
        gatewayUrl: deriveGatewayUrl(server),
        autoLaunchBrowser: false,
        autoReconnect: false,
        showChat: env.SHOW_CHAT?.toLowerCase() === 'true',
    });

    await sdk.connect();
    const bot = new BotActions(sdk);
    return {
        sdk,
        bot,
        botName: username,
        disconnect: () => sdk.disconnect(),
    };
}
