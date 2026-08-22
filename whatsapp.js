import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    delay 
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { 
    downloadSessionFromS3, 
    uploadAllSessionFilesToS3, 
    deleteSessionFromS3 
} from './filebase.js';

const SESSION_DIR = path.resolve('./auth_session');

export class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'awaiting_pairing'
        this.userInfo = null;
        this.pairingCode = null;
        this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'synced' | 'error'
        this.groupsCache = [];
        this.saveTimeout = null;
        this.reconnectAttempts = 0;
        this.isInitializing = false;
    }

    /**
     * Ensure session directory exists safely
     */
    ensureSessionDir() {
        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
        }
    }

    /**
     * Trigger debounced upload of all auth files to Filebase S3
     */
    scheduleS3Sync() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(async () => {
            if (this.status !== 'connected') return;
            this.syncStatus = 'syncing';
            try {
                this.ensureSessionDir();
                await uploadAllSessionFilesToS3(SESSION_DIR);
                this.syncStatus = 'synced';
            } catch (err) {
                console.error('[WhatsApp] Error syncing to Filebase:', err.message);
                this.syncStatus = 'error';
            }
        }, 2500);
    }

    /**
     * Clean up any existing socket before creating a new one
     */
    cleanupSocket() {
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                this.sock.end(undefined);
            } catch {}
            this.sock = null;
        }
    }

    /**
     * Initializes the WhatsApp Baileys connection
     */
    async init(forceFresh = false) {
        if (this.isInitializing) return this;
        this.isInitializing = true;

        try {
            this.cleanupSocket();
            this.ensureSessionDir();

            if (forceFresh) {
                console.log('[WhatsApp] Clearing local auth session directory...');
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                this.ensureSessionDir();
            } else {
                // Check Filebase for session tokens
                console.log('[WhatsApp] Checking Filebase for session tokens...');
                const hasRemoteSession = await downloadSessionFromS3(SESSION_DIR);
                if (hasRemoteSession) {
                    console.log('[WhatsApp] Existing session found in Filebase!');
                }
            }

            this.ensureSessionDir();
            const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`[WhatsApp] Using Baileys version: ${version.join('.')} (isLatest: ${isLatest})`);

            this.sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: state,
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
                syncFullHistory: false,
                generateHighQualityLinkPreview: true,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
            });

            // Handle credential saves & S3 sync
            this.sock.ev.on('creds.update', async () => {
                try {
                    this.ensureSessionDir();
                    await saveCreds();
                    this.scheduleS3Sync();
                } catch (err) {
                    console.error('[WhatsApp] Error saving creds:', err.message);
                }
            });

            // Handle connection lifecycle
            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'connecting') {
                    if (this.status !== 'awaiting_pairing') {
                        this.status = 'connecting';
                    }
                    console.log('[WhatsApp] Connecting to WhatsApp network...');
                } else if (connection === 'open') {
                    this.status = 'connected';
                    this.reconnectAttempts = 0;
                    this.pairingCode = null;
                    
                    const user = this.sock?.user;
                    this.userInfo = {
                        id: user?.id,
                        name: user?.name || 'WhatsApp User',
                        phone: user?.id ? user.id.split(':')[0] : '',
                    };

                    console.log(`[WhatsApp] ✓ Connected successfully as +${this.userInfo.phone}!`);
                    
                    // Push credentials to Filebase S3
                    this.ensureSessionDir();
                    await uploadAllSessionFilesToS3(SESSION_DIR);
                    this.syncStatus = 'synced';

                    // Fetch groups in background
                    this.refreshGroups().catch(() => {});
                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                    
                    console.log(`[WhatsApp] Connection closed (status: ${statusCode}). Reconnecting: ${!isLoggedOut}`);

                    if (isLoggedOut && this.userInfo) {
                        // User was actually logged in and now logged out
                        console.log('[WhatsApp] Account logged out. Resetting local & remote session...');
                        this.status = 'disconnected';
                        this.userInfo = null;
                        this.pairingCode = null;
                        
                        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                        this.ensureSessionDir();
                        await deleteSessionFromS3();
                    } else {
                        // Temporary disconnect or pairing timeout (401/408 before linking)
                        if (this.status !== 'awaiting_pairing') {
                            this.status = 'disconnected';
                        }
                        this.userInfo = null;

                        if (!isLoggedOut) {
                            this.reconnectAttempts++;
                            const delayMs = Math.min(4000 * this.reconnectAttempts, 20000);
                            console.log(`[WhatsApp] Reconnecting in ${delayMs / 1000}s...`);
                            setTimeout(() => {
                                if (this.status !== 'connected') {
                                    this.init();
                                }
                            }, delayMs);
                        }
                    }
                }
            });

            return this;
        } finally {
            this.isInitializing = false;
        }
    }

    /**
     * Request a Pairing Code for a phone number
     */
    async requestPairing(rawPhoneNumber) {
        if (!rawPhoneNumber) {
            throw new Error('Phone number is required');
        }

        const cleanNumber = rawPhoneNumber.replace(/\D/g, '');
        if (cleanNumber.length < 10) {
            throw new Error('Invalid phone number format. Must include country code (e.g. 919876543210).');
        }

        if (this.status === 'connected') {
            throw new Error('Already connected to WhatsApp! Log out first if you want to pair a new number.');
        }

        console.log(`[WhatsApp] Preparing fresh socket for pairing with +${cleanNumber}...`);
        
        // Reinitialize fresh socket without stale credentials
        await this.init(true);

        // Allow socket handshake with WhatsApp servers
        await delay(3000);

        try {
            if (!this.sock) {
                throw new Error('WhatsApp socket could not be established.');
            }

            const code = await this.sock.requestPairingCode(cleanNumber);
            const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
            this.pairingCode = formattedCode;
            this.status = 'awaiting_pairing';
            
            console.log(`[WhatsApp] 🔑 PAIRING CODE GENERATED: ${formattedCode}`);
            return formattedCode;
        } catch (error) {
            console.error('[WhatsApp] ⚠️ Failed to request pairing code:', error.message);
            throw error;
        }
    }

    /**
     * Fetches all WhatsApp groups that the connected number is a member of
     */
    async refreshGroups() {
        if (this.status !== 'connected' || !this.sock) {
            return [];
        }

        try {
            const groupsMap = await this.sock.groupFetchAllParticipating();
            const groupsList = Object.values(groupsMap).map((g) => ({
                id: g.id,
                subject: g.subject || 'Unnamed Group',
                participantsCount: g.participants?.length || 0,
                desc: g.desc || '',
                creation: g.creation,
            }));

            groupsList.sort((a, b) => a.subject.localeCompare(b.subject));
            this.groupsCache = groupsList;
            return groupsList;
        } catch (error) {
            console.error('[WhatsApp] Error fetching participating groups:', error.message);
            return this.groupsCache;
        }
    }

    /**
     * Sends a custom text message to a specific WhatsApp group
     */
    async sendGroupMessage(groupId, message, mentions = []) {
        if (this.status !== 'connected' || !this.sock) {
            throw new Error('WhatsApp is not connected. Please pair your account first.');
        }

        if (!groupId || !groupId.endsWith('@g.us')) {
            throw new Error('Invalid Group ID. Must be in the format: 120363xxxxxx@g.us');
        }

        const msgPayload = {
            text: message,
        };

        if (mentions && mentions.length > 0) {
            msgPayload.mentions = mentions;
        }

        const response = await this.sock.sendMessage(groupId, msgPayload);
        console.log(`[WhatsApp] ✓ Message successfully sent to group ${groupId}`);
        return response;
    }

    /**
     * Formats and dispatches a birthday greeting into a target WhatsApp group
     */
    async sendBirthdayWishToGroup(groupId, birthdayPerson) {
        const { name, phone, customWish } = birthdayPerson;
        
        let mentionJid = null;
        let mentionText = name;

        if (phone) {
            const cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone.length >= 10) {
                mentionJid = `${cleanPhone}@s.whatsapp.net`;
                mentionText = `@${cleanPhone}`;
            }
        }

        const defaultWish = (
            `🎉🎂 *HAPPY BIRTHDAY ${mentionText.toUpperCase()}!* 🎂🎉\n\n` +
            `Wishing you a fabulous day filled with love, laughter, and endless happiness! 🥳✨\n` +
            `May this upcoming year bring you massive success and great health! 🥂🎈\n\n` +
            `_Let's all celebrate ${mentionText}'s special day!_ 🎊🍰`
        );

        const messageText = customWish ? customWish.replace(/\{name\}/g, mentionText) : defaultWish;
        const mentions = mentionJid ? [mentionJid] : [];

        return await this.sendGroupMessage(groupId, messageText, mentions);
    }

    /**
     * Disconnects and resets session
     */
    async logout() {
        console.log('[WhatsApp] Logging out...');
        try {
            if (this.sock) {
                await this.sock.logout();
            }
        } catch {}

        this.cleanupSocket();
        if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        }
        this.ensureSessionDir();
        await deleteSessionFromS3();
        
        this.status = 'disconnected';
        this.userInfo = null;
        this.pairingCode = null;
        this.groupsCache = [];
        this.syncStatus = 'idle';

        setTimeout(() => this.init(), 1000);
        return true;
    }

    /**
     * Returns full status summary
     */
    getStatus() {
        return {
            status: this.status,
            userInfo: this.userInfo,
            pairingCode: this.pairingCode,
            syncStatus: this.syncStatus,
            cachedGroupsCount: this.groupsCache.length,
        };
    }
}

export const waBot = new WhatsAppBot();
