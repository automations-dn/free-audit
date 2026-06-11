/**
 * Google PageSpeed Insights API — free, verified performance data
 *
 * Free tier: ~25 requests/day per IP without a key.
 * With PAGESPEED_API_KEY (free Google Cloud API key): 25,000/day.
 *
 * Get a key: console.cloud.google.com → Enable "PageSpeed Insights API" →
 * APIs & Services → Credentials → Create API Key
 */

export interface PageSpeedMetrics {
  score: number;             // 0–100
  fcp: string;               // First Contentful Paint
  lcp: string;               // Largest Contentful Paint
  tbt: string;               // Total Blocking Time
  cls: string;               // Cumulative Layout Shift
  speedIndex: string;
  tti: string;               // Time to Interactive
  opportunities: string[];   // Top issues with estimated savings
  fieldData?: string;        // Real-user CrUX data if available
}

export interface PageSpeedData {
  url: string;
  mobile: PageSpeedMetrics;
  desktop: PageSpeedMetrics;
  fetchedAt: string;
}

const API_BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

function rating(score: number | null): string {
  if (score === null) return "N/A";
  if (score >= 90) return "Good";
  if (score >= 50) return "Needs Improvement";
  return "Poor";
}

function auditVal(audits: Record<string, any>, id: string): string {
  return audits?.[id]?.displayValue ?? "N/A";
}

function extractOpportunities(audits: Record<string, any>): string[] {
  const ops: Array<{ title: string; savings: number }> = [];
  for (const audit of Object.values(audits)) {
    const a = audit as any;
    if (
      a.details?.type === "opportunity" &&
      typeof a.details.overallSavingsMs === "number" &&
      a.details.overallSavingsMs > 300 &&
      a.title
    ) {
      ops.push({
        title:   a.title,
        savings: Math.round(a.details.overallSavingsMs),
      });
    }
  }
  return ops
    .sort((a, b) => b.savings - a.savings)
    .slice(0, 6)
    .map((o) => `${o.title} — save ~${(o.savings / 1000).toFixed(1)} s`);
}

function extractFieldData(lhr: any): string | undefined {
  const lce = lhr?.loadingExperience;
  if (!lce?.overall_category) return undefined;
  const cat = lce.overall_category; // FAST | AVERAGE | SLOW
  const lcpFE = lce.metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
  const clsFE = lce.metrics?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
  const fidFE = lce.metrics?.FIRST_INPUT_DELAY_MS?.percentile;
  const parts: string[] = [`Overall: ${cat}`];
  if (lcpFE !== undefined) parts.push(`Real-user LCP: ${(lcpFE / 1000).toFixed(1)} s`);
  if (clsFE !== undefined) parts.push(`Real-user CLS: ${(clsFE / 100).toFixed(2)}`);
  if (fidFE !== undefined) parts.push(`Real-user FID: ${fidFE} ms`);
  return parts.join(" | ");
}

async function fetchStrategy(url: string, strategy: "mobile" | "desktop"): Promise<PageSpeedMetrics> {
  const apiKey = process.env.PAGESPEED_API_KEY;
  const endpoint =
    `${API_BASE}?url=${encodeURIComponent(url)}&strategy=${strategy}` +
    `&category=performance` +
    (apiKey ? `&key=${apiKey}` : "");

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PageSpeed API ${strategy} failed (HTTP ${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const lhr    = data.lighthouseResult;
  const cats   = lhr?.categories;
  const audits = lhr?.audits ?? {};

  const rawScore = cats?.performance?.score ?? null;
  const score    = rawScore !== null ? Math.round(rawScore * 100) : 0;

  return {
    score,
    fcp:         auditVal(audits, "first-contentful-paint"),
    lcp:         auditVal(audits, "largest-contentful-paint"),
    tbt:         auditVal(audits, "total-blocking-time"),
    cls:         auditVal(audits, "cumulative-layout-shift"),
    speedIndex:  auditVal(audits, "speed-index"),
    tti:         auditVal(audits, "interactive"),
    opportunities: extractOpportunities(audits),
    fieldData:   extractFieldData(lhr),
  };
}

export async function fetchPageSpeedData(url: string): Promise<PageSpeedData> {
  console.log(`Fetching PageSpeed data for: ${url}`);

  // Fetch mobile and desktop in parallel — regular fetch calls, not Trigger.dev waits
  const [mobile, desktop] = await Promise.all([
    fetchStrategy(url, "mobile"),
    fetchStrategy(url, "desktop"),
  ]);

  console.log(`PageSpeed — mobile: ${mobile.score}/100, desktop: ${desktop.score}/100`);
  return { url, mobile, desktop, fetchedAt: new Date().toISOString() };
}

export function formatPageSpeedForPrompt(data: PageSpeedData): string {
  function section(label: string, m: PageSpeedMetrics): string {
    const lines = [
      `### ${label} — Score: ${m.score}/100 (${rating(m.score)})`,
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| First Contentful Paint | ${m.fcp} |`,
      `| Largest Contentful Paint | ${m.lcp} |`,
      `| Total Blocking Time | ${m.tbt} |`,
      `| Cumulative Layout Shift | ${m.cls} |`,
      `| Speed Index | ${m.speedIndex} |`,
      `| Time to Interactive | ${m.tti} |`,
    ];

    if (m.fieldData) {
      lines.push("", `**Real-user field data (CrUX):** ${m.fieldData}`);
    }

    if (m.opportunities.length > 0) {
      lines.push("", "**Top Performance Issues:**");
      m.opportunities.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
    }

    return lines.join("\n");
  }

  return [
    `## VERIFIED PAGESPEED INSIGHTS DATA`,
    `*Measured by Google PageSpeed Insights on ${new Date(data.fetchedAt).toDateString()}*`,
    `*URL tested: ${data.url}*`,
    "",
    "**IMPORTANT: These are real, verified numbers from Google. Reference them verbatim in the Core Web Vitals and Technical Performance sections of your audit. Do not substitute or approximate.**",
    "",
    section("Mobile Performance", data.mobile),
    "",
    section("Desktop Performance", data.desktop),
  ].join("\n");
}
