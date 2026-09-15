import {
  DEFAULT_DURATIONS, forceAvailable, getDurations, listMachines, machineLabel,
  parseSlug, seedAll, setDurations, startCycle,
} from './store.js';
import { escapeHtml, formatTime, htmlResponse, layout, minutesLeft } from './views.js';

const SESSION_COOKIE = 'wcu_laundry_admin';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_SECONDS = 900;

const encoder = new TextEncoder();

const MESSAGES = {
  initialized: 'All 12 machine records were reinitialized.',
  durations: 'Cycle durations saved.',
};

export async function handleAdmin(request, env, subPath, url) {
  const base = `/${env.ADMIN_PATH}`;

  if (subPath === 'login' && request.method === 'POST') return handleLogin(request, env, base);
  if (subPath === 'logout' && request.method === 'POST') {
    return redirect(`${base}/`, { 'set-cookie': clearCookie(base) });
  }

  if (!(await hasValidSession(request, env))) {
    if (request.method === 'POST') return redirect(`${base}/`);
    return htmlResponse(loginPage(base));
  }

  if (subPath === '' && request.method === 'GET') {
    return dashboard(env, base, MESSAGES[url.searchParams.get('msg')]);
  }
  if (request.method === 'POST') {
    const form = await safeFormData(request);
    if (subPath === 'machine') return updateMachine(env, base, form);
    if (subPath === 'durations') return updateDurations(env, base, form);
    if (subPath === 'initialize') {
      await seedAll(env);
      return redirect(`${base}/?msg=initialized`);
    }
  }
  return redirect(`${base}/`);
}

// A POST with a missing or malformed body should not throw a 500.
async function safeFormData(request) {
  try {
    return await request.formData();
  } catch {
    return new FormData();
  }
}

/* ---------- session handling ---------- */

async function handleLogin(request, env, base) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rateKey = `rl:login:${ip}`;
  const attempts = Number((await env.LAUNDRY.get(rateKey)) || 0);
  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    return htmlResponse(loginPage(base, 'Too many sign-in attempts. Try again later.'), 429);
  }

  if (!env.ADMIN_PASSWORD) {
    return htmlResponse(loginPage(base, 'The ADMIN_PASSWORD secret is not configured.'), 500);
  }

  const form = await safeFormData(request);
  const supplied = String(form.get('password') || '');

  if (!timingSafeEqual(supplied, env.ADMIN_PASSWORD)) {
    await env.LAUNDRY.put(rateKey, String(attempts + 1), { expirationTtl: LOGIN_WINDOW_SECONDS });
    return htmlResponse(loginPage(base, 'Incorrect password.'), 401);
  }

  await env.LAUNDRY.delete(rateKey);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = `${expiresAt}.${await sign(env, String(expiresAt))}`;
  return redirect(`${base}/`, { 'set-cookie': sessionCookie(base, token) });
}

// The password is never placed in the cookie: the cookie carries an expiry plus
// an HMAC of that expiry, keyed by the admin password.
async function hasValidSession(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature) return false;
  if (!Number(expiresAt) || Number(expiresAt) < Date.now()) return false;
  return timingSafeEqual(signature, await sign(env, expiresAt));
}

async function sign(env, payload) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(env.ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const sessionCookie = (base, token) =>
  `${SESSION_COOKIE}=${token}; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;

const clearCookie = (base) =>
  `${SESSION_COOKIE}=; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

function redirect(location, headers = {}) {
  return new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store', ...headers },
  });
}

/* ---------- actions ---------- */

async function updateMachine(env, base, form) {
  const slug = String(form.get('slug') || '');
  const action = String(form.get('action') || '');
  if (!parseSlug(slug)) return redirect(`${base}/`);

  if (action === 'release') {
    await forceAvailable(env, slug);
  } else if (action === 'busy') {
    await startCycle(env, slug, await getDurations(env));
  }
  return redirect(`${base}/`);
}

async function updateDurations(env, base, form) {
  await setDurations(env, {
    washer: form.get('washer'),
    dryer: form.get('dryer'),
    buffer: form.get('buffer'),
  });
  return redirect(`${base}/?msg=durations`);
}

/* ---------- views ---------- */

function loginPage(base, error) {
  const body = `
<div class="card card-login">
  <h1>Administrator sign-in</h1>
  ${error ? `<p class="alert alert-error">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="${base}/login">
    <label for="password">Shared administrator password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button class="btn btn-primary" type="submit">Sign in</button>
  </form>
</div>`;
  return layout({ title: 'Sign in', eyebrow: 'Laundry Administration', body, admin: true });
}

async function dashboard(env, base, message) {
  const now = Date.now();
  const [machines, durations] = await Promise.all([listMachines(env, now), getDurations(env)]);
  const available = machines.filter((m) => m.status === 'available').length;

  const rows = machines.map((machine) => {
    const busy = machine.status === 'busy';
    return `
    <tr class="${busy ? 'row-busy' : 'row-free'}">
      <th scope="row">${escapeHtml(machineLabel(machine.slug))}</th>
      <td><span class="status-pill ${busy ? 'pill-busy' : 'pill-free'}">${busy ? 'In use' : 'Available'}</span></td>
      <td>${busy ? `${formatTime(machine.busyUntil)} <span class="fine">(${minutesLeft(machine.busyUntil, now)} min)</span>` : '&mdash;'}</td>
      <td class="actions">
        <form method="post" action="${base}/machine">
          <input type="hidden" name="slug" value="${escapeHtml(machine.slug)}">
          <button class="btn btn-small" name="action" value="release"${busy ? '' : ' disabled'}>Release</button>
          <button class="btn btn-small btn-outline" name="action" value="busy">${busy ? 'Restart' : 'Mark in use'}</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  const body = `
${message ? `<p class="alert alert-ok">${escapeHtml(message)}</p>` : ''}
<div class="card">
  <div class="dash-head">
    <h1>Machine status</h1>
    <p class="summary"><strong>${available}</strong> of ${machines.length} available</p>
  </div>
  <div class="table-scroll">
    <table class="status-table">
      <thead><tr><th>Machine</th><th>Status</th><th>Available again</th><th>Manual override</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>

<div class="card card-secondary">
  <h2>Cycle durations</h2>
  <p class="note">Applies to every machine of that type, on the next cycle started. Saved to KV and read at request time &mdash; no redeploy needed.</p>
  <form method="post" action="${base}/durations" class="duration-form">
    <div class="field">
      <label for="washer">Washer (minutes)</label>
      <input id="washer" name="washer" type="number" min="1" max="600" value="${durations.washer}" required>
    </div>
    <div class="field">
      <label for="dryer">Dryer (minutes)</label>
      <input id="dryer" name="dryer" type="number" min="1" max="600" value="${durations.dryer}" required>
    </div>
    <div class="field">
      <label for="buffer">Unload buffer (minutes)</label>
      <input id="buffer" name="buffer" type="number" min="0" max="600" value="${durations.buffer}" required>
    </div>
    <button class="btn btn-primary" type="submit">Save durations</button>
  </form>
  <p class="fine">Defaults: washer ${DEFAULT_DURATIONS.washer} min, dryer ${DEFAULT_DURATIONS.dryer} min, buffer ${DEFAULT_DURATIONS.buffer} min. The buffer is added to both machine types.</p>
</div>

<div class="card card-secondary">
  <h2>Maintenance</h2>
  <form method="post" action="${base}/initialize">
    <button class="btn btn-outline" type="submit">Initialize all 12 machine records</button>
  </form>
  <p class="fine">Writes a fresh <em>available</em> record for every machine. Safe to run at any time, but it clears every running timer.</p>
  <form method="post" action="${base}/logout" class="logout">
    <button class="btn btn-quiet" type="submit">Sign out</button>
  </form>
</div>`;

  return htmlResponse(layout({
    title: 'Laundry administration', eyebrow: 'Laundry Administration', body, admin: true,
  }));
}
