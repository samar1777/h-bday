// In-memory circular log store for live Activity Logs
const MAX_LOGS = 500;
const logsStore = [];
let nextLogId = 1;

/**
 * Parses log category and level from message text
 */
function parseCategoryAndLevel(message, defaultLevel = 'info') {
    let category = 'system';
    let level = defaultLevel;

    const lower = message.toLowerCase();

    if (lower.includes('[scheduler]') || lower.includes('cron') || lower.includes('checking birthday')) {
        category = 'scheduler';
    } else if (lower.includes('[whatsapp]') || lower.includes('baileys') || lower.includes('pairing') || lower.includes('group')) {
        category = 'whatsapp';
    } else if (lower.includes('[filebase]') || lower.includes('s3') || lower.includes('cloud')) {
        category = 'cloud';
    } else if (lower.includes('[auth]') || lower.includes('login') || lower.includes('token')) {
        category = 'auth';
    } else if (lower.includes('birthday') || lower.includes('wish') || lower.includes('celebrant')) {
        category = 'birthday';
    }

    if (lower.includes('✓') || lower.includes('success') || lower.includes('connected') || lower.includes('restored') || lower.includes('dispatched')) {
        level = 'success';
    } else if (lower.includes('⚠️') || lower.includes('warn') || lower.includes('skipping') || lower.includes('paused')) {
        level = 'warn';
    } else if (lower.includes('error') || lower.includes('failed') || lower.includes('fatal') || lower.includes('rejected')) {
        level = 'error';
    }

    return { category, level };
}

/**
 * Adds an entry to the log store
 */
export function addLog(entry) {
    const now = new Date();
    const parsed = parseCategoryAndLevel(entry.message || '', entry.level || 'info');

    const logItem = {
        id: nextLogId++,
        timestamp: now.toISOString(),
        timeStr: now.toLocaleTimeString('en-US', { hour12: false }),
        dateStr: now.toISOString().slice(0, 10),
        category: entry.category || parsed.category,
        level: entry.level || parsed.level,
        message: entry.message || '',
        details: entry.details || null,
    };

    logsStore.unshift(logItem); // Newest first

    if (logsStore.length > MAX_LOGS) {
        logsStore.pop();
    }

    return logItem;
}

/**
 * Returns filtered logs
 */
export function getLogs({ category = null, level = null, search = '', limit = 100 } = {}) {
    let filtered = logsStore;

    if (category && category !== 'all') {
        filtered = filtered.filter(l => l.category === category);
    }

    if (level && level !== 'all') {
        filtered = filtered.filter(l => l.level === level);
    }

    if (search && search.trim()) {
        const query = search.toLowerCase().trim();
        filtered = filtered.filter(l => 
            l.message.toLowerCase().includes(query) ||
            l.category.toLowerCase().includes(query) ||
            l.timeStr.toLowerCase().includes(query)
        );
    }

    return filtered.slice(0, parseInt(limit, 10) || 100);
}

/**
 * Clears in-memory logs
 */
export function clearLogs() {
    logsStore.length = 0;
    addLog({
        category: 'system',
        level: 'info',
        message: '[System] Logs cleared by admin.',
    });
    return true;
}

/**
 * Installs interceptors on console.log, console.warn, console.error
 * so all existing application logs are automatically captured.
 */
export function initLogger() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;

    console.log = function (...args) {
        originalLog.apply(console, args);
        try {
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            addLog({ message: msg, level: 'info' });
        } catch {}
    };

    console.info = function (...args) {
        originalInfo.apply(console, args);
        try {
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            addLog({ message: msg, level: 'info' });
        } catch {}
    };

    console.warn = function (...args) {
        originalWarn.apply(console, args);
        try {
            const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            addLog({ message: msg, level: 'warn' });
        } catch {}
    };

    console.error = function (...args) {
        originalError.apply(console, args);
        try {
            const msg = args.map(a => (typeof a === 'object' ? (a.message || JSON.stringify(a)) : String(a))).join(' ');
            addLog({ message: msg, level: 'error' });
        } catch {}
    };

    // Initial system boot log
    addLog({
        category: 'system',
        level: 'info',
        message: '[System] Activity Logger initialized successfully.',
    });
}
