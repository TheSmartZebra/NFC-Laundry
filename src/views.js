import { machineLabel } from './store.js';

const TIMEZONE = 'America/New_York';

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit',
  });
}

export function minutesLeft(busyUntil, now = Date.now()) {
  return Math.max(0, Math.ceil((busyUntil - now) / 60_000));
}

export function layout({ title, eyebrow, body, admin = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#492A76">
<title>${escapeHtml(title)} | WCU Residential Laundry</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="wordmark" href="/">
      <span class="wordmark-mark">WCU</span>
      <span class="wordmark-text">Western Carolina University</span>
    </a>
    <p class="unit">${admin ? 'Laundry Administration' : 'Housing &amp; Residence Life'}</p>
  </div>
</header>
<nav class="subnav"><div class="wrap">${escapeHtml(eyebrow || 'Residential Laundry Status')}</div></nav>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p><strong>Western Carolina University</strong> &middot; Housing &amp; Residence Life</p>
    <p class="fine">Laundry status is reported by residents tapping the tag on each machine. Times are estimates and are shown in Eastern Time.</p>
  </div>
</footer>
</body>
</html>`;
}

export function htmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

// Shown right after a resident starts a cycle.
export function startedPage(machine) {
  const label = machineLabel(machine.slug);
  const body = `
<div class="card card-started">
  <p class="status-pill pill-started">Cycle started</p>
  <h1>${escapeHtml(label)}</h1>
  <p class="headline">Available again at <strong>${formatTime(machine.busyUntil)}</strong></p>
  ${countdown(machine.busyUntil)}
  <p class="note">Thanks &mdash; this machine now shows as in use for everyone else. Please collect your laundry promptly so the next resident can start.</p>
</div>
<p class="rescan">Tap the tag on this machine again at any time to check its status.</p>`;
  return layout({ title: label, eyebrow: `${escapeHtml(label)} — Cycle started`, body });
}

// Shown when someone scans a machine that is already running.
export function busyPage(machine) {
  const label = machineLabel(machine.slug);
  const body = `
<div class="card card-busy">
  <p class="status-pill pill-busy">Currently in use</p>
  <h1>${escapeHtml(label)}</h1>
  <p class="headline">Available again at <strong>${formatTime(machine.busyUntil)}</strong></p>
  ${countdown(machine.busyUntil)}
  <p class="note">Someone started a cycle on this machine. Check back at the time above.</p>
</div>
<div class="card card-secondary">
  <h2>Is this machine actually free?</h2>
  <p>If the machine is empty and sitting idle, the status may be out of date &mdash; a duplicate tap or a bumped tag can leave it marked in use.</p>
  <a class="btn btn-outline" href="/m/${encodeURIComponent(machine.slug)}?free=1">This machine is actually free</a>
</div>`;
  return layout({ title: label, eyebrow: `${escapeHtml(label)} — In use`, body });
}

// Lightweight confirm step before overriding a busy machine.
export function confirmFreePage(machine) {
  const label = machineLabel(machine.slug);
  const body = `
<div class="card card-confirm">
  <h1>Are you sure?</h1>
  <p class="headline">This will start a new cycle on ${escapeHtml(label)}.</p>
  <p class="note">Only do this if the machine is genuinely empty and not running. The current timer (available again at ${formatTime(machine.busyUntil)}) will be replaced with a new one starting now.</p>
  <form method="post" action="/m/${encodeURIComponent(machine.slug)}/restart">
    <button class="btn btn-primary" type="submit">Yes, start a new cycle</button>
  </form>
  <a class="btn btn-quiet" href="/m/${encodeURIComponent(machine.slug)}">No, go back</a>
</div>`;
  return layout({ title: label, eyebrow: `${escapeHtml(label)} — Confirm`, body });
}

export function landingPage(durations) {
  const body = `
<div class="card">
  <h1>Residential Laundry Status</h1>
  <p class="headline">Tap the tag on a machine to start or check a cycle.</p>
  <p class="note">Each washer and dryer in the laundry room has its own tag and QR code. Tapping it with your phone marks the machine in use and shows everyone else when it will be free again. There is nothing to install and no login.</p>
</div>
<div class="card card-secondary">
  <h2>Standard cycle times</h2>
  <ul class="plain-list">
    <li><strong>Washers</strong> &mdash; ${durations.washer} minutes</li>
    <li><strong>Dryers</strong> &mdash; ${durations.dryer} minutes</li>
  </ul>
  <p class="fine">A short grace period is added to each cycle so there is time to unload.</p>
</div>`;
  return layout({ title: 'Laundry Status', eyebrow: 'Residential Laundry Status', body });
}

export function notFoundPage() {
  const body = `
<div class="card">
  <h1>Page not found</h1>
  <p class="headline">That laundry machine link isn&rsquo;t recognized.</p>
  <p class="note">Check that you tapped the tag on the machine itself. If the tag is damaged or missing, report it to your Residence Director.</p>
  <a class="btn btn-primary" href="/">Back to laundry status</a>
</div>`;
  return layout({ title: 'Not found', eyebrow: 'Residential Laundry Status', body });
}

function countdown(busyUntil) {
  const left = minutesLeft(busyUntil);
  return `<p class="countdown" data-until="${busyUntil}">about ${left} ${left === 1 ? 'minute' : 'minutes'} remaining</p>
<script>
(function () {
  var el = document.querySelector('.countdown');
  if (!el) return;
  var until = Number(el.dataset.until);
  function tick() {
    var left = Math.max(0, Math.ceil((until - Date.now()) / 60000));
    if (left <= 0) {
      el.textContent = 'This machine should be free now — reload to confirm.';
      clearInterval(timer);
      return;
    }
    el.textContent = 'about ' + left + (left === 1 ? ' minute remaining' : ' minutes remaining');
  }
  var timer = setInterval(tick, 15000);
  tick();
})();
</script>`;
}
