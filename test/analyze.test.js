// Quick manual smoke test for the heuristic analyzer — stubs global fetch
// with fixture HTML so we can verify the detection logic without making a
// real network request (outbound fetches to arbitrary sites aren't available
// in this sandbox).

const assert = require("assert");
const dns = require("dns").promises;

// Stub DNS lookup so the SSRF guard sees a "public" address for our fake host.
dns.lookup = async () => [{ address: "93.184.216.34", family: 4 }];

const GOOD_SITE_HTML = `
<!doctype html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
  <form id="booking">
    <label>Check-in</label><input type="date" name="checkin">
    <label>Check-out</label><input type="date" name="checkout">
    <button>Check Availability</button>
  </form>
  <script src="https://js.paystack.co/v1/inline.js"></script>
  <script src="/assets/flatpickr.min.js"></script>
  <a href="https://wa.me/2348000000000">Chat on WhatsApp</a>
  <a href="tel:+2348000000000">Call us</a>
</body>
</html>`;

const BARE_SITE_HTML = `
<!doctype html>
<html>
<head></head>
<body>
  <h1>Welcome to our hotel</h1>
  <p>Call us to book a room.</p>
</body>
</html>`;

const JS_APP_HTML = `<!doctype html><html><head></head><body><div id="root"></div></body></html>`;

function mockFetch(html, { contentType = "text/html" } = {}) {
  return async () => ({
    ok: true,
    status: 200,
    url: "https://example-hotel.test/",
    headers: { get: (h) => (h === "content-type" ? contentType : null) },
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: Buffer.from(html, "utf-8") };
          },
        };
      },
    },
  });
}

async function run() {
  const { analyzeWebsite } = require("../lib/analyze");

  // Case 1: a well-equipped booking site
  global.fetch = mockFetch(GOOD_SITE_HTML);
  const good = await analyzeWebsite("example-hotel.test");
  const byKey = Object.fromEntries(good.checks.map((c) => [c.key, c.status]));
  assert.strictEqual(byKey.booking_mechanism, "detected", "booking mechanism should be detected");
  assert.strictEqual(byKey.payment_gateway, "detected", "payment gateway should be detected");
  assert.strictEqual(byKey.availability_calendar, "detected", "calendar should be detected");
  assert.strictEqual(byKey.whatsapp_contact, "detected", "whatsapp/phone should be detected");
  assert.strictEqual(byKey.mobile_ready, "detected", "viewport should be detected");
  assert.strictEqual(byKey.confirmation_flow, "unverified", "confirmation flow is always unverified");
  console.log("✓ Case 1 (well-equipped site) passed");

  // Case 2: a bare brochure site with nothing
  global.fetch = mockFetch(BARE_SITE_HTML);
  const bare = await analyzeWebsite("bare-hotel.test");
  const byKey2 = Object.fromEntries(bare.checks.map((c) => [c.key, c.status]));
  assert.strictEqual(byKey2.booking_mechanism, "not_detected");
  assert.strictEqual(byKey2.payment_gateway, "not_detected");
  assert.strictEqual(byKey2.availability_calendar, "not_detected");
  assert.strictEqual(byKey2.whatsapp_contact, "not_detected");
  assert.strictEqual(byKey2.mobile_ready, "not_detected");
  console.log("✓ Case 2 (bare site) passed");

  // Case 3: JS-rendered app shell should be flagged as likely incomplete
  global.fetch = mockFetch(JS_APP_HTML);
  const jsApp = await analyzeWebsite("spa-hotel.test");
  assert.strictEqual(jsApp.likelyJsRendered, true, "should flag likely JS-rendered shell");
  console.log("✓ Case 3 (JS app shell) passed");

  // Case 4: SSRF guard rejects private IPs
  dns.lookup = async () => [{ address: "127.0.0.1", family: 4 }];
  global.fetch = mockFetch(GOOD_SITE_HTML);
  let threw = false;
  try {
    await analyzeWebsite("internal.test");
  } catch (err) {
    threw = true;
    console.log("  (caught):", err.message);
    assert.ok(/allowed/i.test(err.message));
  }
  assert.ok(threw, "should reject private/internal hosts");
  console.log("✓ Case 4 (SSRF guard) passed");

  console.log("\nAll analyzer tests passed.");
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
