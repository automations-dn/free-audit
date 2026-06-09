import { task } from "@trigger.dev/sdk";
import { z } from "zod";
import { uploadHtmlToDrive } from "./helpers/google-drive.js";
import { auditGenerate } from "./audit-generate.js";

// ── Payload schema ────────────────────────────────────────────────────────────

const payloadSchema = z.object({
  website_url:   z.string().url(),
  company_name:  z.string().min(1),
  audit_type:    z.enum(["website_audit", "seo"]),
  callback_url:  z.string().url().optional(), // n8n Wait-node resume URL
});

type AuditPayload = z.infer<typeof payloadSchema>;

// ── Main task ─────────────────────────────────────────────────────────────────
// n8n triggers this via:
//   POST https://api.trigger.dev/api/v1/tasks/free-audit-workflow/trigger
//   Authorization: Bearer {TRIGGER_SECRET_KEY}
//   Body: { "payload": { website_url, company_name, audit_type, callback_url } }
//
// When done, it POSTs { success, drive_url, company_name, audit_type }
// to callback_url so n8n can resume execution.

export const freeAuditWorkflow = task({
  id: "free-audit-workflow",
  maxDuration: 900, // 15 min — Opus + web research takes time
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 30_000,
  },

  run: async (payload: AuditPayload) => {
    const { website_url, company_name, audit_type, callback_url } = payload;
    console.log(`Audit started: ${company_name} | ${audit_type} | ${website_url}`);

    // ── Step 1: Generate audit with Claude ────────────────────────────────────
    console.log("Step 1: Generating audit...");
    const auditResult = await auditGenerate.triggerAndWait({
      leadId:       `audit_${Date.now()}`,
      serviceType:  audit_type === "seo" ? "seo" : "website",
      websiteUrl:   website_url,
      companyName:  company_name,
      industry:     "",
      location:     "",
      targetMarket: "",
      services:     "",
      contactEmail: "",
      contactName:  company_name,
    });

    if (!auditResult.ok) {
      throw new Error(`Audit generation failed: ${String(auditResult.error)}`);
    }

    const { htmlContent, filename } = auditResult.output;
    console.log(`Audit generated — ${htmlContent.length.toLocaleString()} bytes`);

    // ── Step 2: Upload to Google Drive directly ───────────────────────────────
    console.log("Step 2: Uploading to Google Drive...");
    const driveFilename = filename ?? `${company_name.replace(/\s+/g, "-")}-${audit_type}-audit.html`;
    const driveUrl = await uploadHtmlToDrive(
      htmlContent,
      driveFilename,
      process.env.GOOGLE_DRIVE_FOLDER_ID ?? ""
    );
    console.log(`Uploaded: ${driveUrl}`);

    // ── Step 3: Callback to n8n ───────────────────────────────────────────────
    if (callback_url) {
      console.log("Step 3: Calling back to n8n...");
      const callbackRes = await fetch(callback_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success:      true,
          drive_url:    driveUrl,
          company_name,
          audit_type,
          website_url,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!callbackRes.ok) {
        console.warn(`n8n callback returned ${callbackRes.status} — workflow will still complete`);
      } else {
        console.log("n8n callback delivered.");
      }
    }

    return { success: true, driveUrl, company_name, audit_type };
  },
});
