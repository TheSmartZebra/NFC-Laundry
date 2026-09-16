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

export function layout({ title, eyebrow, body, admin = false, script = '' }) {
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
${script}
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
  return layout({ title: label, eyebrow: `${escapeHtml(label)} — Cycle started`, body, script: countdownScript() });
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
  return layout({ title: label, eyebrow: `${escapeHtml(label)} — In use`, body, script: countdownScript() });
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

export function landingPage(durations, machines, now = Date.now()) {
  const washers = machines.filter((m) => m.type === 'washer');
  const dryers = machines.filter((m) => m.type === 'dryer');
  const freeWashers = washers.filter((m) => m.status === 'available').length;
  const freeDryers = dryers.filter((m) => m.status === 'available').length;

  const body = `
<div class="card card-board">
  <div class="dash-head">
    <h1>Laundry Status</h1>
    <p class="updated">Updated ${formatTime(now)} &middot; <a href="/">refresh</a></p>
  </div>

  <div class="tallies">
    <p class="tally"><strong>${freeWashers}</strong> of ${washers.length} washers free</p>
    <p class="tally"><strong>${freeDryers}</strong> of ${dryers.length} dryers free</p>
  </div>

  <h2 class="group-heading">Washers</h2>
  <div class="tiles">${washers.map((m) => tile(m, now)).join('')}</div>

  <h2 class="group-heading">Dryers</h2>
  <div class="tiles">${dryers.map((m) => tile(m, now)).join('')}</div>

  <p class="fine board-note">Status comes from residents tapping the tag on each machine, so it can
  be wrong if someone forgets. To start a cycle, tap the tag on the machine itself &mdash; there is
  nothing to start from this page.</p>
</div>

<div class="card card-secondary">
  <h2>Standard cycle times</h2>
  <ul class="plain-list">
    <li><strong>Washers</strong> &mdash; ${durations.washer} minutes</li>
    <li><strong>Dryers</strong> &mdash; ${durations.dryer} minutes</li>
  </ul>
  <p class="fine">A ${durations.buffer}-minute grace period is added to each cycle so there is time to unload.</p>
</div>`;

  return layout({
    title: 'Laundry Status',
    eyebrow: 'Residential Laundry Status',
    body,
    script: countdownScript({ reloadSeconds: 60 }),
  });
}

// One machine on the status board. Deliberately not a link: visiting a machine
// URL starts a cycle, so the board reports status and nothing more.
function tile(machine, now) {
  const label = escapeHtml(machineLabel(machine.slug));
  if (machine.status !== 'busy') {
    return `
    <div class="tile tile-free">
      <p class="tile-name">${label}</p>
      <p class="tile-state">Available</p>
    </div>`;
  }
  const left = minutesLeft(machine.busyUntil, now);
  return `
    <div class="tile tile-busy">
      <p class="tile-name">${label}</p>
      <p class="tile-state">In use</p>
      <p class="tile-until">free at ${formatTime(machine.busyUntil)}</p>
      <p class="tile-left" data-until="${machine.busyUntil}" data-format="short">${left} min</p>
    </div>`;
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
  return `<p class="countdown" data-until="${busyUntil}" data-format="long">about ${left} ${left === 1 ? 'minute' : 'minutes'} remaining</p>`;
}

// Drives every [data-until] element on the page, so one copy serves both the
// single-machine countdown and the many tiles on the status board.
function countdownScript({ reloadSeconds = 0 } = {}) {
  return `<script>
(function () {
  var nodes = document.querySelectorAll('[data-until]');
  if (!nodes.length) return;

  function tick() {
    var stale = false;
    nodes.forEach(function (el) {
      var left = Math.max(0, Math.ceil((Number(el.dataset.until) - Date.now()) / 60000));
      if (el.dataset.format === 'short') {
        el.textContent = left > 0 ? left + ' min' : 'any moment';
      } else if (left > 0) {
        el.textContent = 'about ' + left + (left === 1 ? ' minute remaining' : ' minutes remaining');
      } else {
        el.textContent = 'This machine should be free now — reload to confirm.';
      }
      if (left <= 0) stale = true;
    });
    if (stale) clearInterval(timer);
  }

  var timer = setInterval(tick, 15000);
  tick();
  ${reloadSeconds ? `setTimeout(function () { location.reload(); }, ${reloadSeconds * 1000});` : ''}
})();
</script>`;
}
