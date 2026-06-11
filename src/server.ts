import express from "express";
import dotenv from "dotenv";
import { wait, tasks } from "@trigger.dev/sdk";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ status: "ok", time: new Date().toISOString() })
);

// ── POST /webhook/audit ───────────────────────────────────────────────────────
// Called by n8n (or any HTTP client) to start an audit.
// Returns immediately with run_id. The audit result is sent to callback_url
// (the n8n Wait-node resumeUrl) when the workflow completes.
//
// Required body fields:
//   website_url   — full URL of the site to audit
//   company_name  — client company name
//   audit_type    — "seo" | "website_audit"
//   callback_url  — n8n $execution.resumeUrl (optional but needed for n8n)
//
// Optional header:
//   x-webhook-secret — must match WEBHOOK_SECRET env var if set
app.post("/webhook/audit", async (req, res) => {
  // Optional secret validation
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    return res.status(401).json({ error: "Invalid webhook secret" });
  }

  const { website_url, company_name, audit_type, callback_url } = req.body ?? {};

  if (!website_url || !company_name || !audit_type) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["website_url", "company_name", "audit_type"],
      optional: ["callback_url"],
    });
  }

  if (!["seo", "website_audit"].includes(audit_type)) {
    return res.status(400).json({ error: "audit_type must be 'seo' or 'website_audit'" });
  }

  try {
    const handle = await tasks.trigger("free-audit-workflow", {
      website_url,
      company_name,
      audit_type,
      callback_url: callback_url ?? null,
    });

    console.log(`Audit triggered: ${handle.id} for ${company_name} (${audit_type})`);

    return res.json({
      success:  true,
      run_id:   handle.id,
      message:  `Audit started for ${company_name}. Results will POST to callback_url when complete.`,
      links: {
        run: `https://cloud.trigger.dev/runs/${handle.id}`,
      },
    });
  } catch (err) {
    console.error("Webhook trigger error:", err);
    return res.status(500).json({ error: "Failed to start audit", detail: String(err) });
  }
});

// ── GET /api/approve ──────────────────────────────────────────────────────────
// Not used in the n8n-driven flow (n8n handles Slack approval internally).
// Keep this as a fallback in case you want a simple link-click approval flow.
app.get("/api/approve", async (req, res) => {
  const { token, approved, secret } = req.query;

  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).send(htmlPage("Unauthorized", "Invalid security token.", "#dc2626", "❌"));
  }
  if (!token) {
    return res.status(400).send(htmlPage("Bad Request", "Missing token.", "#dc2626", "⚠️"));
  }

  const isApproved = approved === "true";
  try {
    await wait.completeToken(String(token), { approved: isApproved, reviewer: "slack-link" });
    return res.send(
      htmlPage(
        isApproved ? "Approved" : "Rejected",
        isApproved
          ? "The request has been approved. The workflow will continue automatically."
          : "The request has been rejected. The workflow has stopped.",
        isApproved ? "#16a34a" : "#dc2626",
        isApproved ? "✅" : "❌"
      )
    );
  } catch (err) {
    console.error("Token completion error:", err);
    return res.status(500).send(
      htmlPage("Error", "Could not record your decision. The link may have already been used or expired.", "#d97706", "⚠️")
    );
  }
});

// ── HTML response helper ──────────────────────────────────────────────────────
function htmlPage(title: string, message: string, color: string, emoji: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${title} — The Dare Network</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
       background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:14px;padding:52px 48px;text-align:center;
        max-width:480px;width:90%;box-shadow:0 4px 32px rgba(0,0,0,.09)}
  .icon{font-size:52px;margin-bottom:18px}
  h2{color:${color};font-size:26px;margin-bottom:12px;font-weight:700}
  p{color:#64748b;font-size:15px;line-height:1.65}
  .brand{color:#94a3b8;font-size:11px;margin-top:36px;letter-spacing:1.5px;text-transform:uppercase}
</style></head>
<body><div class="card">
  <div class="icon">${emoji}</div>
  <h2>${title}</h2>
  <p>${message}</p>
  <div class="brand">The Dare Network — Audit System</div>
</div></body></html>`;
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  Health  : GET  http://localhost:${PORT}/health`);
  console.log(`  Webhook : POST http://localhost:${PORT}/webhook/audit`);
  console.log(`  Approve : GET  http://localhost:${PORT}/api/approve`);
});
