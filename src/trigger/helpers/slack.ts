import { LeadData } from "./sheets.js";

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
    console.warn("⚠️ Slack Bot Token or Channel ID is missing. Skipping Slack verification.");
    return;
  }

  const payload = {
    channel,
    text: `Free Audit Lead Request: ${lead.company_name}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚨 New Free Audit Requested!",
          emoji: true,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Company Name:*\n${lead.company_name}`,
          },
          {
            type: "mrkdwn",
            text: `*Website URL:*\n<${lead.website_url}|${lead.website_url.replace(/(^\w+:|^)\/\//, "")}>`,
          },
          {
            type: "mrkdwn",
            text: `*Email Address:*\n${lead.email}`,
          },
          {
            type: "mrkdwn",
            text: `*Phone Number:*\n${lead.phone}`,
          },
          {
            type: "mrkdwn",
            text: `*Audit Option Requested:*\n\`${lead.audit_type === "website_audit" ? "Website Audit (Shopify/WP)" : "SEO Audit"}\``,
          },
        ],
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Would you like to approve this request and generate the audit?*",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Approve & Generate ✅",
              emoji: true,
            },
            style: "primary",
            action_id: "approve_lead",
            value: JSON.stringify({ tokenId, decision: "approve" }),
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Decline Request ❌",
              emoji: true,
            },
            style: "danger",
            action_id: "decline_lead",
            value: JSON.stringify({ tokenId, decision: "decline" }),
          },
        ],
      },
    ],
  };

  try {
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
      throw new Error(`Slack API error: ${resJson.error}`);
    }

    console.log(`💬 Slack Lead Verification Card posted for ${lead.company_name}`);
  } catch (error) {
    console.error("❌ Slack API Error:", error);
    throw new Error(`Failed to post Slack message: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Sends the final Audit Document Delivery Card to Slack showing the link and a button to send the email.
 */
export async function sendSlackDocVerification(
  lead: LeadData,
  docLink: string,
  tokenId: string
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_AUDIT_CHANNEL_ID;

  if (!token || !channel) {
    console.warn("⚠️ Slack Bot Token or Channel ID is missing. Skipping Slack doc verification.");
    return;
  }

  const payload = {
    channel,
    text: `Free Audit Ready: ${lead.company_name}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🎉 Audit Generation Completed!",
          emoji: true,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `The *${lead.audit_type === "website_audit" ? "Website" : "SEO"} Audit* for *${lead.company_name}* has been successfully generated and saved to your Google Drive.`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📄 *Google Doc Link:*\n<${docLink}|Open Generated Audit Document>`,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Would you like to send this audit to the client's email now?*",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Send to Client ✉️",
              emoji: true,
            },
            style: "primary",
            action_id: "send_audit_email",
            value: JSON.stringify({ tokenId, decision: "approve" }),
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Discard / Skip ❌",
              emoji: true,
            },
            style: "danger",
            action_id: "discard_audit",
            value: JSON.stringify({ tokenId, decision: "decline" }),
          },
        ],
      },
    ],
  };

  try {
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
      throw new Error(`Slack API error: ${resJson.error}`);
    }

    console.log(`💬 Slack Document Delivery Card posted for ${lead.company_name}`);
  } catch (error) {
    console.error("❌ Slack Document Card API Error:", error);
    throw new Error(`Failed to post Slack message: ${error instanceof Error ? error.message : String(error)}`);
  }
}
