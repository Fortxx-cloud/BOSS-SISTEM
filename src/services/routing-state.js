import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const STATE_FILE = path.join(DATA_DIR, 'routing-state.json');
const TEMP_FILE = `${STATE_FILE}.tmp`;

export const RESERVATION_TTL = 600_000;

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) {
            return {
                version: 4,
                affinities: {},
                reservations: {}
            };
        }

        const data = JSON.parse(
            fs.readFileSync(STATE_FILE, 'utf8')
        );

        return {
            version: 4,
            affinities: data.affinities || {},
            reservations: data.reservations || {}
        };
    } catch (error) {
        console.error('[ROUTING] State error:', error.message);
        throw error;
    }
}

const state = loadState();

function persist() {
    fs.writeFileSync(
        TEMP_FILE,
        JSON.stringify(state, null, 2),
        { mode: 0o600 }
    );

    fs.renameSync(TEMP_FILE, STATE_FILE);
}

export function getAffinity(guildId) {
    return state.affinities[guildId] || null;
}

export function getReservation(guildId) {
    const reservation = state.reservations[guildId];

    if (!reservation) return null;

    if (Date.now() >= reservation.expiresAt) {
        delete state.reservations[guildId];
        persist();
        return null;
    }

    return reservation;
}

export function getActiveGuildCount(workerId) {
    return Object.values(state.affinities)
        .filter(item => item.workerId === workerId)
        .length;
}

export function getPendingReservationCount(workerId) {
    const now = Date.now();
    let count = 0;
    let changed = false;

    for (const [guildId, reservation] of Object.entries(
        state.reservations
    )) {
        if (now >= reservation.expiresAt) {
            delete state.reservations[guildId];
            changed = true;
            continue;
        }

        if (reservation.workerId === workerId) {
            count++;
        }
    }

    if (changed) persist();

    return count;
}

export function saveReservation(guildId, workerId, options = {}) {
    const now = Date.now();

    state.reservations[guildId] = {
        workerId,
        mode: options.mode || 'normal',
        previousWorkerId: options.previousWorkerId || null,
        createdAt: now,
        expiresAt: now + RESERVATION_TTL
    };

    persist();

    return state.reservations[guildId];
}

export function renewReservation(guildId) {
    const reservation = getReservation(guildId);

    if (!reservation) return null;

    reservation.expiresAt = Date.now() + RESERVATION_TTL;
    reservation.renewedAt = Date.now();

    persist();

    return reservation;
}

export function cancelReservation(guildId) {
    const reservation = state.reservations[guildId];

    if (!reservation) return false;

    delete state.reservations[guildId];
    persist();

    return true;
}

export function confirmReservation(guildId) {
    const reservation = getReservation(guildId);

    if (!reservation) return null;

    const previous = state.affinities[guildId];

    const affinity = {
        workerId: reservation.workerId,
        previousWorkerId:
            reservation.previousWorkerId || previous?.workerId || null,
        assignedAt: previous?.assignedAt || Date.now(),
        updatedAt: Date.now()
    };

    state.affinities[guildId] = affinity;

    delete state.reservations[guildId];

    persist();

    return affinity;
}

export function releaseGuild(guildId) {
    const hadAffinity = Boolean(state.affinities[guildId]);
    const hadReservation = Boolean(state.reservations[guildId]);

    delete state.affinities[guildId];
    delete state.reservations[guildId];

    if (hadAffinity || hadReservation) persist();

    return hadAffinity || hadReservation;
}

export function getRoutingSnapshot() {
    return {
        version: state.version,
        affinities: { ...state.affinities },
        reservations: { ...state.reservations }
    };
}

export function getRoutingStats() {
    const now = Date.now();

    let active = 0;
    let pending = 0;
    let expired = 0;

    for (const affinity of Object.values(state.affinities)) {
        if (affinity.workerId) active++;
    }

    let changed = false;

    for (const [guildId, reservation] of Object.entries(state.reservations)) {
        if (now >= reservation.expiresAt) {
            delete state.reservations[guildId];
            expired++;
            changed = true;
        } else {
            pending++;
        }
    }

    if (changed) persist();

    return {
        activeGuilds: active,
        pendingReservations: pending,
        expiredReservations: expired
    };
}
