import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { waBot } from './whatsapp.js';
import { scheduler } from './scheduler.js';
import { uploadImageToS3 } from './filebase.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// In-memory active session tokens set
const activeTokens = new Set();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// Authentication Middleware
// ----------------------------------------------------
function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
    let token = null;

    if (authHeader) {
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7).trim();
        } else {
            token = authHeader.trim();
        }
    }

    if (token && activeTokens.has(token)) {
        return next();
    }

    return res.status(401).json({ error: 'Unauthorized: Valid Admin Password/Token required.' });
}

// ----------------------------------------------------
// Health Check Endpoint (For Render Uptime Monitor)
// ----------------------------------------------------
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        whatsapp: waBot.status,
    });
});

// ----------------------------------------------------
// Auth Routes
// ----------------------------------------------------
app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }

    if (password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        activeTokens.add(token);
        console.log('[Auth] ✓ Admin logged in successfully.');
        return res.json({ success: true, token });
    }

    console.warn('[Auth] ⚠️ Invalid password attempt.');
    return res.status(401).json({ error: 'Invalid password. Access denied.' });
});

app.get('/api/auth/verify', requireAuth, (req, res) => {
    res.json({ authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
    if (authHeader) {
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
        activeTokens.delete(token);
    }
    res.json({ success: true, message: 'Logged out from dashboard.' });
});

// ----------------------------------------------------
// WhatsApp Status & Pairing API (Protected)
// ----------------------------------------------------
app.get('/api/status', requireAuth, (req, res) => {
    res.json({
        ...waBot.getStatus(),
        config: scheduler.config,
        todayDate: scheduler.getTodayFormatted(scheduler.config.timezone),
    });
});

app.post('/api/pair', requireAuth, async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required.' });
        }
        const pairingCode = await waBot.requestPairing(phoneNumber);
        res.json({ success: true, pairingCode });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to generate pairing code' });
    }
});

app.post('/api/logout', requireAuth, async (req, res) => {
    try {
        await waBot.logout();
        res.json({ success: true, message: 'WhatsApp logged out and session cleared from Filebase.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// WhatsApp Groups API (Protected)
// ----------------------------------------------------
app.get('/api/groups', requireAuth, async (req, res) => {
    try {
        const groups = await waBot.refreshGroups();
        res.json({ groups });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/groups/target', requireAuth, async (req, res) => {
    try {
        const { groupId, groupName } = req.body;
        if (!groupId) {
            return res.status(400).json({ error: 'Group ID is required.' });
        }
        const updatedConfig = await scheduler.updateConfig({
            targetGroupId: groupId,
            targetGroupName: groupName || groupId,
        });
        res.json({ success: true, config: updatedConfig });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// Image Upload API (Protected)
// ----------------------------------------------------
app.post('/api/upload-image', requireAuth, async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'Image data is required.' });
        }

        let buffer;
        let mimeType = 'image/jpeg';
        let ext = 'jpg';

        if (image.startsWith('data:')) {
            const matches = image.match(/^data:([A-Za-z0-9\/\+\.\-]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return res.status(400).json({ error: 'Invalid image data URI.' });
            }
            mimeType = matches[1];
            buffer = Buffer.from(matches[2], 'base64');
            if (mimeType.includes('png')) ext = 'png';
            else if (mimeType.includes('webp')) ext = 'webp';
            else if (mimeType.includes('gif')) ext = 'gif';
            else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
        } else {
            buffer = Buffer.from(image, 'base64');
        }

        const safeName = `bday_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
        const uploadsDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const localPath = path.join(uploadsDir, safeName);
        fs.writeFileSync(localPath, buffer);

        // Upload to Filebase S3 for cloud persistence
        uploadImageToS3(safeName, buffer, mimeType).catch(err => {
            console.warn('[Server] ⚠️ Background S3 photo sync error:', err.message);
        });

        const imageUrl = `/uploads/${safeName}`;
        res.json({ success: true, imageUrl, filename: safeName });
    } catch (error) {
        console.error('[Server] Error uploading image:', error);
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// Birthdays Database API (Protected)
// ----------------------------------------------------
app.get('/api/birthdays', requireAuth, (req, res) => {
    res.json({ birthdays: scheduler.birthdays });
});

app.post('/api/birthdays', requireAuth, async (req, res) => {
    try {
        const { name, phone, dob, customWish, image } = req.body;
        if (!name || !dob) {
            return res.status(400).json({ error: 'Name and Date of Birth (dob) are required.' });
        }
        const newEntry = await scheduler.addBirthday({ name, phone, dob, customWish, image });
        res.status(201).json({ success: true, birthday: newEntry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/birthdays/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await scheduler.updateBirthday(id, req.body);
        if (!updated) {
            return res.status(404).json({ error: 'Birthday entry not found.' });
        }
        res.json({ success: true, birthday: updated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/birthdays/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        await scheduler.deleteBirthday(id);
        res.json({ success: true, message: 'Birthday entry deleted.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// Bot Settings API (Protected)
// ----------------------------------------------------
app.get('/api/config', requireAuth, (req, res) => {
    res.json({ config: scheduler.config });
});

app.post('/api/config', requireAuth, async (req, res) => {
    try {
        const updated = await scheduler.updateConfig(req.body);
        res.json({ success: true, config: updated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// Test & Manual Trigger Actions (Protected)
// ----------------------------------------------------
app.post('/api/test-send', requireAuth, async (req, res) => {
    try {
        const { birthdayId } = req.body;
        const sendResult = await scheduler.triggerTestWish(birthdayId);
        res.json({ success: true, result: sendResult });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/check-today', requireAuth, async (req, res) => {
    try {
        const checkResult = await scheduler.checkAndSendTodaysBirthdays();
        res.json(checkResult);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----------------------------------------------------
// Bootstrap Application
// ----------------------------------------------------
async function startServer() {
    try {
        console.log('====================================================');
        console.log('  🎂 WhatsApp Group Birthday Bot (Render Ready) 🎂  ');
        console.log('====================================================');
        console.log(`[Security] 🔒 Password Protection: ENABLED`);

        // Step 1: Start HTTP Server immediately for health checks & dashboard
        app.listen(PORT, () => {
            console.log(`[Server] ✓ Web Dashboard is live on http://localhost:${PORT}`);
            console.log(`[Server] ✓ Health endpoint ready at http://localhost:${PORT}/health`);
        });

        // Step 2: Initialize Filebase storage & Scheduler in background
        await scheduler.init();

        // Step 3: Initialize WhatsApp Baileys Client in background
        await waBot.init();
    } catch (error) {
        console.error('[Server] Fatal error on startup:', error);
        process.exit(1);
    }
}

startServer();
