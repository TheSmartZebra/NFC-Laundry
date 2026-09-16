# WCU Residential Laundry Status

A shared, real-time laundry status board for a Western Carolina University residence hall, running on
Cloudflare Workers + KV. Every washer and dryer gets an NFC tag / QR code pointing at its own URL.
Tapping the tag starts a cycle; anyone else who taps it sees when the machine will be free again.

- 12 fixed machines: `washer-1` … `washer-6`, `dryer-1` … `dryer-6`
- Washer = 30 min, dryer = 45 min, both + a 5 min unload buffer (defaults, adjustable from the admin page)
- No accounts, no login, no app to install on the public pages
- No cron job: a busy machine becomes available lazily, the next time its status is read

**Live:** <https://wcu-laundry.wculaundry.workers.dev>

### Setup checklist

Each step is detailed below.

- [ ] `npm install`, then `npx wrangler login`  (§2.1)
- [ ] Create the KV namespace, paste its id into `wrangler.toml`  (§2.2)
- [ ] Set the `ADMIN_PATH` and `ADMIN_PASSWORD` secrets  (§2.3)
- [ ] `npx wrangler deploy`, note the URL it prints  (§2.4)
- [ ] Open the admin page, press **Initialize all 12 machine records**  (§3)
- [ ] Add the two GitHub repo secrets so pushes auto-deploy  (§4)
- [ ] Generate and print the QR tags, write the NFC stickers  (§5)

---

## 1. Machine links

Each machine's tag should point at:

```
https://wcu-laundry.wculaundry.workers.dev/m/washer-1
https://wcu-laundry.wculaundry.workers.dev/m/washer-2
...
https://wcu-laundry.wculaundry.workers.dev/m/dryer-6
```

What happens on a tap:

| Machine state | Result |
| --- | --- |
| Available | Immediately marked in use, timer started, page shows **"Washer 3 — available again at 2:52 PM"** |
| In use | Status page with the available-again time, plus a **"This machine is actually free"** override |

The override shows a confirm step (*"Are you sure? This will start a new cycle."*) before it frees the
machine and immediately starts a fresh cycle under the new user.

---

## 2. Cloudflare setup

### 2.1 Account

1. Create a free account at <https://dash.cloudflare.com/sign-up> (the free Workers plan is plenty here).
2. Install dependencies locally and sign in:

```bash
npm install
npx wrangler login
```

### 2.2 KV namespace

```bash
npx wrangler kv namespace create LAUNDRY
```

Copy the `id` it prints into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`:

```toml
[[kv_namespaces]]
binding = "LAUNDRY"
id = "a1b2c3..."          # <- the id from the command above
```

### 2.3 Admin secrets

The admin URL and password are both Worker **secrets**. Neither is committed — this is a public
repo, and a `[vars]` entry in `wrangler.toml` would publish the admin URL to anyone who looks.
Secrets are stored encrypted by Cloudflare and survive redeploys.

Generate the two values:

```bash
node -e "console.log('ADMIN_PATH     svc-'+require('crypto').randomBytes(12).toString('hex'))"
node -e "console.log('ADMIN_PASSWORD '+require('crypto').randomBytes(18).toString('base64url'))"
```

Save both somewhere safe (a password manager), then set them:

```bash
npx wrangler secret put ADMIN_PATH
npx wrangler secret put ADMIN_PASSWORD
```

Notes:

- If `ADMIN_PATH` is not set, the admin page does not exist at all — every URL 404s. That is the
  safe default, not a bug.
- Changing `ADMIN_PASSWORD` invalidates every existing admin session, because session cookies are
  signed with it.

### 2.4 First deploy

```bash
npx wrangler deploy
```

Then open the admin page and press **Initialize all 12 machine records** (see below). Seeding is
optional — a machine that has no KV record yet is treated as available and written on first visit —
but it gives you a clean, complete starting state.

---

## 3. Admin page

The admin page lives at an unguessable, randomly generated path — whatever you set `ADMIN_PATH` to
in step 2.3:

```
https://wcu-laundry.wculaundry.workers.dev/<your-ADMIN_PATH>/
```

It is not linked from any public page, is excluded from crawlers via `noindex, nofollow`, and there
is no sitemap. The path is deliberately not recorded anywhere in this repo; if you lose it, read it
back from the Cloudflare dashboard (Workers & Pages → wcu-laundry → Settings → Variables) or just
set a new one.

**Sign in** with the `ADMIN_PASSWORD` secret. On success the Worker sets an `HttpOnly; Secure;
SameSite=Strict` cookie holding an expiry plus an HMAC of that expiry keyed by the password — the
password itself is sent once, at sign-in, and never again. Sessions last 8 hours.

From the dashboard you can:

- See all 12 machines, available/in use, with the available-again time and minutes remaining
- **Release** a machine early, or **Mark in use** / **Restart** its timer
- Change the washer duration, dryer duration and unload buffer (stored in KV, read at request time,
  so the change is live with no redeploy)
- **Initialize all 12 machine records** — writes a fresh `available` record for every machine

### Rotating the admin URL

```bash
node -e "console.log('svc-'+require('crypto').randomBytes(12).toString('hex'))"
npx wrangler secret put ADMIN_PATH
```

Takes effect immediately, no redeploy needed.

---

## 4. GitHub Actions deploys

`.github/workflows/deploy.yml` runs `wrangler deploy` on every push to `main`. It needs two repo
secrets (**Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Overview (right-hand sidebar), or `npx wrangler whoami` |

`ADMIN_PATH` and `ADMIN_PASSWORD` are **not** GitHub secrets — they live only in Cloudflare and
survive redeploys. GitHub Actions never needs to see them.

---

## 5. QR codes and NFC tags

Open `tools/tags.html` in any browser (double-click it — no server needed), paste the URL from
`wrangler deploy`, and press **Generate**. You get:

- A printable sheet of 12 QR cards, one per machine, cut lines included
- The 12 URLs in a table, ready to write to NFC stickers

Everything runs locally in the page; nothing is uploaded. It pulls a QR library from cdnjs, so you
need a connection the first time you use it.

For the NFC stickers: NTAG213 or better, any writer app (NFC Tools is fine), write each machine's
URL as a **URL/URI record**, then lock the tag read-only so nobody can rewrite it. Put the printed
QR card beside the sticker — it covers phones without NFC and people who would rather scan.

---

## 6. Local development

```bash
npm run dev
```

`wrangler dev` uses a local KV simulation, so you can tap through the flows without touching
production data. For the admin page locally, copy the example file:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` is gitignored. Use throwaway values there — it is not where production secrets live.

---

## 7. Repo layout

```
src/index.js      Router: machine pages, admin routes, 404
src/store.js      KV state — machine records, lazy expiry, durations
src/views.js      Public HTML (WCU-styled layout, start/busy/confirm pages)
src/admin.js      Admin auth, dashboard and actions
public/styles.css Static stylesheet, served directly from ./public
tools/tags.html   Offline QR tag sheet + NFC URL list generator
wrangler.toml     Worker config, KV binding (no secrets)
.github/workflows/deploy.yml
```

### Data model

One KV record per machine, keyed `machine:<slug>`:

```json
{ "slug": "washer-3", "type": "washer", "status": "available", "busyUntil": null }
```

Durations live in a single record, `config:durations`:

```json
{ "washer": 30, "dryer": 45, "buffer": 5 }
```

### Lazy expiry

Nothing runs on a schedule. Every read of a machine compares `busyUntil` to the current time; if it
has passed, the record is flipped to `available` and written back before any other logic runs.

---

## 8. Known limitations

- **Trust-based.** Anyone with the link can start or free a machine. That is the intended trade-off
  for a no-login dorm utility.
- **Tapping a tag starts a cycle immediately** (a `GET` with a side effect) — that is what makes the
  NFC tap a single action. A browser that aggressively prefetches the link could start a cycle
  without the user meaning to; responses are sent `no-store` to limit this.
- **KV is eventually consistent.** Two people tapping the same tag within a second of each other can
  both see it as available. At one residence hall's scale this is very unlikely, and the loser simply
  overwrites the timer.
- Times are displayed in `America/New_York`.
