// KV-backed machine state. One record per machine, keyed by slug.
// Expiry is lazy: nothing runs on a schedule, we compare against busyUntil on read.

export const MACHINE_TYPES = {
  washer: { label: 'Washer', count: 6, defaultMinutes: 30 },
  dryer: { label: 'Dryer', count: 6, defaultMinutes: 45 },
};

export const DEFAULT_DURATIONS = { washer: 30, dryer: 45, buffer: 5 };

const DURATIONS_KEY = 'config:durations';
const machineKey = (slug) => `machine:${slug}`;

export function allSlugs() {
  const slugs = [];
  for (const [type, cfg] of Object.entries(MACHINE_TYPES)) {
    for (let i = 1; i <= cfg.count; i++) slugs.push(`${type}-${i}`);
  }
  return slugs;
}

export function parseSlug(slug) {
  const match = /^(washer|dryer)-([1-6])$/.exec(slug || '');
  if (!match) return null;
  const [, type, number] = match;
  if (Number(number) > MACHINE_TYPES[type].count) return null;
  return { type, number: Number(number) };
}

export function machineLabel(slug) {
  const parsed = parseSlug(slug);
  return parsed ? `${MACHINE_TYPES[parsed.type].label} ${parsed.number}` : slug;
}

export async function getDurations(env) {
  const stored = await env.LAUNDRY.get(DURATIONS_KEY, 'json');
  return { ...DEFAULT_DURATIONS, ...(stored || {}) };
}

export async function setDurations(env, durations) {
  const clean = {
    washer: clampMinutes(durations.washer, DEFAULT_DURATIONS.washer),
    dryer: clampMinutes(durations.dryer, DEFAULT_DURATIONS.dryer),
    buffer: clampMinutes(durations.buffer, DEFAULT_DURATIONS.buffer, 0),
  };
  await env.LAUNDRY.put(DURATIONS_KEY, JSON.stringify(clean));
  return clean;
}

function clampMinutes(value, fallback, min = 1) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(600, Math.max(min, n));
}

function blankMachine(slug) {
  const { type } = parseSlug(slug);
  return { slug, type, status: 'available', busyUntil: null };
}

// Reads a machine and applies lazy expiry, persisting the flip back to KV if it
// had silently expired since the last visit.
export async function getMachine(env, slug, now = Date.now()) {
  const stored = await env.LAUNDRY.get(machineKey(slug), 'json');
  let machine = stored && stored.slug === slug ? stored : blankMachine(slug);

  if (machine.status === 'busy' && (!machine.busyUntil || machine.busyUntil <= now)) {
    machine = { ...machine, status: 'available', busyUntil: null };
    await putMachine(env, machine);
  } else if (!stored) {
    await putMachine(env, machine);
  }
  return machine;
}

export async function listMachines(env, now = Date.now()) {
  return Promise.all(allSlugs().map((slug) => getMachine(env, slug, now)));
}

async function putMachine(env, machine) {
  await env.LAUNDRY.put(machineKey(machine.slug), JSON.stringify(machine));
  return machine;
}

// Marks a machine busy for (type duration + buffer) and returns the new record.
export async function startCycle(env, slug, durations, now = Date.now()) {
  const { type } = parseSlug(slug);
  const totalMinutes = durations[type] + durations.buffer;
  return putMachine(env, {
    slug,
    type,
    status: 'busy',
    busyUntil: now + totalMinutes * 60_000,
  });
}

export async function forceAvailable(env, slug) {
  const { type } = parseSlug(slug);
  return putMachine(env, { slug, type, status: 'available', busyUntil: null });
}

export async function seedAll(env) {
  await Promise.all(allSlugs().map((slug) => putMachine(env, blankMachine(slug))));
  return allSlugs().length;
}
