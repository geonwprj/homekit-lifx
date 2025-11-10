// src/index.ts
import { DeviceTypeId, Endpoint, Environment, Logger, ServerNode, StorageService, Time, VendorId } from "@matter/main";
import { ExtendedColorLightDevice } from "@matter/main/devices";
import { ConsoleLogger } from "./ConsoleLogger";
import * as fs from "node:fs";
import * as path from "node:path";
import express from 'express';
import bodyParser from 'body-parser';
import QRCode from 'qrcode'; // For generating QR code data URL

const enum ColorMode {
    CurrentHueAndCurrentSaturation = 0,
    CurrentXAndCurrentY = 1,
    ColorTemperatureMireds = 2,
}

interface CommissioningState {
    pairingCodes: {
        qrPairingCode: string;
    };
}

const logger = Logger.get("LIFXMatterBridge");
const consoleLogger = new ConsoleLogger();

const CONFIG_FILE = path.resolve(process.cwd(), 'config.json'); // config.json will be in the project root
const STATIC_DIR = path.resolve(__dirname, '../static'); // static folder will be in the project root

interface Config {
    pincode: number;
    discriminator: number;
    vendorId: number;
    productId: number;
    uniqueId: string;
    lifxApiKey: string | null;
    homekitLightId: string | null; // ID of the LIFX light selected for HomeKit control
}

// Default configuration values
const defaultConfig: Config = {
    pincode: Math.floor(10000000 + Math.random() * 90000000), // Generate a random 8-digit pincode
    discriminator: 3840,
    vendorId: 0xFFF1,
    productId: 0x8000,
    uniqueId: Time.nowMs().toString(),
    lifxApiKey: null,
    homekitLightId: null,
};

let currentConfig: Config = { ...defaultConfig };
let matterServer: ServerNode | null = null;
let matterEndpoint: Endpoint<ExtendedColorLightDevice> | null = null;
let isSyncingFromLifx = false;

// --- Configuration Management ---
function loadConfig(): void {
    if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        currentConfig = { ...defaultConfig, ...JSON.parse(data) };
        logger.info(`Configuration loaded from ${CONFIG_FILE}`);
    } else {
        logger.info(`No config.json found. Using default configuration and generating new pincode.`);
        saveConfig(); // Save the newly generated pincode
    }
}

function saveConfig(): void {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
    logger.info(`Configuration saved to ${CONFIG_FILE}`);
}

// --- LIFX API Interaction ---
async function getLifxLights(apiKey: string): Promise<any[]> {
    if (!apiKey) return [];
    try {
        const response = await fetch('https://api.lifx.com/v1/lights/all', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        if (!response.ok) {
            logger.error(`LIFX API error: ${response.statusText}`);
            return [];
        }
        return await response.json();
    } catch (error) {
        logger.error(`Error fetching LIFX lights: ${error}`);
        return [];
    }
}

async function getLifxLightState(apiKey: string, selector: string): Promise<any | null> {
    if (!apiKey || !selector) return null;
    try {
        const response = await fetch(`https://api.lifx.com/v1/lights/${selector}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        if (!response.ok) {
            logger.error(`LIFX API error getting state for ${selector}: ${response.statusText}`);
            return null;
        }
        const lights = await response.json();
        return lights[0] ?? null; // The API returns an array even for a single selector
    } catch (error) {
        logger.error(`Error fetching LIFX light state for ${selector}: ${error}`);
        return null;
    }
}

async function controlLifxLight(apiKey: string, selector: string, state: any): Promise<boolean> {
    if (!apiKey || !selector) {
        logger.warn("Cannot control LIFX light: API Key or selector missing.");
        return false;
    }
    try {
        const response = await fetch(`https://api.lifx.com/v1/lights/${selector}/state`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(state)
        });
        if (!response.ok) {
            logger.error(`LIFX control error for ${selector}: ${response.statusText}`);
            return false;
        }
        logger.info(`LIFX light ${selector} updated with state: ${JSON.stringify(state)}`);
        return true;
    } catch (error) {
        logger.error(`Error controlling LIFX light ${selector}: ${error}`);
        return false;
    }
}

async function triggerLifxEffect(apiKey: string, selector: string, effect: string): Promise<boolean> {
    if (!apiKey || !selector) {
        logger.warn("Cannot trigger LIFX effect: API Key or selector missing.");
        return false;
    }
    try {
        const response = await fetch(`https://api.lifx.com/v1/lights/${selector}/effects/${effect}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                // Default parameters for breathe/pulse, adjust as needed
                period: 2,
                cycles: 3,
                persist: false,
                power_on: true
            })
        });
        if (!response.ok) {
            logger.error(`LIFX effect error for ${selector}: ${response.statusText}`);
            return false;
        }
        logger.info(`LIFX light ${selector} effect triggered: ${effect}`);
        return true;
    } catch (error) {
        logger.error(`Error triggering LIFX effect ${selector}: ${error}`);
        return false;
    }
}

// --- Matter <-> LIFX State Sync ---
const POLLING_INTERVAL_MS = 10000; // 10 seconds

function updateMatterEndpointFromLifx(lifxState: any) {
    if (!matterEndpoint || !lifxState) return;

    logger.info(`Syncing LIFX state to Matter: ${JSON.stringify(lifxState)}`);

    isSyncingFromLifx = true;
    try {
        // const clusterServers = matterEndpoint.getAllClusterServers();
        //
        // for (const clusterServer of clusterServers) {
        //     // OnOff Cluster (ID: 0x0006)
        //     if (clusterServer.id === 0x0006) {
        //         const onOffCluster = clusterServer as any;
        //         const isLifxOn = lifxState.power === 'on';
        //         if (onOffCluster.getOnOffAttribute() !== isLifxOn) {
        //             logger.info(`Updating Matter OnOff state to ${isLifxOn}`);
        //             onOffCluster.setOnOffAttribute(isLifxOn);
        //         }
        //     }
        //
        //     // LevelControl Cluster (ID: 0x0008)
        //     if (clusterServer.id === 0x0008) {
        //         const levelControlCluster = clusterServer as any;
        //         const matterBrightness = Math.round(lifxState.brightness * 254);
        //         if (levelControlCluster.getCurrentLevelAttribute() !== matterBrightness) {
        //             logger.info(`Updating Matter brightness level to ${matterBrightness}`);
        //             levelControlCluster.setCurrentLevelAttribute(matterBrightness);
        //         }
        //     }
        //
        //     // ColorControl Cluster (ID: 0x0300)
        //     if (clusterServer.id === 0x0300) {
        //         const colorControlCluster = clusterServer as any;
        //         if (lifxState.color) {
        //             const kelvin = lifxState.color.kelvin;
        //             if (kelvin) {
        //                 const mireds = Math.round(1000000 / kelvin);
        //                 if (colorControlCluster.getColorTemperatureMiredsAttribute() !== mireds) {
        //                     logger.info(`Updating Matter color temperature to ${mireds} mireds`);
        //                     colorControlCluster.setColorTemperatureMiredsAttribute(mireds);
        //                 }
        //             }
        //         }
        //     }
        // }
    } finally {
        isSyncingFromLifx = false;
    }
}

async function pollLifxAndUpdateMatter() {
    if (currentConfig.lifxApiKey && currentConfig.homekitLightId && matterEndpoint) {
        logger.info("Polling LIFX for status...");
        const lifxState = await getLifxLightState(currentConfig.lifxApiKey, currentConfig.homekitLightId);
        if (lifxState) {
            updateMatterEndpointFromLifx(lifxState);
        }
    }
}

function startPolling() {
    setInterval(pollLifxAndUpdateMatter, POLLING_INTERVAL_MS);
    logger.info(`Started polling LIFX status every ${POLLING_INTERVAL_MS / 1000} seconds.`);
}

// --- Matter Device Setup ---
async function setupMatterDevice() {
    if (matterServer) {
        logger.info("Matter server already running, stopping and restarting...");
        await matterServer.close();
    }

    const deviceName = currentConfig.homekitLightId ? `Lifx - ${currentConfig.homekitLightId}` : "LIFX Matter Bridge";
    const vendorName = "matter-node.js"; // or your vendor name
    const productName = deviceName;
    const port = Environment.default.vars.number("port") ?? 5540;

    matterServer = await ServerNode.create({
        id: currentConfig.uniqueId,
        network: { port },
        commissioning: {
            passcode: currentConfig.pincode,
            discriminator: currentConfig.discriminator,
        },
        productDescription: {
            name: deviceName,
            deviceType: DeviceTypeId(ExtendedColorLightDevice.deviceType),
        },
        basicInformation: {
            vendorName,
            vendorId: VendorId(currentConfig.vendorId),
            nodeLabel: productName,
            productName,
            productLabel: productName,
            productId: currentConfig.productId,
            serialNumber: `matterjs-${currentConfig.uniqueId}`,
            uniqueId: currentConfig.uniqueId,
        },
    });

    matterEndpoint = new Endpoint(ExtendedColorLightDevice, {
        id: "light",
        colorControl: {
            colorMode: ColorMode.CurrentXAndCurrentY,
            colorTempPhysicalMinMireds: 111,
            colorTempPhysicalMaxMireds: 400,
            coupleColorTempToLevelMinMireds: 111,
        }
    });
    await matterServer.add(matterEndpoint);

    console.log('matterEndpoint object:', matterEndpoint);

    // Event handlers for HomeKit (Matter) changes
    matterEndpoint.events.identify.startIdentifying.on(() => {
        console.log(`Run identify logic for HomeKit ...`);
        // Optionally trigger a LIFX breathe effect on the selected light
        if (currentConfig.lifxApiKey && currentConfig.homekitLightId) {
            triggerLifxEffect(currentConfig.lifxApiKey, currentConfig.homekitLightId, 'breathe');
        }
    });

    matterEndpoint.events.identify.stopIdentifying.on(() => {
        console.log(`Stop identify logic ...`);
    });

    matterEndpoint.events.onOff.onOff$Changed.on(async (value: boolean) => {
        if (isSyncingFromLifx) return;
        console.log(`Matter OnOff is now ${value ? "ON" : "OFF"}`);
        if (matterEndpoint) {
            console.log(`Color mode is: ${matterEndpoint.state.colorControl.colorMode}`);
        }
        if (currentConfig.lifxApiKey && currentConfig.homekitLightId) {
            await controlLifxLight(currentConfig.lifxApiKey, currentConfig.homekitLightId, { power: value ? "on" : "off" });
        } else {
            logger.warn("LIFX API Key or HomeKit Light ID not set. Cannot control LIFX light.");
        }
    });

    matterEndpoint.events.levelControl.currentLevel$Changed.on(async (value: number | null) => {
        if (isSyncingFromLifx) return;
        console.log(`Matter Level is now ${value}`);
        if (value !== null && currentConfig.lifxApiKey && currentConfig.homekitLightId) {
            await controlLifxLight(currentConfig.lifxApiKey, currentConfig.homekitLightId, { brightness: value / 254 });
        } else {
            logger.warn("LIFX API Key or HomeKit Light ID not set. Cannot control LIFX light.");
        }
    });

    matterEndpoint.events.colorControl.colorTemperatureMireds$Changed.on(async (value: number | null) => {
        if (isSyncingFromLifx) return;
        console.log(`Matter Color Temperature is now ${value}`);
        if (value !== null && currentConfig.lifxApiKey && currentConfig.homekitLightId) {
            await controlLifxLight(currentConfig.lifxApiKey, currentConfig.homekitLightId, { kelvin: Math.round(1000000 / value) });
        } else {
            logger.warn("LIFX API Key or HomeKit Light ID not set. Cannot control LIFX light.");
        }
    });

    matterEndpoint.events.colorControl.currentX$Changed.on(async (value: number | null) => {
        if (isSyncingFromLifx) return;
        console.log(`Matter X is now ${value}`);
        if (matterEndpoint && value !== null && currentConfig.lifxApiKey && currentConfig.homekitLightId) {
            const y = matterEndpoint.state.colorControl.currentY;
            await controlLifxLight(currentConfig.lifxApiKey, currentConfig.homekitLightId, { color: `x:${value / 65535} y:${y / 65535}` });
        } else {
            logger.warn("LIFX API Key or HomeKit Light ID not set. Cannot control LIFX light.");
        }
    });

    matterEndpoint.events.colorControl.currentY$Changed.on(async (value: number | null) => {
        if (isSyncingFromLifx) return;
        console.log(`Matter Y is now ${value}`);
        if (matterEndpoint && value !== null && currentConfig.lifxApiKey && currentConfig.homekitLightId) {
            const x = matterEndpoint.state.colorControl.currentX;
            await controlLifxLight(currentConfig.lifxApiKey, currentConfig.homekitLightId, { color: `x:${x / 65535} y:${value / 65535}` });
        } else {
            logger.warn("LIFX API Key or HomeKit Light ID not set. Cannot control LIFX light.");
        }
    });

    logger.info("Matter Device initialized.");
    matterServer.run(); // Start the Matter server, will print QR to console first
}

async function main() {
    consoleLogger.start();

    loadConfig(); // Load initial configuration

    // Start Matter device and web server in parallel
    await Promise.all([
        setupMatterDevice(),
        startWebServer(consoleLogger)
    ]);

    startPolling(); // Start polling for LIFX state changes

    consoleLogger.stop();
}

main().catch(error => {
    logger.error("Application crashed:", error);
    process.exit(1);
});

// --- Web Server Setup ---
async function startWebServer(consoleLogger: ConsoleLogger) {
    const app = express();
    app.use(bodyParser.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(STATIC_DIR));

    app.get('/info', (req, res) => {
        res.sendFile(path.resolve(STATIC_DIR, 'index.html'));
    });

    // API to get device info (for info.html)
    app.get('/api/info', async (req, res) => {
        let qrCodeDataUrl: string = '';
        if (matterServer) {
            const qrPairingCode = (matterServer.state.commissioning as unknown as CommissioningState).pairingCodes.qrPairingCode;
            qrCodeDataUrl = await QRCode.toDataURL(qrPairingCode);
        }

        let apiKeyValid = false;
        let lifxLights: any[] = [];
        if (currentConfig.lifxApiKey) {
            lifxLights = await getLifxLights(currentConfig.lifxApiKey);
            apiKeyValid = lifxLights.length > 0; // Simple validation: if we get any lights, API key is likely valid
        }

        res.json({
            pincode: currentConfig.pincode,
            qrCodeDataUrl: qrCodeDataUrl,
            lifxApiKey: currentConfig.lifxApiKey,
            apiKeyValid: apiKeyValid,
            homekitLightId: currentConfig.homekitLightId,
            lights: lifxLights.map(l => ({ id: l.id, label: l.label, power: l.power, brightness: l.brightness, color: l.color })),
            packageJson: (() => {
                try {
                    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
                } catch (e) {
                    logger.error("Failed to read or parse package.json:", e);
                    return {}; // Return an empty object to prevent crash
                }
            })()
        });
    });

    app.get('/api/logs', (req, res) => {
        res.json(consoleLogger.getLogs());
    });

    // API to update LIFX API key
    app.post('/api/update-api-key', async (req, res) => {
        const { apiKey } = req.body;
        if (apiKey) {
            currentConfig.lifxApiKey = apiKey;
            saveConfig();
            res.status(200).send('LIFX API Key updated.');
        } else {
            res.status(400).send('Missing API Key.');
        }
    });

    // API to select a LIFX light for HomeKit
    app.post('/api/set-homekit-light', async (req, res) => {
        const { lightId } = req.body;
        if (lightId) {
            currentConfig.homekitLightId = lightId;
            saveConfig();
            res.status(200).send('HomeKit light selected.');
        } else {
            res.status(400).send('Missing light ID.');
        }
    });

    // API to get available LIFX lights (used by the control section)
    app.get('/api/lights', async (req, res) => {
        if (!currentConfig.lifxApiKey) {
            return res.status(400).json([]);
        }
        const lights = await getLifxLights(currentConfig.lifxApiKey);
        // Filter to only return the selected HomeKit light for control
        const selectedLight = lights.find(l => l.id === currentConfig.homekitLightId);
        if (selectedLight) {
            res.json([selectedLight]);
        } else {
            res.json([]);
        }
    });


    // API to control a LIFX light
    app.post('/api/control', async (req, res) => {
        const { command, selector, state, effect } = req.body;
        if (!currentConfig.lifxApiKey) {
            return res.status(400).send('LIFX API Key not set.');
        }

        let success = false;
        if (command === 'set_state' && state) {
            success = await controlLifxLight(currentConfig.lifxApiKey, selector, state);
        } else if (command === 'effect' && effect) {
            success = await triggerLifxEffect(currentConfig.lifxApiKey, selector, effect);
        } else {
            return res.status(400).send('Invalid control command.');
        }

        if (success) {
            res.status(200).send('Light controlled successfully.');
        } else {
            res.status(500).send('Failed to control light.');
        }
    });

    const webPort = process.env.WEB_PORT ? parseInt(process.env.WEB_PORT) : 3000;
    app.listen(webPort, () => {
        logger.info(`Web server listening on http://localhost:${webPort}`);
        logger.info(`Open http://localhost:${webPort}/index.html to manage settings.`);
    });
}
