import { task, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { logLeadToSheet, sendAuditEmail } from "./helpers/n8n-mcp.js";
import { sendSlackLeadVerification, sendSlackAuditReview } from "./helpers/slack.js";
import { createZohoBiginDeal } from "./helpers/crm.js";
import { scrapeWebsiteAndGetMetrics } from "./helpers/scraper.js";
import { generateAuditWithClaude } from "./helpers/anthropic.js";

const leadSchema = z.object({
  website_url: z.string().url(),
  company_name: z.string(),
  email: z.string().email(),
  phone: z.string(),
  audit_type: z.enum(["website_audit", "seo"]),
});

type WorkflowPayload = z.infer<typeof leadSchema>;

function buildAuditPreview(markdown: string): string {
  const plain = markdown
    .replace(/^#{1,3} /gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/^- /gm, "* ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain.length > 380 ? plain.slice(0, 377) + "..." : plain;
}

/**
 * Main durable Trigger.dev task orchestrating the Free Audit pipeline:
 * lead capture => Slack human approval => CRM => scrape => Claude audit =>
 * Slack review => email delivery via n8n MCP.
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
    console.log(`Workflow started for: ${payload.company_name} (${payload.website_url})`);

    // Step 1: Log lead to Google Sheets via n8n MCP
    console.log("Step 1: Logging lead to sheet via n8n MCP...");
    await logLeadToSheet(payload);

    // Step 2: Slack human approval (first gate)
    console.log("Step 2: Requesting lead approval via Slack...");
    const leadToken = await wait.createToken({ timeout: "1d" });
    await sendSlackLeadVerification(payload, leadToken.id);

    console.log(`Workflow paused. Waiting for lead approval (token: ${leadToken.id})`);
    const leadApprovalResult = await wait.forToken<{
      approved: boolean;
      reviewer: string;
    }>(leadToken.id);

    if (!leadApprovalResult.ok) {
      console.warn("Lead approval timed out. Terminating.");
      return { status: "expired", reason: "Lead approval timed out after 1 day" };
    }

    const { approved, reviewer } = leadApprovalResult.output;
    console.log(`Workflow resumed. Reviewer @${reviewer} decided: ${approved ? "APPROVE" : "DECLINE"}`);

    if (!approved) {
      return { status: "declined", reviewer };
    }

    // Step 3: CRM
    console.log("Step 3: Creating deal in Zoho Bigin CRM...");
    try {
      await createZohoBiginDeal(payload);
    } catch (crmError) {
      console.error("Zoho CRM logging failed (continuing):", crmError);
    }

    // Step 4: Scrape
    console.log("Step 4: Scraping website and fetching PageSpeed data...");
    const scrapedData = await scrapeWebsiteAndGetMetrics(payload.website_url);

    // Step 5: Generate audit with Claude
    console.log("Step 5: Generating audit with Claude...");
    const auditMarkdown = await generateAuditWithClaude(payload, scrapedData);

    // Step 6: Slack review gate (second gate)
    console.log("Step 6: Sending audit review card to Slack...");
    const docToken = await wait.createToken({ timeout: "1d" });
    const auditPreview = buildAuditPreview(auditMarkdown);
    await sendSlackAuditReview(payload, auditPreview, docToken.id);

    console.log(`Workflow paused. Waiting for send approval (token: ${docToken.id})`);
    const sendApprovalResult = await wait.forToken<{
      approved: boolean;
      reviewer: string;
    }>(docToken.id);

    if (!sendApprovalResult.ok) {
      console.warn("Send approval timed out. Audit was not delivered.");
      return { status: "expired", reason: "Send approval timed out after 1 day" };
    }

    const sendDecision = sendApprovalResult.output;
    console.log(`Send decision: ${sendDecision.approved ? "SEND" : "DISCARD"}`);

    if (!sendDecision.approved) {
      return { status: "discarded" };
    }

    // Step 7: Send email via n8n MCP (full HTML audit embedded)
    console.log("Step 7: Sending audit email via n8n MCP...");
    await sendAuditEmail(payload, auditMarkdown);

    console.log(`Workflow completed for ${payload.company_name}`);
    return {
      status: "completed",
      company: payload.company_name,
      sentTo: payload.email,
    };
  },
});
