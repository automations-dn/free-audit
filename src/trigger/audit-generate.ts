import { task, logger } from "@trigger.dev/sdk/v3";
import fs from "fs/promises";
import path from "path";
import { generateSEOAudit } from "./helpers/seo-audit.js";
import { generateWebsiteAudit } from "./helpers/website-audit.js";

interface AuditTaskPayload {
  leadId: string;
  serviceType: "seo" | "website";
  websiteUrl: string;
  companyName: string;
  industry: string;
  location: string;
  targetMarket: string;
  services: string;
  primaryAudience?: string;
  currentGoal?: string;
  competitors?: string;
  contactEmail: string;
  contactName: string;
}

function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML entities first
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Headings
  html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");
  html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  html = html.replace(/^#### (.*?)$/gm, "<h4>$1</h4>");

  // Bold and italic
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Tables — convert markdown table blocks to HTML
  html = html.replace(
    /((?:\|.*\|\n)+)/g,
    (block) => {
      const rows = block.trim().split("\n").filter((r) => !/^\|[-| :]+\|$/.test(r.trim()));
      if (rows.length === 0) return block;
      const [headerRow, ...bodyRows] = rows;
      const th = headerRow
        .split("|")
        .filter((_, i, a) => i > 0 && i < a.length - 1)
        .map((c) => `<th>${c.trim()}</th>`)
        .join("");
      const tbody = bodyRows
        .map(
          (row) =>
            `<tr>${row
              .split("|")
              .filter((_, i, a) => i > 0 && i < a.length - 1)
              .map((c) => `<td>${c.trim()}</td>`)
              .join("")}</tr>`
        )
        .join("\n");
      return `<table><thead><tr>${th}</tr></thead><tbody>${tbody}</tbody></table>\n`;
    }
  );

  // Lists — process line by line
  const lines = html.split("\n");
  const output: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isUl = trimmed.startsWith("- ") || trimmed.startsWith("* ");
    const isOl = /^\d+\.\s/.test(trimmed);

    if (isUl) {
      if (!inUl) { if (inOl) { output.push("</ol>"); inOl = false; } inUl = true; output.push("<ul>"); }
      output.push(`<li>${trimmed.slice(2)}</li>`);
    } else if (isOl) {
      if (!inOl) { if (inUl) { output.push("</ul>"); inUl = false; } inOl = true; output.push("<ol>"); }
      output.push(`<li>${trimmed.replace(/^\d+\.\s/, "")}</li>`);
    } else {
      if (inUl) { output.push("</ul>"); inUl = false; }
      if (inOl) { output.push("</ol>"); inOl = false; }
      if (trimmed === "" || trimmed === "<hr>") {
        output.push(trimmed === "<hr>" ? "<hr>" : "");
      } else if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<table") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<ol") ||
        trimmed.startsWith("</")
      ) {
        output.push(trimmed);
      } else {
        output.push(`<p>${trimmed}</p>`);
      }
    }
  }
  if (inUl) output.push("</ul>");
  if (inOl) output.push("</ol>");

  return output.join("\n");
}

function buildHtmlDocument(
  contentHtml: string,
  companyName: string,
  serviceType: "seo" | "website",
  auditDate: string
): string {
  const auditTitle = serviceType === "seo" ? "SEO Audit Report" : "Website Strategy Audit";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${auditTitle} — ${companyName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #ffffff;
      font-family: 'Inter', sans-serif;
      font-size: 15px;
      line-height: 1.7;
      color: #1a1a1a;
    }

    .page {
      max-width: 800px;
      margin: 0 auto;
      padding: 48px 32px 80px;
    }

    /* Cover */
    .cover {
      background: #1a1a1a;
      color: #ffffff;
      padding: 48px 40px;
      border-radius: 4px;
      margin-bottom: 56px;
    }
    .cover-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #E53935;
      margin-bottom: 16px;
    }
    .cover-company {
      font-size: 32px;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 8px;
    }
    .cover-title {
      font-size: 18px;
      font-weight: 400;
      color: #a0a0a0;
      margin-bottom: 32px;
    }
    .cover-meta {
      font-size: 13px;
      color: #666666;
      border-top: 1px solid #2e2e2e;
      padding-top: 20px;
    }

    /* Typography */
    h1 {
      font-size: 26px;
      font-weight: 700;
      color: #1a1a1a;
      margin: 48px 0 12px;
      padding-bottom: 10px;
      border-bottom: 3px solid #E53935;
      line-height: 1.25;
    }
    h2 {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
      margin: 36px 0 10px;
    }
    h3 {
      font-size: 16px;
      font-weight: 600;
      color: #333333;
      margin: 28px 0 8px;
    }
    h4 {
      font-size: 14px;
      font-weight: 600;
      color: #444444;
      margin: 20px 0 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    p {
      margin-bottom: 16px;
      color: #2d2d2d;
    }
    strong { font-weight: 600; color: #1a1a1a; }
    em { font-style: italic; color: #444; }
    code {
      font-family: 'Courier New', monospace;
      font-size: 13px;
      background: #f4f4f4;
      color: #c0392b;
      padding: 2px 5px;
      border-radius: 3px;
    }
    hr {
      border: none;
      border-top: 1px solid #e8e8e8;
      margin: 40px 0;
    }

    /* Lists */
    ul, ol {
      margin: 12px 0 20px 24px;
    }
    li {
      margin-bottom: 6px;
      color: #2d2d2d;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0 32px;
      font-size: 14px;
    }
    thead tr {
      background: #1a1a1a;
      color: #ffffff;
    }
    thead th {
      padding: 12px 14px;
      text-align: left;
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.3px;
    }
    tbody tr:nth-child(odd)  { background: #ffffff; }
    tbody tr:nth-child(even) { background: #f7f7f7; }
    tbody td {
      padding: 10px 14px;
      border: 1px solid #e0e0e0;
      color: #2d2d2d;
      vertical-align: top;
    }
    tbody tr:hover { background: #fef2f2; }
  </style>
</head>
<body>
  <div class="page">

    <div class="cover">
      <div class="cover-label">The Dare Network — Confidential</div>
      <div class="cover-company">${companyName}</div>
      <div class="cover-title">${auditTitle}</div>
      <div class="cover-meta">Prepared by The Dare Network &nbsp;·&nbsp; ${auditDate}</div>
    </div>

    ${contentHtml}

  </div>
</body>
</html>`;
}

export const auditGenerate = task({
  id: "audit-generate",
  maxDuration: 300,
  retry: { maxAttempts: 1 },

  run: async (payload: AuditTaskPayload) => {
    logger.info("Audit started", { leadId: payload.leadId, websiteUrl: payload.websiteUrl, serviceType: payload.serviceType });

    // Step 2 — Generate audit markdown
    let auditMarkdown: string;

    if (payload.serviceType === "seo") {
      logger.info("Calling generateSEOAudit", { leadId: payload.leadId });
      auditMarkdown = await generateSEOAudit({
        websiteUrl: payload.websiteUrl,
        companyName: payload.companyName,
        industry: payload.industry,
        location: payload.location,
        targetMarket: payload.targetMarket,
        services: payload.services,
      });
    } else {
      logger.info("Calling generateWebsiteAudit", { leadId: payload.leadId });
      auditMarkdown = await generateWebsiteAudit({
        websiteUrl: payload.websiteUrl,
        companyName: payload.companyName,
        industry: payload.industry,
        primaryAudience: payload.primaryAudience ?? "",
        currentGoal: payload.currentGoal ?? "",
        competitors: payload.competitors,
      });
    }

    logger.info("Audit markdown generated", { leadId: payload.leadId, chars: auditMarkdown.length });

    // Step 3 — Convert to styled HTML
    const auditDate = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const contentHtml = markdownToHtml(auditMarkdown);
    const fullHtml = buildHtmlDocument(contentHtml, payload.companyName, payload.serviceType, auditDate);

    // Step 4 — Save to /tmp/audits/
    const outputDir = "/tmp/audits";
    await fs.mkdir(outputDir, { recursive: true });

    const filename = `${payload.leadId}-${payload.serviceType}-audit.html`;
    const filePath = path.join(outputDir, filename);
    await fs.writeFile(filePath, fullHtml, "utf8");

    logger.info("Audit saved", { leadId: payload.leadId, filePath });

    // Step 5 — Return result
    return {
      success: true,
      leadId: payload.leadId,
      filePath,
      serviceType: payload.serviceType,
      auditLength: auditMarkdown.length,
    };
  },
});

