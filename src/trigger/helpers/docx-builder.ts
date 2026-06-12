/**
 * Build a fully-formatted .docx audit report from scratch using the `docx` package.
 *
 * Document structure:
 *   1. Cover page        — dark navy, company name, audit type, date
 *   2. Contents page     — styled table of contents with section numbers
 *   3. Audit content     — each major section (##) gets a full-width dark header block
 *   4. Closing CTA page  — branded call-to-action with contact details
 *
 * Typography:
 *   — Headings: navy (#1), dark block header (##), bold (###), small-caps (####)
 *   — Body: Calibri 11pt, #374151
 *   — Tables: navy header row, alternating body, clean hairline dividers
 *   — Lists: red → arrow bullet, red numbered
 *   — Badges: High/Critical → red, Medium → amber, Low/Pass → green
 *   — Page header: agency | company | audit type — right-aligned "Confidential"
 *   — Page footer: copyright + centered page numbers
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertInchesToTwip,
  TabStopType,
} from "docx";

// ── Design tokens ─────────────────────────────────────────────────────────────

const FONT  = "Calibri";
const NAVY  = "080e1a";
const RED   = "E53935";
const DARK  = "1e2a38";
const BODY  = "374151";
const GRAY  = "7a90a8";
const WHITE = "ffffff";
const BLUE  = "5d8ab8";
const LIGHT = "f8fafc";

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "ffffff" } as const;

// ── Inline text helpers ───────────────────────────────────────────────────────

function bodyRun(text: string)   { return new TextRun({ text, font: FONT, size: 22, color: BODY }); }
function boldRun(text: string)   { return new TextRun({ text, font: FONT, size: 22, bold: true, color: DARK }); }
function italicRun(text: string) { return new TextRun({ text, font: FONT, size: 22, italics: true, color: BODY }); }
function codeRun(text: string)   {
  return new TextRun({ text, font: "Courier New", size: 20, color: "c0392b",
    shading: { type: ShadingType.SOLID, color: "auto", fill: "f1f5f9" } });
}
function badgeRun(text: string): TextRun {
  const up = text.toUpperCase();
  const [fg, fill] =
    /HIGH|CRITICAL|FAIL/.test(up)  ? ["b91c1c", "fee2e2"] :
    /MEDIUM|WARNING/.test(up)      ? ["92400e", "fef3c7"] :
                                     ["166534", "dcfce7"];
  return new TextRun({ text: ` ${text} `, font: FONT, size: 20, bold: true, color: fg,
    shading: { type: ShadingType.SOLID, color: "auto", fill } });
}

// ── Markdown inline parser ────────────────────────────────────────────────────

export function parseInline(raw: string): TextRun[] {
  if (!raw.trim()) return [bodyRun(" ")];

  const runs: TextRun[] = [];
  const re = /(\*\*(.*?)\*\*|\*(.*?)\*|`(.*?)`|\b(?:Severity|Priority|Status):\s*(?:High|Critical|Fail|Medium|Warning|Low|Pass)\b)/gi;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) runs.push(bodyRun(raw.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("**"))     runs.push(boldRun(tok.slice(2, -2)));
    else if (tok.startsWith("*")) runs.push(italicRun(tok.slice(1, -1)));
    else if (tok.startsWith("`")) runs.push(codeRun(tok.slice(1, -1)));
    else                          runs.push(badgeRun(tok));
    last = m.index + tok.length;
  }
  if (last < raw.length) runs.push(bodyRun(raw.slice(last)));
  return runs.filter((r) => r !== undefined);
}

// ── Table builder ─────────────────────────────────────────────────────────────

function buildTable(lines: string[]): Table {
  const data = lines.filter((l) => !/^\|[-|:\s]+\|$/.test(l.trim()));
  if (!data.length) {
    return new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("")] })] })] });
  }

  const parse = (line: string) =>
    line.split("|").filter((_, i, a) => i > 0 && i < a.length - 1).map((c) => c.trim());

  const [headerLine, ...bodyLines] = data;
  const headers = parse(headerLine);
  const colW    = Math.floor(9360 / Math.max(headers.length, 1));

  const bodyBorder = { style: BorderStyle.SINGLE, size: 1, color: "e5eaf0" } as const;

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) =>
      new TableCell({
        width: { size: colW, type: WidthType.DXA },
        shading: { type: ShadingType.SOLID, color: "auto", fill: NAVY },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
        children: [new Paragraph({
          children: [new TextRun({ text: h, font: FONT, size: 18, bold: true, color: WHITE })],
        })],
      })
    ),
  });

  const bodyRows = bodyLines.map((line, idx) =>
    new TableRow({
      children: parse(line).map((c) =>
        new TableCell({
          width: { size: colW, type: WidthType.DXA },
          shading: { type: ShadingType.SOLID, color: "auto", fill: idx % 2 === 1 ? LIGHT : WHITE },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          borders: { top: NO_BORDER, left: NO_BORDER, right: NO_BORDER, bottom: bodyBorder },
          children: [new Paragraph({
            children: parseInline(c),
            spacing: { line: 300, lineRule: LineRuleType.AUTO },
          })],
        })
      ),
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: {
      top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "e5eaf0" },
      insideVertical: NO_BORDER,
    },
    rows: [headerRow, ...bodyRows],
  });
}

// ── Section header block (## headings) ────────────────────────────────────────
// Full-width dark bar with a red bottom accent. Replaces plain left-bordered
// paragraphs so each major section is visually distinct at a glance.

function buildSectionHeader(title: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.SOLID, color: "auto", fill: DARK },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 160, bottom: 160, left: 240, right: 240 },
            borders: {
              top: NO_BORDER,
              bottom: { style: BorderStyle.SINGLE, size: 8, color: RED, space: 0 },
              left: { style: BorderStyle.SINGLE, size: 28, color: RED, space: 0 },
              right: NO_BORDER,
            },
            children: [
              new Paragraph({
                children: [new TextRun({ text: title, font: FONT, size: 28, bold: true, color: WHITE })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// ── Table of Contents page ────────────────────────────────────────────────────

function buildTocPage(sections: string[]): (Paragraph | Table)[] {
  const els: (Paragraph | Table)[] = [];

  // Section title
  els.push(
    new Paragraph({
      children: [new TextRun({ text: "CONTENTS", font: FONT, size: 36, bold: true, color: NAVY, characterSpacing: 300 })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RED, space: 10 } },
      spacing: { before: 0, after: 480 },
    })
  );

  for (let i = 0; i < sections.length; i++) {
    const num = String(i + 1).padStart(2, "0");
    els.push(
      new Paragraph({
        children: [
          new TextRun({ text: num, font: FONT, size: 22, bold: true, color: RED }),
          new TextRun({ text: "    " + sections[i], font: FONT, size: 22, color: BODY }),
        ],
        spacing: { after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "e5eaf0", space: 8 } },
      })
    );
  }

  // Page break after TOC
  els.push(new Paragraph({ pageBreakBefore: true, children: [new TextRun("")] }));
  return els;
}

// ── Closing CTA page ──────────────────────────────────────────────────────────

function buildClosingPage(): (Paragraph | Table)[] {
  const cta = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.SOLID, color: "auto", fill: NAVY },
            verticalAlign: VerticalAlign.CENTER,
            margins: {
              top:    convertInchesToTwip(1.4),
              bottom: convertInchesToTwip(1.4),
              left:   convertInchesToTwip(0.6),
              right:  convertInchesToTwip(0.6),
            },
            borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
            children: [
              new Paragraph({
                children: [new TextRun({ text: "READY TO TAKE ACTION?", font: FONT, size: 34, bold: true, color: WHITE, characterSpacing: 200 })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 220 },
              }),
              new Paragraph({
                children: [new TextRun({
                  text: "Let's walk through these findings on a call. No pressure — just clarity.",
                  font: FONT, size: 22, italics: true, color: "a8c4dd",
                })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 480 },
              }),
              // Divider
              new Paragraph({
                children: [],
                border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "1e3a5a", space: 0 } },
                spacing: { after: 400 },
              }),
              new Paragraph({
                children: [new TextRun({ text: "seo@thedarenetwork.com", font: FONT, size: 24, color: RED, bold: true })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 160 },
              }),
              new Paragraph({
                children: [new TextRun({ text: "thedarenetwork.com", font: FONT, size: 22, color: BLUE })],
                alignment: AlignmentType.CENTER,
                spacing: { after: 240 },
              }),
              new Paragraph({
                children: [new TextRun({ text: "THE DARE NETWORK", font: FONT, size: 14, bold: true, color: "4a6a8a", characterSpacing: 250 })],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        ],
      }),
    ],
  });

  return [
    new Paragraph({ pageBreakBefore: true, children: [new TextRun("")] }),
    cta,
  ];
}

// ── Cover page ────────────────────────────────────────────────────────────────

function buildCoverPage(company: string, auditType: string, url: string, date: string): (Paragraph | Table)[] {
  const cover = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: "auto", fill: NAVY },
            verticalAlign: VerticalAlign.CENTER,
            margins: {
              top:    convertInchesToTwip(1.4),
              bottom: convertInchesToTwip(1.2),
              left:   convertInchesToTwip(0.5),
              right:  convertInchesToTwip(0.5),
            },
            borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
            children: [
              // Agency label
              new Paragraph({
                children: [new TextRun({ text: "THE DARE NETWORK", font: FONT, size: 16, bold: true, color: RED, characterSpacing: 200 })],
                spacing: { after: 160 },
              }),
              // Company name — large
              new Paragraph({
                children: [new TextRun({ text: company.toUpperCase(), font: FONT, size: 72, bold: true, color: WHITE })],
                spacing: { after: 120 },
              }),
              // Audit type — italic
              new Paragraph({
                children: [new TextRun({ text: auditType, font: FONT, size: 28, italics: true, color: BLUE })],
                spacing: { after: 640 },
              }),
              // Thin rule
              new Paragraph({
                children: [],
                border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "1e3a5a", space: 0 } },
                spacing: { after: 360 },
              }),
              // Metadata row
              new Paragraph({
                children: [
                  new TextRun({ text: "WEBSITE  ",       font: FONT, size: 14, bold: true, color: "4a6a8a", characterSpacing: 80 }),
                  new TextRun({ text: url,               font: FONT, size: 16, color: "a8c4dd" }),
                  new TextRun({ text: "   |   DATE  ",   font: FONT, size: 14, bold: true, color: "4a6a8a", characterSpacing: 80 }),
                  new TextRun({ text: date,              font: FONT, size: 16, color: "a8c4dd" }),
                  new TextRun({ text: "   |   PREPARED BY  ", font: FONT, size: 14, bold: true, color: "4a6a8a", characterSpacing: 80 }),
                  new TextRun({ text: "The Dare Network", font: FONT, size: 16, color: "a8c4dd" }),
                  new TextRun({ text: "   |   CONFIDENTIAL", font: FONT, size: 14, bold: true, color: "4a6a8a", characterSpacing: 80 }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  return [
    cover,
    new Paragraph({ pageBreakBefore: true, children: [new TextRun("")] }),
  ];
}

// ── Extract section titles for TOC ────────────────────────────────────────────

function extractSections(md: string): string[] {
  return md
    .split("\n")
    .filter((l) => /^##\s+/.test(l))
    .map((l) => l.replace(/^##\s+/, "").trim())
    .filter(Boolean);
}

// ── Markdown → docx elements ──────────────────────────────────────────────────

function parseMarkdown(md: string): (Paragraph | Table)[] {
  const els: (Paragraph | Table)[] = [];
  const lines = md.split("\n");
  let i = 0;
  let bullets: string[] = [];
  let numbered: string[] = [];

  const flushBullets = () => {
    for (const item of bullets) {
      els.push(new Paragraph({
        children: parseInline(item),
        numbering: { reference: "bullet-list", level: 0 },
        spacing: { after: 80, line: 300, lineRule: LineRuleType.AUTO },
      }));
    }
    bullets = [];
  };
  const flushNumbered = () => {
    for (const item of numbered) {
      els.push(new Paragraph({
        children: parseInline(item),
        numbering: { reference: "numbered-list", level: 0 },
        spacing: { after: 80, line: 300, lineRule: LineRuleType.AUTO },
      }));
    }
    numbered = [];
  };

  while (i < lines.length) {
    const t = lines[i].trim();

    if (t.startsWith("#### ")) {
      flushBullets(); flushNumbered();
      els.push(new Paragraph({
        children: [new TextRun({ text: t.slice(5).toUpperCase(), font: FONT, size: 18, bold: true, color: GRAY, characterSpacing: 80 })],
        spacing: { before: 240, after: 80 },
      }));

    } else if (t.startsWith("### ")) {
      flushBullets(); flushNumbered();
      els.push(new Paragraph({
        children: [new TextRun({ text: t.slice(4), font: FONT, size: 24, bold: true, color: DARK })],
        spacing: { before: 300, after: 120 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 10 } },
        indent: { left: 200 },
      }));

    } else if (t.startsWith("## ")) {
      flushBullets(); flushNumbered();
      // Full-width dark section header block
      els.push(new Paragraph({ children: [], spacing: { before: 200, after: 0 } }));
      els.push(buildSectionHeader(t.slice(3)));
      els.push(new Paragraph({ children: [], spacing: { after: 200 } }));

    } else if (t.startsWith("# ")) {
      flushBullets(); flushNumbered();
      els.push(new Paragraph({
        children: [new TextRun({ text: t.slice(2), font: FONT, size: 36, bold: true, color: NAVY })],
        spacing: { before: 480, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RED, space: 6 } },
      }));

    } else if (t.startsWith("|") && t.endsWith("|")) {
      flushBullets(); flushNumbered();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      els.push(buildTable(tableLines));
      els.push(new Paragraph({ children: [], spacing: { after: 200 } }));
      continue;

    } else if (t.startsWith("- ") || t.startsWith("* ")) {
      flushNumbered();
      bullets.push(t.slice(2));

    } else if (/^\d+\.\s/.test(t)) {
      flushBullets();
      numbered.push(t.replace(/^\d+\.\s/, ""));

    } else if (t === "---" || t === "___") {
      flushBullets(); flushNumbered();
      els.push(new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "e5eaf0" } },
        spacing: { before: 360, after: 360 },
      }));

    } else if (t === "") {
      flushBullets(); flushNumbered();

    } else {
      flushBullets(); flushNumbered();
      els.push(new Paragraph({
        children: parseInline(t),
        spacing: { after: 160, line: 340, lineRule: LineRuleType.AUTO },
      }));
    }

    i++;
  }

  flushBullets();
  flushNumbered();
  return els;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function buildAuditDocx(
  auditMarkdown: string,
  companyName:   string,
  websiteUrl:    string,
  auditType:     "seo" | "website",
  auditDate:     string
): Promise<Buffer> {
  const auditTitle = auditType === "seo"
    ? "SEO & Search Rankings Audit"
    : "Website & Conversion Audit";

  const sections = extractSections(auditMarkdown);

  const doc = new Document({
    creator:     "The Dare Network",
    title:       `${companyName} — ${auditTitle}`,
    subject:     auditTitle,
    description: `${auditTitle} prepared by The Dare Network`,

    numbering: {
      config: [
        {
          reference: "bullet-list",
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text:   "→",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 480, hanging: 240 } },
              run: { font: FONT, size: 22, color: RED, bold: true },
            },
          }],
        },
        {
          reference: "numbered-list",
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text:   "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 480, hanging: 240 } },
              run: { font: FONT, size: 22, bold: true, color: RED },
            },
          }],
        },
      ],
    },

    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(1),
            right:  convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left:   convertInchesToTwip(1),
          },
        },
      },

      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "The Dare Network  |  ", font: FONT, size: 16, color: GRAY }),
              new TextRun({ text: companyName,            font: FONT, size: 16, bold: true, color: DARK }),
              new TextRun({ text: `  |  ${auditTitle}`,  font: FONT, size: 16, color: GRAY }),
              new TextRun({ text: "\tConfidential",       font: FONT, size: 16, italics: true, color: GRAY }),
            ],
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "e5eaf0", space: 4 } },
            tabStops: [{ type: TabStopType.RIGHT, position: convertInchesToTwip(6.5) }],
          })],
        }),
      },

      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: `© ${new Date().getFullYear()} The Dare Network  |  Confidential  |  Page `, font: FONT, size: 16, color: GRAY }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: GRAY }),
            ],
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: "e5eaf0", space: 4 } },
          })],
        }),
      },

      children: [
        // 1 — Cover page
        ...buildCoverPage(companyName, auditTitle, websiteUrl, auditDate),

        // 2 — Table of contents (only if we found sections)
        ...(sections.length > 0 ? buildTocPage(sections) : []),

        // 3 — Full audit content
        ...parseMarkdown(auditMarkdown),

        // 4 — Closing CTA page
        ...buildClosingPage(),
      ],
    }],
  });

  return Packer.toBuffer(doc);
}
