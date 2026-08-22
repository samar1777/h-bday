import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { waBot } from './whatsapp.js';
import { scheduler } from './scheduler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
// WhatsApp Status & Pairing API
// ----------------------------------------------------
app.get('/api/status', (req, res) => {
    res.json({
        ...waBot.getStatus(),
        config: scheduler.config,
        todayDate: scheduler.getTodayFormatted(scheduler.config.timezone),
    });
});

app.post('/api/pair', async (req, res) => {
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

app.post('/api/logout', async (req, res) => {
    try {
        await waBot.logout();
        res.json({ success: true, message: 'Logged out and session cleared from Filebase.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// WhatsApp Groups API
// ----------------------------------------------------
app.get('/api/groups', async (req, res) => {
    try {
        const groups = await waBot.refreshGroups();
        res.json({ groups });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/groups/target', async (req, res) => {
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
// Birthdays Database API
// ----------------------------------------------------
app.get('/api/birthdays', (req, res) => {
    res.json({ birthdays: scheduler.birthdays });
});

app.post('/api/birthdays', async (req, res) => {
    try {
        const { name, phone, dob, customWish } = req.body;
        if (!name || !dob) {
            return res.status(400).json({ error: 'Name and Date of Birth (dob) are required.' });
        }
        const newEntry = await scheduler.addBirthday({ name, phone, dob, customWish });
        res.status(201).json({ success: true, birthday: newEntry });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/birthdays/:id', async (req, res) => {
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

app.delete('/api/birthdays/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await scheduler.deleteBirthday(id);
        res.json({ success: true, message: 'Birthday entry deleted.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// Bot Settings API
// ----------------------------------------------------
app.get('/api/config', (req, res) => {
    res.json({ config: scheduler.config });
});

app.post('/api/config', async (req, res) => {
    try {
        const updated = await scheduler.updateConfig(req.body);
        res.json({ success: true, config: updated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ----------------------------------------------------
// Test & Manual Trigger Actions
// ----------------------------------------------------
app.post('/api/test-send', async (req, res) => {
    try {
        const { birthdayId } = req.body;
        const sendResult = await scheduler.triggerTestWish(birthdayId);
        res.json({ success: true, result: sendResult });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/check-today', async (req, res) => {
    try {
        const checkResult = await scheduler.checkAndSendTodaysBirthdays();
        res.json(checkResult);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve frontend for all standard routes
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

        // Step 1: Initialize Filebase storage & Scheduler
        await scheduler.init();

        // Step 2: Initialize WhatsApp Baileys Client
        await waBot.init();

        // Step 3: Start HTTP Server
        app.listen(PORT, () => {
            console.log(`[Server] ✓ Web Dashboard is live on http://localhost:${PORT}`);
            console.log(`[Server] ✓ Health endpoint ready at http://localhost:${PORT}/health`);
        });
    } catch (error) {
        console.error('[Server] Fatal error on startup:', error);
        process.exit(1);
    }
}

startServer();
