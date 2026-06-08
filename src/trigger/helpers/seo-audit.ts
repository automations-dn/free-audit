import Anthropic from "@anthropic-ai/sdk";

export interface AuditInput {
  websiteUrl: string;
  companyName: string;
  industry: string;
  location: string;
  targetMarket: string;
  services: string;
}

const SYSTEM_PROMPT = `You are a senior SEO strategist at a digital marketing agency with 12 years of experience auditing websites across B2B, logistics, e-commerce, and service businesses. You write audit reports that are specific, honest, and grounded in what you actually see on the site — never generic. Every finding references actual copy, actual URLs, actual page elements. You are also a skilled web researcher and you read websites carefully before writing anything.`;

export async function generateSEOAudit(input: AuditInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const { websiteUrl, companyName, industry, location, targetMarket, services } = input;

  const userPrompt = `You are conducting a professional SEO audit for ${companyName}, a ${industry} business based in ${location} targeting ${targetMarket}. Their services include: ${services}. Their website is: ${websiteUrl}

STEP 1 — READ THE WEBSITE CAREFULLY
Before writing anything, fetch and read the following pages from ${websiteUrl}:
- The homepage
- The about page (try /about, /about-us)
- At least 3 service or product pages
- The contact page
Read every page carefully. Note the actual H1 tags, meta titles, navigation items, body copy word counts, CTA button text, footer content, phone numbers, addresses, and any broken elements or placeholder text you see.

STEP 2 — WRITE THE AUDIT
After reading the site, produce a complete SEO audit report with the following sections. Be specific throughout — quote actual copy you found, name actual URLs, cite actual word counts.

## 1. Executive Summary
Write 3 to 4 paragraphs as a narrative. Cover: the current SEO state of the site, the single biggest blocker, the realistic near-term opportunity given the market, and what must happen first. Do not use bullet points in this section.

## 2. Site Snapshot
A table with these rows: Company name | Website | Industry | Location | Target market | Estimated organic visibility | Pages found on crawl | Mobile performance impression | Backlink profile impression

## 3. Technical SEO Audit
A table with columns: Issue | Severity (CRITICAL / MODERATE / LOW) | What you found | Why it matters | Fix required

Include a row for every item below regardless of whether it is a problem or not. If something looks fine, say so:
- Page title tag (is it keyword-optimised or generic?)
- Meta description (present, optimised, or missing?)
- H1 tag (is there one, is it clear, does it match the page topic?)
- H2 structure (logical hierarchy or random?)
- Copyright year in footer (current year or stale?)
- Broken counter or placeholder elements (0+, dummy text, Lorem ipsum)
- NAP consistency (does the address in the header match the footer and contact page?)
- Image alt text (descriptive or all the same generic phrase?)
- Schema markup (LocalBusiness, Service, FAQ, Organization detected or absent?)
- XML sitemap (likely present or absent based on what you see?)
- Internal linking (are service pages linked to each other?)
- URL structure (clean slugs or ugly query strings like ?cat=?)
- Mobile friendliness impression
- Page speed impression
- HTTPS

## 4. On-Page and Content Audit

### Content depth per page
A table: Page | URL | Approximate word count | Verdict (Thin under 300 / Adequate 300 to 800 / Strong over 800)
Include every page you read.

### What every service page is missing
Based on what ranking competitors in ${industry} typically include, list the structural elements absent from the current service pages. Be specific.

### Homepage issues
List specific problems with the actual homepage. Quote the actual headline you found. Quote the actual CTA text. Be specific.

### About page issues
Same treatment as homepage.

### Missing page types entirely
Based on the market and industry, list page types this site does not have that ranking competitors do.

## 5. Local SEO Audit
Report on: NAP consistency (quote the actual address strings you found in different locations on the site), Google Business Profile signals (infer from what is visible), embedding of Google Maps on contact page, local schema markup, and citation presence. List quick wins.

## 6. Competitor Context
Based on the industry, location, and target market, describe what the ranking websites in this space look like — their content depth, trust signals, page types, and backlink profile patterns. Do not make this generic. Ground it in what you know about who would be competing for the same searches as ${companyName}.

## 7. Keyword Strategy
Organise into priority tiers. Label each tier. For each tier: one sentence rationale and a list of 8 to 12 specific keyword phrases. Base keywords on the actual services, location, and market. 

Priority tiers to cover:
- Priority 1: Local commercial (medium competition, high intent)
- Priority 2: Service and location combinations (conversion sweet spot)
- Priority 3: Long-tail and specific (port-specific, neighbourhood-specific, process-specific)
- Priority 4: Informational and blog content (topical authority building)
- Priority 5: Generic national (do not target first — explain why)

## 8. Recommended Roadmap
Four phases. Each phase must have a name, timeframe, and a specific task list. Name actual pages that need to be built. Name actual issues to fix.

Phase 1: Foundation (Days 0 to 30)
Phase 2: Content rebuild (Days 30 to 90)
Phase 3: Content authority (Days 90 to 180)
Phase 4: Authority and backlinks (Days 180 to 365)

## 9. What We Need From You
A specific list of items the client must provide for the work to proceed. Group into: Access, Business content, Credibility assets, Visual assets.

## 10. Honest Timeline and Expectations
A table: Phase | Timeframe | What to expect | What not to expect

Then two short lists: What could accelerate this. What will slow this down.`;

  try {
    const anthropic = new Anthropic({ apiKey });

    const stream = anthropic.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 32000,
      tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });

    const response = await stream.finalMessage();

    const textBlocks = response.content.filter((b) => b.type === "text");
    const text = textBlocks.map((b) => (b as any).text as string).join("\n");

    if (!text) throw new Error("Received empty response from Claude API");

    return text;
  } catch (error) {
    console.error("generateSEOAudit error:", error);
    throw error;
  }
}




