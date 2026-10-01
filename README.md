# Booking-Flow Audit — Lead Magnet

A free, automated "booking-flow scan" for short-let/hotel websites. A visitor
submits their name, email, how they're related to the property, and their
website URL. The server fetches that site, runs a heuristic scan for common
booking-flow problems, and emails them a report. You get a copy of every
submission emailed to you for follow-up.

This is deliberately conservative about what it claims: every check is
labelled **Detected / Not detected / Could not verify automatically**, never
asserted as a certain fact — and the report always says this is a first-pass
automated scan, not a substitute for your manual audit. The report's closing
CTA is what turns a free scan into a lead for your actual service.

## What it checks

- Booking/reservation mechanism (forms, date fields, "book now" language)
- Online payment gateway (Paystack, Flutterwave, Interswitch, Remita, Stripe, PayPal)
- Live availability / calendar widget
- WhatsApp link or clickable phone number
- Mobile viewport tag
- Booking confirmation & payment completion — always marked "could not verify
  automatically," since that requires actually completing a test booking,
  which this tool intentionally does not do (same discipline you've used in
  every manual audit: never assert what wasn't actually tested).

**Known limitation, disclosed in the report itself:** this reads a site's raw
HTML only. A site built as a client-rendered app (React/Vue/Next.js, like the
Crestville case) can look emptier here than it really is — the report flags
this automatically when it detects a bare `<div id="root">`-style shell, and
tells the visitor a manual check is the only way to be sure. This is the same
caveat you already apply by hand; the tool just surfaces it automatically.

## Project layout

```
server.js            Express app + the /api/analyze endpoint
lib/analyze.js        Fetches the target site and runs the heuristic checks
lib/report.js         Builds the two HTML emails (lead report + your notification)
lib/email.js           Sends email via the Resend API
public/index.html      The lead-capture form (the page you'll link to / embed)
test/analyze.test.js   Smoke tests for the heuristics (no real network needed)
.env.example           Every environment variable you need to set, explained
```

## 1. Set up email sending (Resend)

1. Go to <https://resend.com> and create a free account (100 emails/day, 3,000/month on the free tier — plenty to start).
2. Skip domain verification for now — Resend gives you a working sender,
   `onboarding@resend.dev`, that works immediately with zero setup. Use that
   while you test.
3. In the Resend dashboard, go to **API Keys** → **Create API Key**. Copy it —
   you'll only see it once.
4. Later, once this is getting real traffic, go to **Domains** in Resend and
   verify a domain you own (e.g. `tubalcainadsenterprise.com`) so your sender
   address looks like `reports@tubalcainadsenterprise.com` instead of
   `onboarding@resend.dev` — more trustworthy to a prospect opening the email.

## 2. Configure environment variables

Copy `.env.example` to `.env` and fill in:

- `RESEND_API_KEY` — from step 1.
- `FROM_EMAIL` — e.g. `Tubalcain Ads Enterprise <onboarding@resend.dev>` to start.
- `OWNER_EMAIL` — where every lead's details get sent (yours).
- `OWNER_WHATSAPP` — your WhatsApp number in international format, no `+` or spaces (e.g. `2348012345678`), used for the "WhatsApp me" link in the report.
- `OWNER_PORTFOLIO_URL` — your portfolio link.

**Never commit `.env` to a public GitHub repo** — it holds your API key.
`.env` should already be in `.gitignore` before you push.

## 3. Run it locally (optional, to try it yourself first)

```bash
npm install
cp .env.example .env   # then edit .env with your real values
npm start
```

Open <http://localhost:3000> and submit the form with your own email to see
the report land in your inbox.

Run the heuristic smoke tests any time (no network or API key needed):

```bash
node test/analyze.test.js
```

## 4. Deploy it for free (Render.com)

1. Push this project to a GitHub repo (keep `.env` out of it — only commit `.env.example`).
2. Go to <https://render.com>, sign up, and click **New → Web Service**.
3. Connect your GitHub repo.
4. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Under **Environment**, add the same variables from your `.env` file
   (`RESEND_API_KEY`, `FROM_EMAIL`, `OWNER_EMAIL`, `OWNER_WHATSAPP`,
   `OWNER_PORTFOLIO_URL`). Render sets `PORT` automatically — don't set it
   yourself.
6. Deploy. Render gives you a live URL like
   `https://booking-audit-leadmagnet.onrender.com` — that's your lead magnet
   page, ready to link from your LinkedIn posts, WhatsApp signature, or
   portfolio site.

**Free-tier note:** Render's free web services sleep after inactivity and
take ~30–50 seconds to wake up on the next visit. Fine for a lead magnet with
moderate traffic; if that becomes a problem once this is driving real volume,
upgrading to Render's cheapest paid tier removes the sleep entirely.

## 5. Point people at it

Link `https://your-app.onrender.com` from:
- Your LinkedIn posts and profile
- Your WhatsApp Business "About" / auto-reply
- Your portfolio site (tubalcainmy.github.io/alajayibomystery)
- The sign-off of your cold outreach, as a lower-friction alternative to "worth fixing?" — some prospects would rather self-serve a report than reply to a stranger

## What I could not test from this sandbox

This environment's outbound network only reaches package registries and
GitHub — it can't fetch arbitrary live websites or call the real Resend API.
I verified:
- The server starts, serves the form, and validates input correctly.
- The heuristic analyzer correctly detects/flags all check categories
  against realistic mock HTML (4 automated test cases, all passing).
- The SSRF guard correctly blocks private/internal hosts.
- The real network-fetch code path runs end-to-end and fails gracefully
  when the sandbox's proxy blocks the request (confirms no crash, clean
  error message).

What I could **not** verify directly: an actual email arriving via Resend,
and the analyzer's behavior against a real, live hotel/short-let website.
Test both yourself once you've set your Resend API key — submit the form
with your own email and a real property site you already know well, and
check the report matches what you'd expect.
