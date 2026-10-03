require("dotenv").config();

const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");

const { analyzeWebsite } = require("./lib/analyze");
const { leadReportEmail, ownerNotificationEmail } = require("./lib/report");
const { sendEmail } = require("./lib/email");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Basic abuse protection: this endpoint fetches arbitrary URLs and sends
// email, so it's rate-limited per IP on top of the honeypot check below.
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a few minutes." },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_RELATIONS = new Set(["owner", "manager", "marketing", "other"]);

app.post("/api/analyze", analyzeLimiter, async (req, res) => {
  try {
    const { name, email, propertyRelation, url, company } = req.body || {};

    // Honeypot: a real visitor never fills this hidden field. Silently
    // pretend success so bots don't learn to avoid it.
    if (company) {
      return res.json({ ok: true });
    }

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "Please enter your name." });
    }
    if (!email || !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (!VALID_RELATIONS.has(String(propertyRelation || "").toLowerCase())) {
      return res.status(400).json({ error: "Please select how you're related to the property." });
    }
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Please enter your website URL." });
    }

    const cleanName = name.trim().slice(0, 120);
    const cleanEmail = email.trim().slice(0, 200);
    const cleanRelation = propertyRelation.trim().slice(0, 40);

    let result;
    try {
      result = await analyzeWebsite(url);
    } catch (err) {
      return res.status(422).json({ error: err.message || "Could not analyze that website." });
    }

    const ownerWhatsapp = process.env.OWNER_WHATSAPP || "";
    const ownerPortfolioUrl = process.env.OWNER_PORTFOLIO_URL || "";
    const ownerEmail = process.env.OWNER_EMAIL;

    // Emailing the report to the LEAD requires a verified sending domain in
    // Resend — on the free onboarding@resend.dev sandbox sender, Resend will
    // only deliver to the account's own address. Until a domain is verified,
    // the report is returned in this response and rendered on the page
    // instead. Set SEND_LEAD_EMAIL=true once a domain is verified to also
    // email it to the lead.
    if (process.env.SEND_LEAD_EMAIL === "true") {
      const leadEmail = leadReportEmail({
        name: cleanName,
        url: result.finalUrl || result.url,
        checks: result.checks,
        likelyJsRendered: result.likelyJsRendered,
        ownerWhatsapp,
        ownerPortfolioUrl,
      });
      try {
        await sendEmail({ to: cleanEmail, subject: leadEmail.subject, html: leadEmail.html });
      } catch (err) {
        // Non-fatal: the visitor still gets the report on-page below, so a
        // failed email copy shouldn't block the response — just log it.
        console.error("Lead report email failed to send:", err.message);
      }
    }

    // Best-effort notification to the owner — a failure here shouldn't block
    // the visitor's success response, but it is logged.
    if (ownerEmail) {
      const notice = ownerNotificationEmail({
        name: cleanName,
        email: cleanEmail,
        url: result.finalUrl || result.url,
        propertyRelation: cleanRelation,
        checks: result.checks,
      });
      sendEmail({ to: ownerEmail, subject: notice.subject, html: notice.html }).catch((err) => {
        console.error("Owner notification email failed:", err.message);
      });
    }

    return res.json({
      ok: true,
      report: {
        url: result.finalUrl || result.url,
        likelyJsRendered: result.likelyJsRendered,
        checks: result.checks,
        ownerWhatsapp,
        ownerPortfolioUrl,
      },
    });
  } catch (err) {
    console.error("Unexpected error in /api/analyze:", err);
    return res.status(500).json({ error: "Something went wrong on our end. Please try again shortly." });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Booking-flow audit lead magnet listening on port ${PORT}`);
});
