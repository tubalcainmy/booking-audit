// lib/analyze.js
//
// Fetches a prospect's website server-side (so we don't hit browser CORS
// restrictions) and runs a set of heuristic, pattern-based checks against
// the raw HTML. This is deliberately conservative: every finding is labelled
// "Detected" / "Not detected" / "Could not verify" rather than asserted as
// certain, because a static HTML fetch cannot execute JavaScript — a site
// built in React/Vue/Next.js (client-rendered) may show incomplete results
// here even when it has a working booking flow. The report always discloses
// this limitation rather than overclaiming.

const dns = require("dns").promises;
const net = require("net");

const FETCH_TIMEOUT_MS = 9000;
const MAX_BODY_BYTES = 3 * 1024 * 1024; // 3MB cap, plenty for an HTML document

/**
 * Basic SSRF guard: reject localhost, loopback, link-local, and private
 * IP ranges so this public form can't be used to probe internal networks.
 */
async function assertPublicHostname(hostname) {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0"
  ) {
    throw new Error("That host isn't allowed.");
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error("Could not resolve that domain.");
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) {
      throw new Error("That host isn't allowed.");
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new Error("That host isn't allowed.");
    }
  }
}

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  );
}

function normalizeUrl(input) {
  let value = String(input || "").trim();
  if (!value) throw new Error("Please enter a website URL.");
  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http/https URLs are supported.");
  }
  if (net.isIP(url.hostname)) {
    throw new Error("Please enter a domain name, not a raw IP address.");
  }
  return url;
}

async function fetchHtml(url) {
  await assertPublicHostname(url.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TubalcainBookingAudit/1.0; +https://tubalcainmy.github.io/alajayibomystery/)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      throw new Error(`The site responded with HTTP ${res.status}.`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType && !contentType.includes("html")) {
      throw new Error("That URL didn't return an HTML page.");
    }

    // Read with a size cap so a huge or malicious response can't exhaust memory.
    const reader = res.body.getReader();
    let received = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_BODY_BYTES) {
        controller.abort();
        break;
      }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString(
      "utf-8"
    );
    return { html, finalUrl: res.url || url.toString() };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The site took too long to respond.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---- Heuristic signatures ----

const BOOKING_SIGNALS = [
  /check[\s-]?in/i,
  /check[\s-]?out/i,
  /book\s*now/i,
  /reserve\s*now/i,
  /check\s*availability/i,
  /add\s*to\s*cart/i,
  /type=["']date["']/i,
  /yith[-_]wcbk/i,
  /hotel[-_]booking/i,
  /wp-hotel-booking/i,
  /booking-?engine/i,
  /reservation/i,
];

const PAYMENT_SIGNALS = [
  { name: "Paystack", pattern: /paystack/i },
  { name: "Flutterwave", pattern: /flutterwave|flutterwavecheckout/i },
  { name: "Interswitch", pattern: /interswitch/i },
  { name: "Remita", pattern: /remita/i },
  { name: "Stripe", pattern: /stripe\.com|stripe\.js/i },
  { name: "PayPal", pattern: /paypal\.com\/sdk|paypalobjects/i },
];

const CALENDAR_SIGNALS = [
  /fullcalendar/i,
  /flatpickr/i,
  /air-?datepicker/i,
  /datepicker/i,
  /yith[-_]wcbk/i,
  /hotel[-_]booking/i,
];

const WHATSAPP_SIGNALS = [/wa\.me\//i, /api\.whatsapp\.com/i, /whatsapp/i];

const PHONE_SIGNAL = /tel:\+?[\d\-\s()]{7,}/i;

function findAny(html, patterns) {
  return patterns.some((p) => p.test(html));
}

function detectPaymentGateways(html) {
  const found = PAYMENT_SIGNALS.filter((p) => p.pattern.test(html)).map(
    (p) => p.name
  );
  return found;
}

function hasViewportMeta(html) {
  return /<meta[^>]+name=["']viewport["']/i.test(html);
}

/**
 * Runs the full heuristic check suite and returns a structured result.
 * Every item has: { key, label, status: 'detected'|'not_detected'|'unverified', note }
 */
async function analyzeWebsite(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const { html, finalUrl } = await fetchHtml(url);

  const likelyJsRendered =
    html.length < 2000 &&
    /<div\s+id=["'](root|app|__next)["']/i.test(html);

  const checks = [];

  checks.push({
    key: "booking_mechanism",
    label: "Booking or reservation mechanism",
    status: findAny(html, BOOKING_SIGNALS) ? "detected" : "not_detected",
    note: findAny(html, BOOKING_SIGNALS)
      ? "Found booking-related form fields or keywords (dates, 'book now', 'check availability', etc.) in the page."
      : "No booking form, date-selection field, or 'book now' / 'check availability' language was found on the page that was scanned.",
  });

  const gateways = detectPaymentGateways(html);
  checks.push({
    key: "payment_gateway",
    label: "Online payment gateway",
    status: gateways.length ? "detected" : "not_detected",
    note: gateways.length
      ? `Found references to: ${gateways.join(", ")}.`
      : "No references to Paystack, Flutterwave, Interswitch, Remita, Stripe, or PayPal were found. This usually means payment happens off-site (bank transfer, WhatsApp, or on arrival) rather than through an online checkout.",
  });

  checks.push({
    key: "availability_calendar",
    label: "Live availability / calendar widget",
    status: findAny(html, CALENDAR_SIGNALS) ? "detected" : "not_detected",
    note: findAny(html, CALENDAR_SIGNALS)
      ? "Found a date-picker or calendar-style booking widget on the page."
      : "No date-picker or calendar widget was detected. Guests may not be able to see real-time room/unit availability before contacting you.",
  });

  checks.push({
    key: "whatsapp_contact",
    label: "WhatsApp / direct contact fallback",
    status:
      findAny(html, WHATSAPP_SIGNALS) || PHONE_SIGNAL.test(html)
        ? "detected"
        : "not_detected",
    note:
      findAny(html, WHATSAPP_SIGNALS) || PHONE_SIGNAL.test(html)
        ? "Found a WhatsApp link or a clickable phone number for guests who want to book or ask questions directly."
        : "No WhatsApp link or clickable phone number was found. If the booking flow fails, visitors may have no easy fallback.",
  });

  checks.push({
    key: "mobile_ready",
    label: "Mobile-friendly setup",
    status: hasViewportMeta(html) ? "detected" : "not_detected",
    note: hasViewportMeta(html)
      ? "The page declares a mobile viewport, which is a basic requirement for displaying correctly on phones."
      : "No mobile viewport tag was found — the page may not display correctly on phones, where most booking traffic comes from.",
  });

  // We deliberately never claim to have tested the actual payment/confirmation
  // flow end-to-end — that requires submitting a real booking, which this
  // automated scanner does not do.
  checks.push({
    key: "confirmation_flow",
    label: "Booking confirmation & payment completion",
    status: "unverified",
    note: "This requires actually completing a test booking, which this automated scan does not do. A manual walkthrough is the only reliable way to confirm guests reach a real confirmation after paying.",
  });

  return {
    url: url.toString(),
    finalUrl,
    likelyJsRendered,
    checks,
  };
}

module.exports = { analyzeWebsite, normalizeUrl };
