// lib/email.js
//
// Thin wrapper around the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// No SDK dependency needed — it's one POST request.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error(
      "Email is not configured: set RESEND_API_KEY and FROM_EMAIL in your environment."
    );
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `Resend API error (${res.status}): ${bodyText || "no details returned"}`
    );
  }

  return res.json();
}

module.exports = { sendEmail };
