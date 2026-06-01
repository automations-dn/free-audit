import { LeadData } from "./n8n-mcp.js";

/**
 * Sends the initial Lead Human Verification Card to Slack with Approve & Decline buttons.
 */
export async function sendSlackLeadVerification(
  lead: LeadData,
  tokenId: string
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_AUDIT_CHANNEL_ID;

  if (!token || !channel) {
    console.warn("Slack Bot Token or Channel ID is missing. Skipping Slack verification.");
    return;
  }

  const payload = {
    channel,
    text: `Free Audit Lead Request: ${lead.company_name}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New Free Audit Requested!", emoji: true },
      },
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Company Name:*\n${lead.company_name}` },
          {
            type: "mrkdwn",
            text: `*Website URL:*\n<${lead.website_url}|${lead.website_url.replace(/(^\w+:|^)\/\//, "")}>`,
          },
          { type: "mrkdwn", text: `*Email Address:*\n${lead.email}` },
          { type: "mrkdwn", text: `*Phone Number:*\n${lead.phone}` },
          {
            type: "mrkdwn",
            text: `*Audit Type:*\n\`${lead.audit_type === "website_audit" ? "Website Audit (Shopify/WP)" : "SEO Audit"}\``,
          },
        ],
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Approve this request to begin generating the audit?*" },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve & Generate", emoji: true },
            style: "primary",
            action_id: "approve_lead",
            value: JSON.stringify({ tokenId, decision: "approve" }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Decline Request", emoji: true },
            style: "danger",
            action_id: "decline_lead",
            value: JSON.stringify({ tokenId, decision: "decline" }),
          },
        ],
      },
    ],
  };

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const resJson: any = await response.json();
  if (!resJson.ok) {
    throw new Error(`Slack API error posting lead card: ${resJson.error}`);
  }

  console.log(`Slack lead verification card posted for ${lead.company_name}`);
}

/**
 * Sends the Audit Review Card to Slack with a plain-text preview of the generated audit.
 * The reviewer can approve to send the full HTML audit email to the client, or discard it.
 */
export async function sendSlackAuditReview(
  lead: LeadData,
  auditPreview: string,
  tokenId: string
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_AUDIT_CHANNEL_ID;

  if (!token || !channel) {
    console.warn("Slack Bot Token or Channel ID is missing. Skipping audit review card.");
    return;
  }

  const auditLabel = lead.audit_type === "website_audit" ? "Website" : "SEO";

  const payload = {
    channel,
    text: `Audit ready for ${lead.company_name} — review before sending`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Audit Generation Completed", emoji: true },
      },
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Company:*\n${lead.company_name}` },
          { type: "mrkdwn", text: `*Audit Type:*\n${auditLabel} Audit` },
          { type: "mrkdwn", text: `*Send To:*\n${lead.email}` },
          {
            type: "mrkdwn",
            text: `*Website:*\n<${lead.website_url}|${lead.website_url.replace(/(^\w+:|^)\/\//, "")}>`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Audit Preview:*\n\`\`\`${auditPreview}\`\`\``,
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*The full audit will be embedded in the email. Send it to the client now?*",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Send to Client", emoji: true },
            style: "primary",
            action_id: "send_audit_email",
            value: JSON.stringify({ tokenId, decision: "approve" }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Discard / Skip", emoji: true },
            style: "danger",
            action_id: "discard_audit",
            value: JSON.stringify({ tokenId, decision: "decline" }),
          },
        ],
      },
    ],
  };

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const resJson: any = await response.json();
  if (!resJson.ok) {
    throw new Error(`Slack API error posting audit review card: ${resJson.error}`);
  }

  console.log(`Slack audit review card posted for ${lead.company_name}`);
}
