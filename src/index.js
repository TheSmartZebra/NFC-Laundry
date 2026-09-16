import { handleAdmin } from './admin.js';
import { getDurations, getMachine, listMachines, parseSlug, startCycle } from './store.js';
import {
  busyPage, confirmFreePage, htmlResponse, landingPage, notFoundPage, startedPage,
} from './views.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      const now = Date.now();
      const [durations, machines] = await Promise.all([getDurations(env), listMachines(env, now)]);
      return htmlResponse(landingPage(durations, machines, now));
    }

    if (env.ADMIN_PATH && segments[0] === env.ADMIN_PATH) {
      return handleAdmin(request, env, segments.slice(1).join('/'), url);
    }

    if (segments[0] === 'm' && segments.length >= 2) {
      return handleMachine(request, env, url, segments[1], segments[2]);
    }

    return htmlResponse(notFoundPage(), 404);
  },
};

async function handleMachine(request, env, url, slug, action) {
  if (!parseSlug(slug)) return htmlResponse(notFoundPage(), 404);

  // Confirmed override: force the machine free, then run the normal start flow.
  if (action === 'restart') {
    if (request.method !== 'POST') return seeOther(`/m/${slug}`);
    const machine = await startCycle(env, slug, await getDurations(env));
    return htmlResponse(startedPage(machine));
  }

  if (action || request.method !== 'GET') return htmlResponse(notFoundPage(), 404);

  // getMachine applies lazy expiry: a machine whose busyUntil has passed comes
  // back as available (and is written back to KV) before we decide anything.
  const machine = await getMachine(env, slug);

  if (machine.status === 'busy') {
    return htmlResponse(url.searchParams.get('free') ? confirmFreePage(machine) : busyPage(machine));
  }

  const started = await startCycle(env, slug, await getDurations(env));
  return htmlResponse(startedPage(started));
}

function seeOther(location) {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
}
