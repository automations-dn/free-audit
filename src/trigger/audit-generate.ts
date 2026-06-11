import { task, logger } from "@trigger.dev/sdk/v3";
import fs from "fs/promises";
import path from "path";
import { generateSEOAudit } from "./helpers/seo-audit.js";
import { generateWebsiteAudit } from "./helpers/website-audit.js";
import { fetchPageSpeedData, formatPageSpeedForPrompt } from "./helpers/pagespeed.js";
import { buildAuditDocx } from "./helpers/docx-builder.js";

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

// ── Markdown → HTML converter ─────────────────────────────────────────────────

function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML entities
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Severity badge replacements (do before headings so they work in tables too)
  html = html.replace(
    /\bSeverity:\s*High\b/gi,
    'Severity: <span class="badge badge-high">High</span>'
  );
  html = html.replace(
    /\bSeverity:\s*Medium\b/gi,
    'Severity: <span class="badge badge-medium">Medium</span>'
  );
  html = html.replace(
    /\bSeverity:\s*Low\b/gi,
    'Severity: <span class="badge badge-low">Low</span>'
  );
  // Priority tags
  html = html.replace(/\bPriority:\s*High\b/gi, 'Priority: <span class="badge badge-high">High</span>');
  html = html.replace(/\bPriority:\s*Medium\b/gi, 'Priority: <span class="badge badge-medium">Medium</span>');
  html = html.replace(/\bPriority:\s*Low\b/gi, 'Priority: <span class="badge badge-low">Low</span>');
  // Impact/Status tags
  html = html.replace(/\bStatus:\s*Critical\b/gi, 'Status: <span class="badge badge-high">Critical</span>');
  html = html.replace(/\bStatus:\s*Pass\b/gi, 'Status: <span class="badge badge-low">Pass</span>');
  html = html.replace(/\bStatus:\s*Fail\b/gi, 'Status: <span class="badge badge-high">Fail</span>');
  html = html.replace(/\bStatus:\s*Warning\b/gi, 'Status: <span class="badge badge-medium">Warning</span>');

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
  html = html.replace(/^___$/gm, "<hr>");

  // Tables — wrap in .table-wrap for rounded-corner shadow
  html = html.replace(/((?:\|.*\|\n)+)/g, (block) => {
    const rows = block
      .trim()
      .split("\n")
      .filter((r) => !/^\|[-|: ]+\|$/.test(r.trim()));
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

    return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tbody}</tbody></table></div>\n`;
  });

  // Lists — process line by line
  const lines = html.split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const t = line.trim();
    const isUl = t.startsWith("- ") || t.startsWith("* ");
    const isOl = /^\d+\.\s/.test(t);

    if (isUl) {
      if (!inUl) {
        if (inOl) { out.push("</ol>"); inOl = false; }
        inUl = true;
        out.push("<ul>");
      }
      out.push(`<li>${t.slice(2)}</li>`);
    } else if (isOl) {
      if (!inOl) {
        if (inUl) { out.push("</ul>"); inUl = false; }
        inOl = true;
        out.push("<ol>");
      }
      out.push(`<li>${t.replace(/^\d+\.\s/, "")}</li>`);
    } else {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (inOl) { out.push("</ol>"); inOl = false; }

      if (t === "" || t === "<hr>") {
        out.push(t === "<hr>" ? "<hr>" : "");
      } else if (
        t.startsWith("<h") ||
        t.startsWith("<div") ||
        t.startsWith("<table") ||
        t.startsWith("<ul") ||
        t.startsWith("<ol") ||
        t.startsWith("</")
      ) {
        out.push(t);
      } else {
        out.push(`<p>${t}</p>`);
      }
    }
  }
  if (inUl) out.push("</ul>");
  if (inOl) out.push("</ol>");

  return out.join("\n");
}

// ── HTML document builder ─────────────────────────────────────────────────────

function buildHtmlDocument(
  contentHtml: string,
  companyName: string,
  websiteUrl: string,
  serviceType: "seo" | "website",
  auditDate: string
): string {
  const auditTitle =
    serviceType === "seo" ? "SEO & Search Rankings Audit" : "Website & Conversion Audit";
  const auditBadge =
    serviceType === "seo" ? "SEO Audit" : "Website Audit";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${auditTitle} — ${companyName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    /* ── Reset ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Document shell ─────────────────────────────────── */
    body {
      background: #eef2f7;
      font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont,
                   'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.75;
      color: #1e2a38;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .document {
      max-width: 960px;
      margin: 0 auto;
      background: #ffffff;
      box-shadow: 0 8px 60px rgba(0,0,0,0.14);
    }

    /* ── Cover page ─────────────────────────────────────── */
    .cover {
      background: linear-gradient(135deg, #080e1a 0%, #0f1e35 55%, #081525 100%);
      padding: 80px 72px 64px;
      position: relative;
      overflow: hidden;
    }

    /* Decorative circles */
    .cover::before {
      content: '';
      position: absolute;
      top: -100px; right: -100px;
      width: 440px; height: 440px;
      border: 2px solid rgba(229,57,53,0.15);
      border-radius: 50%;
      pointer-events: none;
    }
    .cover::after {
      content: '';
      position: absolute;
      bottom: -60px; left: -60px;
      width: 280px; height: 280px;
      border: 1px solid rgba(255,255,255,0.03);
      border-radius: 50%;
      pointer-events: none;
    }

    .cover-agency {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 3.5px;
      text-transform: uppercase;
      color: #E53935;
      margin-bottom: 10px;
      position: relative;
      z-index: 1;
    }

    .cover-badge {
      display: inline-block;
      background: rgba(229,57,53,0.1);
      border: 1px solid rgba(229,57,53,0.3);
      color: #ef9a9a;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      padding: 6px 16px;
      border-radius: 24px;
      margin-bottom: 32px;
      position: relative;
      z-index: 1;
    }

    .cover-company {
      font-size: 48px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.05;
      margin-bottom: 10px;
      letter-spacing: -1px;
      position: relative;
      z-index: 1;
    }

    .cover-title {
      font-size: 16px;
      font-weight: 300;
      color: #5d8ab8;
      margin-bottom: 44px;
      position: relative;
      z-index: 1;
    }

    .cover-line {
      width: 64px;
      height: 3px;
      background: linear-gradient(to right, #E53935, rgba(229,57,53,0.2));
      margin-bottom: 40px;
      position: relative;
      z-index: 1;
    }

    .cover-meta {
      display: flex;
      gap: 48px;
      flex-wrap: wrap;
      position: relative;
      z-index: 1;
    }

    .cover-meta-item {
      color: #4a6a8a;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
    }

    .cover-meta-item span {
      display: block;
      color: #a8c4dd;
      font-size: 13px;
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
      margin-top: 4px;
    }

    /* ── Content area ───────────────────────────────────── */
    .content {
      padding: 64px 72px 80px;
    }

    /* ── Headings ───────────────────────────────────────── */
    h1 {
      font-size: 25px;
      font-weight: 700;
      color: #080e1a;
      margin: 64px 0 20px;
      padding-bottom: 16px;
      border-bottom: 3px solid #E53935;
      line-height: 1.2;
      letter-spacing: -0.3px;
    }
    h1:first-child { margin-top: 0; }

    h2 {
      font-size: 18px;
      font-weight: 600;
      color: #1e2a38;
      margin: 44px 0 14px;
      padding-left: 18px;
      border-left: 4px solid #E53935;
      line-height: 1.3;
    }

    h3 {
      font-size: 15px;
      font-weight: 600;
      color: #2d3f52;
      margin: 34px 0 10px;
      padding-left: 14px;
      border-left: 2px solid #e5e7eb;
    }

    h4 {
      font-size: 11px;
      font-weight: 700;
      color: #7a90a8;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      margin: 26px 0 8px;
    }

    /* ── Body text ──────────────────────────────────────── */
    p {
      margin-bottom: 18px;
      color: #374151;
      font-size: 15px;
    }

    strong { font-weight: 600; color: #1e2a38; }
    em     { font-style: italic; color: #4b5563; }

    code {
      font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
      font-size: 12.5px;
      background: #f1f5f9;
      color: #c0392b;
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }

    hr {
      border: none;
      height: 1px;
      background: linear-gradient(to right, #e53935 0%, #e2e8f0 40%, transparent 100%);
      margin: 56px 0;
    }

    /* ── Lists ──────────────────────────────────────────── */
    ul {
      margin: 14px 0 24px;
      padding: 0;
      list-style: none;
    }
    ul li {
      padding: 6px 0 6px 28px;
      position: relative;
      color: #374151;
      font-size: 15px;
    }
    ul li::before {
      content: '→';
      position: absolute;
      left: 0;
      color: #E53935;
      font-weight: 700;
      font-size: 14px;
    }

    ol {
      margin: 14px 0 24px 26px;
    }
    ol li {
      padding: 5px 0;
      color: #374151;
      font-size: 15px;
    }
    ol li::marker {
      color: #E53935;
      font-weight: 600;
    }

    /* ── Tables ─────────────────────────────────────────── */
    .table-wrap {
      margin: 28px 0 40px;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 16px rgba(0,0,0,0.08);
      border: 1px solid #e5eaf0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13.5px;
    }

    thead tr {
      background: #080e1a;
    }
    thead th {
      padding: 14px 18px;
      text-align: left;
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #a8c4dd;
      white-space: nowrap;
    }

    tbody tr:nth-child(odd)  { background: #ffffff; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tbody tr:hover           { background: #fff5f5; transition: background 0.15s ease; }
    tbody td {
      padding: 13px 18px;
      border-bottom: 1px solid #f0f4f8;
      color: #374151;
      vertical-align: top;
      line-height: 1.6;
    }
    tbody tr:last-child td { border-bottom: none; }

    /* ── Severity / status badges ───────────────────────── */
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      vertical-align: middle;
      line-height: 1.5;
    }
    .badge-high   { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
    .badge-medium { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .badge-low    { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
    .badge-info   { background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; }

    /* ── Footer ─────────────────────────────────────────── */
    .footer {
      background: #080e1a;
      padding: 28px 72px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .footer-brand {
      color: #ffffff;
      font-weight: 800;
      font-size: 12px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .footer-sub {
      color: #3d5a78;
      font-size: 10px;
      margin-top: 3px;
      letter-spacing: 0.5px;
    }
    .footer-info {
      color: #3d5a78;
      font-size: 11px;
      text-align: right;
      line-height: 1.6;
    }

    /* ── Print ──────────────────────────────────────────── */
    @media print {
      body           { background: #fff; }
      .document      { box-shadow: none; max-width: 100%; }
      .cover         { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .table-wrap    { box-shadow: none; page-break-inside: avoid; }
      h1             { page-break-before: auto; }
      .footer        { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="document">

    <!-- Cover ---------------------------------------------------------- -->
    <div class="cover">
      <div class="cover-agency">The Dare Network</div>
      <div class="cover-badge">${auditBadge}</div>
      <div class="cover-company">${escapeHtml(companyName)}</div>
      <div class="cover-title">${escapeHtml(auditTitle)}</div>
      <div class="cover-line"></div>
      <div class="cover-meta">
        <div class="cover-meta-item">Website<span>${escapeHtml(websiteUrl)}</span></div>
        <div class="cover-meta-item">Prepared by<span>The Dare Network</span></div>
        <div class="cover-meta-item">Date<span>${escapeHtml(auditDate)}</span></div>
        <div class="cover-meta-item">Classification<span>Confidential</span></div>
      </div>
    </div>

    <!-- Content -------------------------------------------------------- -->
    <div class="content">
      ${contentHtml}
    </div>

    <!-- Footer --------------------------------------------------------- -->
    <div class="footer">
      <div>
        <div class="footer-brand">The Dare Network</div>
        <div class="footer-sub">Growth Marketing &amp; Conversion Optimisation</div>
      </div>
      <div class="footer-info">
        Prepared for ${escapeHtml(companyName)}<br/>
        &copy; ${new Date().getFullYear()} The Dare Network. Confidential.
      </div>
    </div>

  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Google Drive-optimised HTML ───────────────────────────────────────────────
// Google Drive strips external CSS and class-based styles when converting HTML
// to a Google Doc. This builder uses ONLY inline styles + semantic tags so the
// heading hierarchy, table formatting, and text colours all survive the import.

function markdownToGoogleDocHtml(md: string): string {
  let html = md;

  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Severity / priority / status labels → inline-coloured spans
  const hi  = 'style="color:#b91c1c;font-weight:700;background:#fee2e2;padding:1px 7px;border-radius:3px"';
  const med = 'style="color:#92400e;font-weight:700;background:#fef3c7;padding:1px 7px;border-radius:3px"';
  const lo  = 'style="color:#166534;font-weight:700;background:#dcfce7;padding:1px 7px;border-radius:3px"';

  html = html.replace(/\bSeverity:\s*High\b/gi,    `Severity: <span ${hi}>High</span>`);
  html = html.replace(/\bSeverity:\s*Medium\b/gi,  `Severity: <span ${med}>Medium</span>`);
  html = html.replace(/\bSeverity:\s*Low\b/gi,     `Severity: <span ${lo}>Low</span>`);
  html = html.replace(/\bPriority:\s*High\b/gi,    `Priority: <span ${hi}>High</span>`);
  html = html.replace(/\bPriority:\s*Medium\b/gi,  `Priority: <span ${med}>Medium</span>`);
  html = html.replace(/\bPriority:\s*Low\b/gi,     `Priority: <span ${lo}>Low</span>`);
  html = html.replace(/\bStatus:\s*Critical\b/gi,  `Status: <span ${hi}>Critical</span>`);
  html = html.replace(/\bStatus:\s*Pass\b/gi,      `Status: <span ${lo}>Pass</span>`);
  html = html.replace(/\bStatus:\s*Fail\b/gi,      `Status: <span ${hi}>Fail</span>`);
  html = html.replace(/\bStatus:\s*Warning\b/gi,   `Status: <span ${med}>Warning</span>`);

  // Headings — Drive maps h1-h4 directly to its Heading 1-4 styles
  html = html.replace(/^# (.*?)$/gm,    '<h1 style="color:#080e1a;font-size:18pt;border-bottom:2px solid #E53935;padding-bottom:6px;margin-top:32pt">$1</h1>');
  html = html.replace(/^## (.*?)$/gm,   '<h2 style="color:#1e2a38;font-size:14pt;border-left:4px solid #E53935;padding-left:10px;margin-top:22pt">$1</h2>');
  html = html.replace(/^### (.*?)$/gm,  '<h3 style="color:#2d3f52;font-size:12pt;margin-top:14pt">$1</h3>');
  html = html.replace(/^#### (.*?)$/gm, '<h4 style="color:#7a90a8;font-size:10pt;text-transform:uppercase;letter-spacing:1px;margin-top:10pt">$1</h4>');

  // Inline formatting
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight:700;color:#1e2a38">$1</strong>');
  html = html.replace(/\*(.*?)\*/g,     '<em style="font-style:italic;color:#4b5563">$1</em>');
  html = html.replace(/`(.*?)`/g,       '<code style="font-family:monospace;font-size:11pt;background:#f1f5f9;color:#c0392b;padding:1px 5px;border-radius:3px">$1</code>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:2px solid #e5eaf0;margin:32pt 0">');
  html = html.replace(/^___$/gm, '<hr style="border:none;border-top:2px solid #e5eaf0;margin:32pt 0">');

  // Tables — inline styles on every element so Drive preserves them
  html = html.replace(/((?:\|.*\|\n)+)/g, (block) => {
    const rows = block
      .trim()
      .split("\n")
      .filter((r) => !/^\|[-|: ]+\|$/.test(r.trim()));
    if (rows.length === 0) return block;

    const [headerRow, ...bodyRows] = rows;

    const th = headerRow
      .split("|")
      .filter((_, i, a) => i > 0 && i < a.length - 1)
      .map((c) =>
        `<th style="background-color:#080e1a;color:#ffffff;padding:10px 14px;text-align:left;font-size:10pt;font-weight:600;white-space:nowrap">${c.trim()}</th>`
      )
      .join("");

    const tbody = bodyRows
      .map((row, rowIdx) => {
        const bg = rowIdx % 2 === 1 ? 'background-color:#f8fafc;' : '';
        const tds = row
          .split("|")
          .filter((_, i, a) => i > 0 && i < a.length - 1)
          .map((c) =>
            `<td style="${bg}padding:10px 14px;border-bottom:1px solid #e5eaf0;font-size:11pt;vertical-align:top;color:#374151">${c.trim()}</td>`
          )
          .join("");
        return `<tr>${tds}</tr>`;
      })
      .join("\n");

    return (
      `<div style="margin:20px 0;overflow-x:auto">` +
      `<table style="border-collapse:collapse;width:100%;font-size:11pt">` +
      `<thead><tr style="background-color:#080e1a">${th}</tr></thead>` +
      `<tbody>${tbody}</tbody>` +
      `</table></div>\n`
    );
  });

  // Lists
  const lines = html.split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  for (const line of lines) {
    const t = line.trim();
    const isUl = t.startsWith("- ") || t.startsWith("* ");
    const isOl = /^\d+\.\s/.test(t);

    if (isUl) {
      if (!inUl) { if (inOl) { out.push("</ol>"); inOl = false; } inUl = true; out.push('<ul style="margin:10px 0 16px;padding-left:24px">'); }
      out.push(`<li style="color:#374151;font-size:11pt;margin:4px 0">${t.slice(2)}</li>`);
    } else if (isOl) {
      if (!inOl) { if (inUl) { out.push("</ul>"); inUl = false; } inOl = true; out.push('<ol style="margin:10px 0 16px;padding-left:24px">'); }
      out.push(`<li style="color:#374151;font-size:11pt;margin:4px 0">${t.replace(/^\d+\.\s/, "")}</li>`);
    } else {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (inOl) { out.push("</ol>"); inOl = false; }

      if (t === "") {
        out.push("");
      } else if (
        t.startsWith("<h") || t.startsWith("<div") || t.startsWith("<table") ||
        t.startsWith("<ul") || t.startsWith("<ol") || t.startsWith("</") || t.startsWith("<hr")
      ) {
        out.push(t);
      } else {
        out.push(`<p style="font-size:11pt;color:#374151;line-height:1.7;margin-bottom:10px">${t}</p>`);
      }
    }
  }
  if (inUl) out.push("</ul>");
  if (inOl) out.push("</ol>");

  return out.join("\n");
}

function buildGoogleDocHtml(
  contentHtml: string,
  companyName: string,
  websiteUrl: string,
  serviceType: "seo" | "website",
  auditDate: string
): string {
  const auditTitle =
    serviceType === "seo" ? "SEO &amp; Search Rankings Audit" : "Website &amp; Conversion Audit";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:0;color:#374151">

<!-- ── Cover ── -->
<table style="width:100%;border-collapse:collapse;margin-bottom:48px">
  <tr>
    <td style="background-color:#080e1a;padding:56px 64px 48px">
      <p style="margin:0 0 12px;font-size:9pt;font-weight:700;color:#E53935;letter-spacing:3px">THE DARE NETWORK</p>
      <p style="margin:0 0 10px;font-size:34pt;font-weight:700;color:#ffffff;line-height:1.05">${escapeHtml(companyName)}</p>
      <p style="margin:0 0 36px;font-size:13pt;color:#5d8ab8;font-style:italic">${auditTitle}</p>
      <table style="border-collapse:collapse;width:auto">
        <tr>
          <td style="padding:0 32px 0 0;border-right:1px solid rgba(255,255,255,0.1)">
            <p style="margin:0;font-size:8pt;font-weight:700;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px">Website</p>
            <p style="margin:4px 0 0;font-size:11pt;color:#a8c4dd">${escapeHtml(websiteUrl)}</p>
          </td>
          <td style="padding:0 32px;border-right:1px solid rgba(255,255,255,0.1)">
            <p style="margin:0;font-size:8pt;font-weight:700;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px">Prepared By</p>
            <p style="margin:4px 0 0;font-size:11pt;color:#a8c4dd">The Dare Network</p>
          </td>
          <td style="padding:0 32px;border-right:1px solid rgba(255,255,255,0.1)">
            <p style="margin:0;font-size:8pt;font-weight:700;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px">Date</p>
            <p style="margin:4px 0 0;font-size:11pt;color:#a8c4dd">${escapeHtml(auditDate)}</p>
          </td>
          <td style="padding:0 0 0 32px">
            <p style="margin:0;font-size:8pt;font-weight:700;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px">Classification</p>
            <p style="margin:4px 0 0;font-size:11pt;color:#a8c4dd">Confidential</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- ── Content ── -->
<div style="padding:0 8px">
${contentHtml}
</div>

<!-- ── Footer ── -->
<table style="width:100%;border-collapse:collapse;margin-top:64px;border-top:2px solid #e5eaf0">
  <tr>
    <td style="background-color:#080e1a;padding:24px 48px">
      <p style="margin:0;font-size:11pt;font-weight:700;color:#ffffff;letter-spacing:2px">THE DARE NETWORK</p>
      <p style="margin:4px 0 0;font-size:9pt;color:#3d5a78">Growth Marketing &amp; Conversion Optimisation</p>
    </td>
    <td style="background-color:#080e1a;padding:24px 48px;text-align:right">
      <p style="margin:0;font-size:9pt;color:#3d5a78">Prepared for ${escapeHtml(companyName)}</p>
      <p style="margin:4px 0 0;font-size:9pt;color:#3d5a78">&copy; ${new Date().getFullYear()} The Dare Network. Confidential.</p>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// ── Trigger.dev task ─────────────────────────────────────────────────────────

export const auditGenerate = task({
  id: "audit-generate",
  maxDuration: 600,
  retry: { maxAttempts: 1 },

  run: async (payload: AuditTaskPayload) => {
    logger.info("Audit started", {
      leadId: payload.leadId,
      websiteUrl: payload.websiteUrl,
      serviceType: payload.serviceType,
    });

    // ── Fetch PageSpeed data (non-blocking — audit continues even if it fails) ──
    let pageSpeedData: string | undefined;
    try {
      logger.info("Fetching PageSpeed Insights data", { url: payload.websiteUrl });
      const psData = await fetchPageSpeedData(payload.websiteUrl);
      pageSpeedData = formatPageSpeedForPrompt(psData);
      logger.info("PageSpeed fetched", {
        mobile:  psData.mobile.score,
        desktop: psData.desktop.score,
      });
    } catch (err) {
      logger.warn("PageSpeed fetch failed — continuing without it", { error: String(err) });
    }

    // Generate audit markdown
    let auditMarkdown: string;

    if (payload.serviceType === "seo") {
      logger.info("Calling generateSEOAudit", { leadId: payload.leadId });
      auditMarkdown = await generateSEOAudit({
        websiteUrl:    payload.websiteUrl,
        companyName:   payload.companyName,
        industry:      payload.industry,
        location:      payload.location,
        targetMarket:  payload.targetMarket,
        services:      payload.services,
        pageSpeedData,
      });
    } else {
      logger.info("Calling generateWebsiteAudit", { leadId: payload.leadId });
      auditMarkdown = await generateWebsiteAudit({
        websiteUrl:      payload.websiteUrl,
        companyName:     payload.companyName,
        industry:        payload.industry,
        primaryAudience: payload.primaryAudience ?? "",
        currentGoal:     payload.currentGoal ?? "",
        competitors:     payload.competitors,
        pageSpeedData,
      });
    }

    logger.info("Audit markdown generated", {
      leadId: payload.leadId,
      chars: auditMarkdown.length,
    });

    // Build HTML document
    const auditDate = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    // Styled HTML (local inspection / PDF fallback)
    const contentHtml = markdownToHtml(auditMarkdown);
    const htmlContent = buildHtmlDocument(
      contentHtml,
      payload.companyName,
      payload.websiteUrl,
      payload.serviceType,
      auditDate
    );

    // Drive-optimised HTML (fallback — kept for reference)
    const googleDocContent = markdownToGoogleDocHtml(auditMarkdown);
    const googleDocHtml = buildGoogleDocHtml(
      googleDocContent,
      payload.companyName,
      payload.websiteUrl,
      payload.serviceType,
      auditDate
    );

    // Native .docx — full formatting, dark cover, styled tables, page header/footer
    logger.info("Building .docx document", { leadId: payload.leadId });
    const docxBuffer = await buildAuditDocx(
      auditMarkdown,
      payload.companyName,
      payload.websiteUrl,
      payload.serviceType,
      auditDate
    );
    logger.info("DOCX built", { bytes: docxBuffer.length });

    // Save to /tmp/audits/ for local inspection
    const outputDir = "/tmp/audits";
    await fs.mkdir(outputDir, { recursive: true });
    const filename = `${payload.leadId}-${payload.serviceType}-audit.html`;
    const filePath = path.join(outputDir, filename);
    await fs.writeFile(filePath, htmlContent, "utf8");

    logger.info("Audit saved", { leadId: payload.leadId, filePath, htmlBytes: htmlContent.length });

    // Encode docx as base64 string so it can cross the task boundary
    const docxBase64 = docxBuffer.toString("base64");

    return {
      success:      true,
      leadId:       payload.leadId,
      filePath,
      filename,
      serviceType:  payload.serviceType,
      auditLength:  auditMarkdown.length,
      auditMarkdown,
      htmlContent,
      googleDocHtml,
      docxBase64,   // native .docx for uploading to Drive
    };
  },
});
