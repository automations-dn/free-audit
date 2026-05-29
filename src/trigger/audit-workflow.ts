import { task, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { appendLeadToSheets, LeadData } from "./helpers/sheets.js";
import { sendSlackLeadVerification, sendSlackDocVerification } from "./helpers/slack.js";
import { createZohoBiginDeal } from "./helpers/crm.js";
import { scrapeWebsiteAndGetMetrics } from "./helpers/scraper.js";
import { generateAuditWithClaude } from "./helpers/anthropic.js";
import { createGoogleDocFromMarkdown } from "./helpers/drive.js";
import { sendPersonalizedAuditEmail } from "./helpers/email.js";

// Re-use Zod schema for strong typing inside the Trigger task
const leadSchema = z.object({
  website_url: z.string().url(),
  company_name: z.string(),
  email: z.string().email(),
  phone: z.string(),
  audit_type: z.enum(["website_audit", "seo"]),
});

type WorkflowPayload = z.infer<typeof leadSchema>;

/**
 * Main Durable Trigger.dev Task orchestrating the Free Audit lead capture, verification,
 * research, generation, document conversion, and email delivery pipeline.
 */
export const freeAuditWorkflow = task({
  id: "free-audit-workflow",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: WorkflowPayload) => {
    console.log(`🎬 Workflow started for Lead: ${payload.company_name} (${payload.website_url})`);

    // --- STEP 1: Log Lead to Google Sheets ---
    console.log("📝 Step 1: Logging lead to Google Sheets...");
    await appendLeadToSheets(payload);

    // --- STEP 2: Initiate Human Approval in Slack ---
    console.log("🙋 Step 2: Creating waitpoint token for Slack lead verification...");
    
    // Create a waitpoint token that expires in 1 day
    const leadToken = await wait.createToken({ timeout: "1d" });
    
    // Post the Block Kit card to Slack with the interactive buttons
    await sendSlackLeadVerification(payload, leadToken.id);

    console.log(`⏸️ Workflow paused. Waiting for lead approval from Slack (Token ID: ${leadToken.id})...`);
    
    // Pause execution and wait for the Express server callback
    const leadApprovalResult = await wait.forToken<{
      approved: boolean;
      reviewer: string;
    }>(leadToken.id);

    // --- STEP 3: Handle Lead Verification Decision ---
    if (!leadApprovalResult.ok) {
      console.warn("⚠️ Slack lead approval timed out or failed. Terminating workflow.");
      return { status: "expired", reason: "Lead approval timed out (1 day)" };
    }

    const { approved, reviewer } = leadApprovalResult.output;
    console.log(`▶️ Workflow resumed. Reviewer @${reviewer} decided: ${approved ? "APPROVE" : "DECLINE"}`);

    if (!approved) {
      console.log("❌ Lead was declined. Stopping automation.");
      return { status: "declined", reviewer };
    }

    // --- STEP 4: Add to Zoho Bigin CRM ---
    console.log("💼 Step 3: Creating lead records in Zoho Bigin CRM...");
    try {
      await createZohoBiginDeal(payload);
    } catch (crmError) {
      // Don't crash the whole flow if CRM logs fail, but report it
      console.error("⚠️ Zoho CRM logging failed, continuing workflow:", crmError);
    }

    // --- STEP 5: Run Goated Scraper & Performance Research ---
    console.log("🔍 Step 4: Running deep website scraper & Lighthouse checks...");
    const scrapedData = await scrapeWebsiteAndGetMetrics(payload.website_url);

    // --- STEP 6: Execute Claude Audit Generation ---
    console.log("🤖 Step 5: Invoking Claude to compile the customized audit report...");
    const auditMarkdown = await generateAuditWithClaude(payload, scrapedData);

    // --- STEP 7: Convert Markdown and Create Google Doc ---
    console.log("📂 Step 6: Converting markdown and uploading document to Google Drive...");
    const googleDocLink = await createGoogleDocFromMarkdown(auditMarkdown, payload.company_name);
    console.log(`✅ Google Doc Audit Report generated successfully: ${googleDocLink}`);

    // --- STEP 8: Initiate Human Review for Email Delivery ---
    console.log("🙋 Step 7: Creating second waitpoint token for Slack document delivery card...");
    
    const docToken = await wait.createToken({ timeout: "1d" });
    
    // Post the Block Kit card with the Google Doc link
    await sendSlackDocVerification(payload, googleDocLink, docToken.id);

    console.log(`⏸️ Workflow paused. Waiting for document review (Token ID: ${docToken.id})...`);
    
    // Pause execution and wait for document approval
    const docApprovalResult = await wait.forToken<{
      approved: boolean;
      reviewer: string;
    }>(docToken.id);

    // --- STEP 9: Handle Document Verification & Dispatch ---
    if (!docApprovalResult.ok) {
      console.warn("⚠️ Slack doc approval timed out. Audit was not sent.");
      return { status: "expired", reason: "Doc approval timed out" };
    }

    const docDecision = docApprovalResult.output;
    console.log(`▶️ Workflow resumed. Document review decision: ${docDecision.approved ? "SEND" : "DISCARD"}`);

    if (!docDecision.approved) {
      console.log("❌ Document delivery was declined or skipped. Audit not sent to client.");
      return { status: "discarded", googleDocLink };
    }

    // --- STEP 10: Dispatch Personalized Email ---
    console.log("✉️ Step 8: Delivering personalized audit email to client...");
    await sendPersonalizedAuditEmail(payload, googleDocLink);

    console.log(`🎉 Workflow completed successfully for ${payload.company_name}!`);
    return {
      status: "completed",
      company: payload.company_name,
      googleDocLink,
      sentTo: payload.email,
    };
  },
});
