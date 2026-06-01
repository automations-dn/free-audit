/**
 * n8n MCP Client
 *
 * Calls tools exposed by the n8n MCP Server Trigger workflow via the
 * Streamable HTTP transport (POST to base URL with JSON-RPC body).
 * Falls back to parsing SSE responses if n8n returns text/event-stream.
 *
 * Required env var: N8N_MCP_URL
 *
 * Tools this module expects in your n8n MCP workflow:
 *
 *   Tool: "log_lead"
 *   Input: { company_name, website_url, email, phone, audit_type, timestamp }
 *   Action: Append a row to Google Sheets
 *
 *   Tool: "send_audit_email"
 *   Input: { to_email, company_name, website_url, audit_type, audit_html }
 *   Action: Send email via Gmail/SMTP with audit_html as the body
 */

export interface LeadData {
  website_url: string;
  company_name: string;
  email: string;
  phone: string;
  audit_type: "website_audit" | "seo";
}

// Internal MCP caller -------------------------------------------------------

async function callN8nMcpTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown>
): Promise<T> {
  const url = process.env.N8N_MCP_URL;
  if (!url) throw new Error("N8N_MCP_URL is not set in environment variables.");

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: `${toolName}-${Date.now()}`,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  const apiKey = process.env.N8N_API_KEY;
  const authHeaders: Record<string, string> = apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...authHeaders,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `n8n MCP returned HTTP ${response.status} for tool "${toolName}": ${text}`
    );
  }

  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = JSON.parse(line.slice(6)) as {
        result?: T;
        error?: { message: string };
      };
      if (data.error) throw new Error(`n8n MCP tool error: ${data.error.message}`);
      if (data.result !== undefined) return data.result;
    }
    throw new Error(`n8n MCP: no result in SSE stream for tool "${toolName}"`);
  }

  const json = (await response.json()) as {
    result?: T;
    error?: { message: string; code?: number };
  };
  if (json.error) {
    throw new Error(`n8n MCP tool error: ${json.error.message ?? JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

// Public tool wrappers -------------------------------------------------------

export async function logLeadToSheet(lead: LeadData): Promise<void> {
  console.log(`Logging lead to sheet via n8n MCP: ${lead.company_name}`);
  await callN8nMcpTool("log_lead", {
    company_name: lead.company_name,
    website_url: lead.website_url,
    email: lead.email,
    phone: lead.phone,
    audit_type: lead.audit_type === "website_audit" ? "Website Audit" : "SEO Audit",
    timestamp: new Date().toISOString(),
  });
  console.log(`Lead logged: ${lead.company_name}`);
}

export async function sendAuditEmail(lead: LeadData, auditMarkdown: string): Promise<void> {
  console.log(`Sending audit email via n8n MCP to: ${lead.email}`);
  const auditHtml = convertMarkdownToEmailHtml(auditMarkdown, lead.company_name);
  await callN8nMcpTool("send_audit_email", {
    to_email: lead.email,
    company_name: lead.company_name,
    website_url: lead.website_url,
    audit_type: lead.audit_type === "website_audit" ? "Website Audit" : "SEO Audit",
    audit_html: auditHtml,
  });
  console.log(`Audit email dispatched to: ${lead.email}`);
}

// Markdown to HTML converter (premium email styling) -------------------------

export function convertMarkdownToEmailHtml(md: string, companyName: string): string {
  let html = md;

  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(
    /^# (.*?)$/gm,
    '<h1 style="color:#1E3A8A;font-size:24px;font-weight:bold;border-bottom:2px solid #1E3A8A;padding-bottom:8px;margin-top:32px;font-family:Arial,sans-serif;">$1</h1>'
  );
  html = html.replace(
    /^## (.*?)$/gm,
    '<h2 style="color:#2563EB;font-size:18px;font-weight:bold;border-bottom:1px solid #E5E7EB;padding-bottom:5px;margin-top:24px;font-family:Arial,sans-serif;">$1</h2>'
  );
  html = html.replace(
    /^### (.*?)$/gm,
    '<h3 style="color:#4B5563;font-size:14px;font-weight:bold;margin-top:18px;font-family:Arial,sans-serif;">$1</h3>'
  );

  html = html.replace(
    /\*\*(.*?)\*\*/g,
    '<strong style="color:#111827;font-weight:bold;">$1</strong>'
  );
  html = html.replace(/\*(.*?)\*/g, '<em style="color:#374151;">$1</em>');

  html = html.replace(
    /`(.*?)`/g,
    '<code style="background:#F3F4F6;color:#DC2626;padding:2px 4px;border-radius:3px;font-family:Courier New,monospace;font-size:12px;">$1</code>'
  );

  html = html.replace(
    /\bSeverity:\s*High\b/gi,
    'Severity: <span style="background:#FEE2E2;color:#DC2626;font-weight:bold;padding:1px 6px;border-radius:3px;font-size:11px;">HIGH</span>'
  );
  html = html.replace(
    /\bSeverity:\s*Medium\b/gi,
    'Severity: <span style="background:#FEF3C7;color:#D97706;font-weight:bold;padding:1px 6px;border-radius:3px;font-size:11px;">MEDIUM</span>'
  );
  html = html.replace(
    /\bSeverity:\s*Low\b/gi,
    'Severity: <span style="background:#ECFDF5;color:#059669;font-weight:bold;padding:1px 6px;border-radius:3px;font-size:11px;">LOW</span>'
  );

  const lines = html.split("\n");
  const output: string[] = [];
  let inList = false;
  let listTag = "";

  for (const line of lines) {
    const trimmed = line.trim();
    const isUl = trimmed.startsWith("- ") || trimmed.startsWith("* ");
    const isOl = /^\d+\.\s/.test(trimmed);

    if (isUl) {
      if (!inList || listTag !== "ul") {
        if (inList) output.push(`</${listTag}>`);
        inList = true;
        listTag = "ul";
        output.push(
          '<ul style="margin:10px 0 15px 20px;padding:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">'
        );
      }
      output.push(
        `<li style="margin-bottom:5px;color:#374151;">${trimmed.substring(2)}</li>`
      );
    } else if (isOl) {
      if (!inList || listTag !== "ol") {
        if (inList) output.push(`</${listTag}>`);
        inList = true;
        listTag = "ol";
        output.push(
          '<ol style="margin:10px 0 15px 20px;padding:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">'
        );
      }
      output.push(
        `<li style="margin-bottom:5px;color:#374151;">${trimmed.replace(/^\d+\.\s/, "")}</li>`
      );
    } else {
      if (inList) {
        output.push(`</${listTag}>`);
        inList = false;
        listTag = "";
      }
      if (trimmed === "") {
        output.push("<br/>");
      } else if (!trimmed.startsWith("<h") && !trimmed.startsWith("<br")) {
        output.push(
          `<p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;font-family:Arial,sans-serif;color:#374151;">${trimmed}</p>`
        );
      } else {
        output.push(trimmed);
      }
    }
  }
  if (inList) output.push(`</${listTag}>`);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${companyName} - Audit Report</title></head>
<body style="font-family:Arial,sans-serif;color:#333;line-height:1.6;margin:0;padding:0;background:#F9FAFB;">
  <div style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
    <div style="background:#1E3A8A;padding:28px 30px;text-align:center;">
      <h1 style="color:#fff;font-size:26px;margin:0;font-family:Arial,sans-serif;font-weight:bold;">THE DARE NETWORK</h1>
      <p style="color:#93C5FD;font-size:13px;margin:8px 0 0;letter-spacing:1px;text-transform:uppercase;">Growth Marketing &amp; Conversion Optimisation Agency</p>
    </div>
    <div style="padding:28px 32px 0;border-bottom:1px solid #F3F4F6;">
      <p style="font-size:15px;color:#374151;margin-top:0;">Hi Team at <strong>${companyName}</strong>,</p>
      <p style="font-size:14px;color:#4B5563;">Thank you for requesting a free audit. Our senior specialists have reviewed your website and compiled the findings below. This is a bespoke assessment, not a generic checklist, built around what we found on your specific site.</p>
      <p style="font-size:14px;color:#4B5563;">Read through the findings and reply to this email when you are ready to discuss a roadmap.</p>
    </div>
    <div style="padding:28px 32px;">
      ${output.join("\n")}
    </div>
    <div style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px;text-align:center;font-size:11px;color:#9CA3AF;font-family:Arial,sans-serif;">
      <p style="margin:0;">This assessment was prepared by The Dare Network for ${companyName}.</p>
      <p style="margin:4px 0 0;">&copy; ${new Date().getFullYear()} The Dare Network. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

