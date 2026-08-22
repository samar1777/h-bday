import cron from 'node-cron';
import path from 'path';
import { loadJsonFromS3, saveJsonToS3 } from './filebase.js';
import { waBot } from './whatsapp.js';

const BIRTHDAYS_LOCAL_PATH = path.resolve('./birthdays.json');
const CONFIG_LOCAL_PATH = path.resolve('./config.json');

const DEFAULT_CONFIG = {
    targetGroupId: '', // e.g. "120363xxxxxx@g.us"
    targetGroupName: '',
    timezone: 'Asia/Kolkata',
    scheduleHour: 0,
    scheduleMinute: 0,
    enabled: true,
};

const DEFAULT_BIRTHDAYS = [
    {
        id: '1',
        name: 'Sample Friend',
        phone: '+919876543210',
        dob: '08-22', // MM-DD
        customWish: '🎉 Happy Birthday {name}! Wishing you all the happiness and joy in the world! 🎂🥂',
    }
];

export class BirthdayScheduler {
    constructor() {
        this.birthdays = [];
        this.config = { ...DEFAULT_CONFIG };
        this.cronJob = null;
        this.lastCheckedDate = null;
    }

    async init() {
        console.log('[Scheduler] Loading birthdays and configuration from Filebase S3...');
        this.birthdays = await loadJsonFromS3('birthdays.json', BIRTHDAYS_LOCAL_PATH, DEFAULT_BIRTHDAYS);
        this.config = await loadJsonFromS3('config.json', CONFIG_LOCAL_PATH, DEFAULT_CONFIG);
        
        this.setupCron();
        console.log(`[Scheduler] Loaded ${this.birthdays.length} birthday entries. Target group: ${this.config.targetGroupName || this.config.targetGroupId || 'Not Set'}`);
    }

    setupCron() {
        if (this.cronJob) {
            this.cronJob.stop();
        }

        const { scheduleHour, scheduleMinute, timezone, enabled } = this.config;
        if (!enabled) {
            console.log('[Scheduler] Automated birthday sending is currently paused in settings.');
            return;
        }

        // Cron expression: minute hour * * *
        const cronExpression = `${scheduleMinute} ${scheduleHour} * * *`;
        console.log(`[Scheduler] Setting up cron job: '${cronExpression}' in timezone: '${timezone}'`);

        this.cronJob = cron.schedule(
            cronExpression,
            async () => {
                console.log(`[Scheduler] ⏰ Cron triggered at ${new Date().toISOString()}`);
                await this.checkAndSendTodaysBirthdays();
            },
            {
                scheduled: true,
                timezone: timezone || 'Asia/Kolkata',
            }
        );
    }

    getTodayFormatted(timezone = 'Asia/Kolkata') {
        try {
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                month: '2-digit',
                day: '2-digit',
            });
            const parts = formatter.formatToParts(now);
            const month = parts.find((p) => p.type === 'month')?.value;
            const day = parts.find((p) => p.type === 'day')?.value;
            return `${month}-${day}`;
        } catch {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            return `${month}-${day}`;
        }
    }

    async checkAndSendTodaysBirthdays() {
        const today = this.getTodayFormatted(this.config.timezone);
        console.log(`[Scheduler] Checking birthdays for today (${today})...`);

        if (!this.config.targetGroupId) {
            console.log('[Scheduler] ⚠️ No target group ID configured! Skipping sending.');
            return { success: false, reason: 'Target group not set' };
        }

        const matches = this.birthdays.filter((b) => {
            const cleanDob = b.dob?.length > 5 ? b.dob.slice(-5) : b.dob; // Handles YYYY-MM-DD or MM-DD
            return cleanDob === today;
        });

        if (matches.length === 0) {
            console.log(`[Scheduler] No birthdays found for today (${today}).`);
            return { success: true, count: 0, matches: [] };
        }

        console.log(`[Scheduler] 🎉 Found ${matches.length} birthday(s) for today!`);
        const results = [];

        for (const person of matches) {
            try {
                console.log(`[Scheduler] Dispatching birthday wish for ${person.name} to group ${this.config.targetGroupId}...`);
                const res = await waBot.sendBirthdayWishToGroup(this.config.targetGroupId, person);
                results.push({ name: person.name, success: true, res });
                // 3-second delay between multiple messages in group
                await new Promise((r) => setTimeout(r, 3000));
            } catch (err) {
                console.error(`[Scheduler] ⚠️ Failed to send birthday wish for ${person.name}:`, err.message);
                results.push({ name: person.name, success: false, error: err.message });
            }
        }

        this.lastCheckedDate = today;
        return { success: true, count: matches.length, results };
    }

    async addBirthday(entry) {
        const newEntry = {
            id: Date.now().toString(),
            name: entry.name,
            phone: entry.phone || '',
            dob: entry.dob, // Format: MM-DD or YYYY-MM-DD
            customWish: entry.customWish || '',
        };
        this.birthdays.push(newEntry);
        await saveJsonToS3('birthdays.json', this.birthdays, BIRTHDAYS_LOCAL_PATH);
        return newEntry;
    }

    async updateBirthday(id, entry) {
        const index = this.birthdays.findIndex((b) => b.id === id);
        if (index === -1) return null;

        this.birthdays[index] = {
            ...this.birthdays[index],
            ...entry,
        };
        await saveJsonToS3('birthdays.json', this.birthdays, BIRTHDAYS_LOCAL_PATH);
        return this.birthdays[index];
    }

    async deleteBirthday(id) {
        this.birthdays = this.birthdays.filter((b) => b.id !== id);
        await saveJsonToS3('birthdays.json', this.birthdays, BIRTHDAYS_LOCAL_PATH);
        return true;
    }

    async updateConfig(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig,
        };
        await saveJsonToS3('config.json', this.config, CONFIG_LOCAL_PATH);
        this.setupCron();
        return this.config;
    }

    async triggerTestWish(birthdayId) {
        let person = this.birthdays.find((b) => b.id === birthdayId);

        if (!person) {
            // If testing generally, pick first configured birthday or default test person
            if (this.birthdays.length > 0) {
                person = this.birthdays[0];
            } else {
                person = {
                    name: 'Test Celebrant',
                    phone: '',
                    customWish: '🎉🎂 *TEST BIRTHDAY MESSAGE!* 🎂🎉\n\nTesting WhatsApp Group Birthday automation successfully! 🚀🥂',
                };
            }
        }

        if (!this.config.targetGroupId) {
            throw new Error('Target group is not selected. Please choose a target WhatsApp group first.');
        }

        return await waBot.sendBirthdayWishToGroup(this.config.targetGroupId, person);
    }
}

export const scheduler = new BirthdayScheduler();
