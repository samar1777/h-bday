import makeWASocket, { 
    DisconnectReason, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    delay,
    Browsers,
    makeCacheableSignalKeyStore
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
        }, 2000);
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
                console.log('[WhatsApp] Clearing old session for new pairing...');
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                this.ensureSessionDir();
                await deleteSessionFromS3();
            } else {
                // Only restore from Filebase S3 if the local directory is empty (e.g. cold start on Render)
                const localFiles = fs.existsSync(SESSION_DIR) ? fs.readdirSync(SESSION_DIR).filter(f => !f.startsWith('.')) : [];
                if (localFiles.length === 0) {
                    console.log('[WhatsApp] Local session empty. Checking Filebase S3 for saved session...');
                    const hasRemoteSession = await downloadSessionFromS3(SESSION_DIR);
                    if (hasRemoteSession) {
                        console.log('[WhatsApp] ✓ Existing session restored from Filebase S3!');
                    }
                } else {
                    console.log(`[WhatsApp] Using local auth session (${localFiles.length} files found).`);
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
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
                },
                browser: Browsers.ubuntu('Chrome'),
                syncFullHistory: false,
                generateHighQualityLinkPreview: true,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 25000,
                markOnlineOnConnect: false,
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
                    const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
                    
                    console.log(`[WhatsApp] Connection closed (status: ${statusCode} - ${isRestartRequired ? 'Restart Required (Pairing Linked)' : isLoggedOut ? 'Logged Out' : 'Temporary'}). Reconnecting: ${!isLoggedOut}`);

                    if (isLoggedOut && this.userInfo) {
                        // User was actually logged in and now logged out
                        console.log('[WhatsApp] Account logged out. Resetting local & remote session...');
                        this.status = 'disconnected';
                        this.userInfo = null;
                        this.pairingCode = null;
                        
                        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                        this.ensureSessionDir();
                        await deleteSessionFromS3();
                    } else if (isRestartRequired) {
                        // Status 515 is the expected restart signal right after pairing code is entered on phone!
                        console.log('[WhatsApp] 🔄 Status 515: Pairing code accepted! Performing fast restart to activate session...');
                        this.status = 'connecting';
                        this.reconnectAttempts = 0;
                        setTimeout(() => {
                            this.init(false);
                        }, 1500);
                    } else {
                        // Temporary disconnect
                        if (this.status !== 'awaiting_pairing') {
                            this.status = 'disconnected';
                        }
                        this.userInfo = null;

                        if (!isLoggedOut) {
                            this.reconnectAttempts++;
                            const delayMs = Math.min(3000 * this.reconnectAttempts, 15000);
                            console.log(`[WhatsApp] Reconnecting in ${delayMs / 1000}s...`);
                            setTimeout(() => {
                                if (this.status !== 'connected') {
                                    this.init(false);
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
     * Resolves an image source (data URI, local /uploads path, or URL) into a Buffer
     */
    async resolveImageBuffer(imageSource) {
        if (!imageSource || typeof imageSource !== 'string') return null;
        const trimmed = imageSource.trim();
        if (!trimmed) return null;

        try {
            // 1. Data URL (Base64)
            if (trimmed.startsWith('data:image/')) {
                const parts = trimmed.split(',');
                if (parts[1]) {
                    return Buffer.from(parts[1], 'base64');
                }
            }

            // 2. Relative local path e.g. /uploads/image.jpg
            if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
                const cleanPath = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
                const fullPath = path.resolve('./public', cleanPath);
                if (fs.existsSync(fullPath)) {
                    return fs.readFileSync(fullPath);
                }
            }

            // 3. Absolute local file path
            if (fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) {
                return fs.readFileSync(trimmed);
            }

            // 4. Remote HTTP / HTTPS URL
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                const resp = await fetch(trimmed);
                if (resp.ok) {
                    const arrayBuffer = await resp.arrayBuffer();
                    return Buffer.from(arrayBuffer);
                }
            }
        } catch (err) {
            console.warn(`[WhatsApp] ⚠️ Could not resolve image buffer for '${trimmed.slice(0, 50)}...':`, err.message);
        }
        return null;
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

        try {
            const response = await this.sock.sendMessage(groupId, msgPayload);
            console.log(`[WhatsApp] ✓ Message successfully sent to group ${groupId}`);
            return response;
        } catch (err) {
            if (err.message?.includes('item-not-found')) {
                throw new Error(`Target WhatsApp group (${groupId}) was not found. Please open the 'Target Group' tab, choose an active group from the dropdown, and click 'Save Target Group'.`);
            }
            throw err;
        }
    }

    /**
     * Formats and dispatches a birthday greeting into a target WhatsApp group.
     * If an image is provided, sends the photo with the greeting as the caption.
     * Always tags the recipient number and preserves custom messages as entered.
     */
    async sendBirthdayWishToGroup(groupId, birthdayPerson) {
        const { name, phone, customWish, image } = birthdayPerson;
        
        const mentions = [];
        let tagText = '';

        if (phone) {
            const cleanPhone = phone.replace(/\D/g, '');
            if (cleanPhone.length >= 8) {
                const jid = `${cleanPhone}@s.whatsapp.net`;
                mentions.push(jid);
                tagText = `@${cleanPhone}`;
            }
        }

        let messageText = '';

        if (customWish && customWish.trim().length > 0) {
            let msg = customWish.trim();

            // Replace {name} or {tag} placeholder if present
            if (msg.includes('{name}')) {
                msg = msg.replace(/\{name\}/g, tagText || name || 'Friend');
            }
            if (msg.includes('{tag}')) {
                msg = msg.replace(/\{tag\}/g, tagText || name || 'Friend');
            }

            // Always tag the number if provided and not already in the custom message
            if (tagText && !msg.includes(tagText)) {
                messageText = `${tagText} ${msg}`;
            } else {
                messageText = msg;
            }
        } else {
            // Default greeting template
            const headerTag = tagText || (name ? name.toUpperCase() : 'FRIEND');
            messageText = (
                `🎉🎂 *HAPPY BIRTHDAY ${headerTag}!* 🎂🎉\n\n` +
                `Wishing you a fantastic day filled with happiness, success, and joy! 🥳✨\n` +
                `May all your dreams come true this year! 🥂🎈\n\n` +
                `_Let's all celebrate ${headerTag}'s special day!_ 🎊🍰`
            );
        }

        // Detect and register any other @123456789 mentions present in the message
        const extraMentions = messageText.match(/@(\d{8,16})/g);
        if (extraMentions) {
            extraMentions.forEach(m => {
                const jid = `${m.replace('@', '')}@s.whatsapp.net`;
                if (!mentions.includes(jid)) {
                    mentions.push(jid);
                }
            });
        }

        // If a photo/image is attached, attempt to send as media message with caption
        if (image) {
            const imageBuffer = await this.resolveImageBuffer(image);
            if (imageBuffer) {
                try {
                    console.log(`[WhatsApp] Sending birthday photo wish for ${name} to group ${groupId} with mentions:`, mentions);
                    if (this.status !== 'connected' || !this.sock) {
                        throw new Error('WhatsApp is not connected. Please pair your account first.');
                    }

                    const mediaPayload = {
                        image: imageBuffer,
                        caption: messageText,
                    };

                    if (mentions && mentions.length > 0) {
                        mediaPayload.mentions = mentions;
                    }

                    const mediaResponse = await this.sock.sendMessage(groupId, mediaPayload);
                    console.log(`[WhatsApp] ✓ Photo birthday wish successfully sent to group ${groupId}`);
                    return mediaResponse;
                } catch (mediaError) {
                    console.error(`[WhatsApp] ⚠️ Photo send failed (${mediaError.message}), falling back to text wish...`);
                }
            }
        }

        console.log(`[WhatsApp] Sending text birthday message to group ${groupId} with mentions:`, mentions);
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
