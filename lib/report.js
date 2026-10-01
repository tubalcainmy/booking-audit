// lib/report.js
//
// Builds the two HTML emails: the report sent to the lead, and the
// notification sent to the owner (Tubalcain) with the lead's details.

const STATUS_META = {
  detected: { icon: "✅", word: "Detected", color: "#1a7f37" },
  not_detected: { icon: "⚠️", word: "Not detected", color: "#b42318" },
  unverified: { icon: "❓", word: "Could not verify automatically", color: "#8a6d00" },
};

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderChecklistRows(checks) {
  return checks
    .map((c) => {
      const meta = STATUS_META[c.status];
      return `
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #eee;vertical-align:top;width:34px;font-size:18px;">${meta.icon}</td>
          <td style="padding:14px 16px;border-bottom:1px solid #eee;vertical-align:top;">
            <div style="font-weight:600;color:#1a1a1a;font-size:14.5px;">${escapeHtml(c.label)}</div>
            <div style="color:${meta.color};font-weight:600;font-size:12.5px;margin-top:2px;">${meta.word}</div>
            <div style="color:#555;font-size:13.5px;margin-top:6px;line-height:1.5;">${escapeHtml(c.note)}</div>
          </td>
        </tr>`;
    })
    .join("");
}

function leadReportEmail({ name, url, checks, likelyJsRendered, ownerWhatsapp, ownerPortfolioUrl }) {
  const firstName = (name || "").trim().split(/\s+/)[0] || "there";
  const jsRenderedNotice = likelyJsRendered
    ? `<p style="color:#8a6d00;background:#fff8e1;border:1px solid #f1d98a;border-radius:6px;padding:10px 14px;font-size:13px;line-height:1.5;margin:0 0 20px;">
         Heads up: your site appears to load its content dynamically (a JavaScript-driven app). This scan reads your page's raw HTML only, so some booking elements that are added by JavaScript after the page loads may not show up here even if they exist. A manual check is the only way to confirm this with certainty.
       </p>`
    : "";

  const subject = "Your free booking-flow report";

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
    <div style="background:#0B1F3A;padding:24px 28px;border-radius:8px 8px 0 0;">
      <div style="color:#C69B3C;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:700;">Tubalcain Ads Enterprise</div>
      <div style="color:#fff;font-size:20px;font-weight:700;margin-top:6px;">Your Free Booking-Flow Report</div>
    </div>
    <div style="border:1px solid #e5e5e5;border-top:none;border-radius:0 0 8px 8px;padding:28px;">
      <p style="font-size:14.5px;line-height:1.6;">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:14.5px;line-height:1.6;">
        Here's what an automated first-pass scan of <strong>${escapeHtml(url)}</strong> found on your booking flow.
        This checks for the things that most often cost short-let and hotel sites real bookings — not a full manual audit,
        but a useful starting point.
      </p>
      ${jsRenderedNotice}
      <table style="width:100%;border-collapse:collapse;margin:8px 0 20px;border:1px solid #eee;border-radius:6px;overflow:hidden;">
        ${renderChecklistRows(checks)}
      </table>
      <div style="background:#FBF3E1;border:1px solid #C69B3C;border-radius:6px;padding:16px 18px;margin-top:8px;">
        <div style="font-weight:700;color:#0B1F3A;font-size:14px;margin-bottom:6px;">Want the full picture?</div>
        <div style="font-size:13.5px;color:#3D4552;line-height:1.6;">
          This scan can't complete a real test booking, check your payment flow end-to-end, or see anything your site
          loads dynamically with JavaScript. I do a full manual walkthrough — actually testing the booking and payment
          path as a guest would — and can tell you exactly what's costing you bookings and how to fix it, often without
          replacing anything you already have.
        </div>
        <div style="margin-top:12px;font-size:13.5px;">
          <a href="https://wa.me/${escapeHtml(ownerWhatsapp)}" style="color:#0B1F3A;font-weight:700;text-decoration:none;">WhatsApp me &rarr;</a>
          &nbsp;&nbsp;|&nbsp;&nbsp;
          <a href="${escapeHtml(ownerPortfolioUrl)}" style="color:#0B1F3A;font-weight:700;text-decoration:none;">See my work &rarr;</a>
        </div>
      </div>
      <p style="font-size:12px;color:#8A8F98;margin-top:24px;line-height:1.5;">
        Tubalcain Ads Enterprise — Go-to-Market Engineering &amp; Booking Systems · Warri, Delta State, Nigeria
      </p>
    </div>
  </div>`;

  return { subject, html };
}

function ownerNotificationEmail({ name, email, url, propertyRelation, checks }) {
  const flagged = checks.filter((c) => c.status === "not_detected");
  const subject = `New lead magnet submission: ${name || "Unknown"} (${url})`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
    <h2 style="color:#0B1F3A;">New booking-flow report request</h2>
    <table style="border-collapse:collapse;width:100%;margin-bottom:20px;">
      <tr><td style="padding:6px 0;font-weight:700;width:140px;">Name</td><td style="padding:6px 0;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Email</td><td style="padding:6px 0;">${escapeHtml(email)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Relation to property</td><td style="padding:6px 0;">${escapeHtml(propertyRelation)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Website</td><td style="padding:6px 0;"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></td></tr>
    </table>
    <div style="font-weight:700;color:#0B1F3A;margin-bottom:8px;">Flagged issues (not detected):</div>
    ${
      flagged.length
        ? `<ul style="padding-left:18px;">${flagged
            .map((c) => `<li style="margin-bottom:6px;font-size:13.5px;">${escapeHtml(c.label)}</li>`)
            .join("")}</ul>`
        : `<p style="font-size:13.5px;color:#555;">No major issues flagged by the automated scan — may still be worth a manual look.</p>`
    }
    <p style="font-size:12px;color:#8A8F98;margin-top:20px;">This lead has already received their own copy of the report by email.</p>
  </div>`;

  return { subject, html };
}

module.exports = { leadReportEmail, ownerNotificationEmail };
