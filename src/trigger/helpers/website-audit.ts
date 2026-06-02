import Anthropic from "@anthropic-ai/sdk";

export interface AuditInput {
  websiteUrl: string;
  companyName: string;
  industry: string;
  primaryAudience: string;
  currentGoal: string;
  competitors?: string;
}

const SYSTEM_PROMPT = `You are a senior website strategist and UX consultant at a digital agency. You have 12 years of experience auditing websites for B2B manufacturers, service businesses, and e-commerce brands. You think architecturally — audience clarity, information hierarchy, trust signal placement, conversion mechanics. You write reports that are specific, diagnostic, and immediately actionable. You read websites carefully before drawing conclusions.`;

export async function generateWebsiteAudit(input: AuditInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const { websiteUrl, companyName, industry, primaryAudience, currentGoal, competitors } = input;

  const userPrompt = `You are conducting a website strategy audit for ${companyName}, a ${industry} business. Their primary audience is ${primaryAudience}. Their current goal: ${currentGoal}. ${competitors ? 'Key competitors to reference: ' + competitors : ''} Website to audit: ${websiteUrl}

STEP 1 — READ THE WEBSITE CAREFULLY
Fetch and read the full website at ${websiteUrl}. Read every accessible page. Note carefully:
- The exact headline text on the homepage hero
- Every item in the main navigation bar
- What the primary CTA buttons say and where they link
- The trust signals visible (testimonials, client logos, certifications, awards, case studies)
- The footer content including address, phone, email, copyright year
- Product or service page structure and content depth
- Any broken elements, placeholder content, or inconsistencies
- The overall visual and structural impression
- What audience the site appears to be speaking to

STEP 2 — WRITE THE AUDIT REPORT
Produce a complete website strategy and audit report. Quote actual copy throughout. Name actual page elements. Be specific.

---

EXECUTIVE SUMMARY
3 to 4 paragraphs as narrative prose. Cover: the current situation, the key architectural or strategic problem, your recommendation in one sentence, and what the engagement would achieve. No bullet points here.

---

PART I — DIAGNOSIS

### Section 1: What we reviewed
Brief bullet list of every page you accessed and read.

### Section 2: Audit findings
A table with columns: Element | Current state | Issue | Impact on buyer

Rows for each of the following — quote actual content found:
- Hero and positioning (quote the actual headline)
- Navigation (list the actual nav items you found)
- Primary CTA (quote the actual button text and note where it links)
- Trust signals (what is present and what is absent)
- Product or service presentation
- Gallery or portfolio
- About page
- Contact and enquiry mechanics
- Design and typography impression
- Mobile experience impression
- Footer and credibility signals (quote the actual footer copy)
- Any broken elements or placeholders found

### Section 3: Key takeaway
One paragraph. The single most important finding from the audit.

### Section 4: The pattern beneath
What is the root structural problem that explains most of the individual issues? Name it clearly. Give 2 to 3 sentences explaining why it causes the symptoms you found.

---

PART II — STRATEGIC RECOMMENDATION

### Section 5: Architectural recommendation
Answer: does this site need a structural rebuild, a refresh, or a repositioning? Why? Be direct. If there is an audience conflict (site trying to serve too many audiences), name it explicitly.

### Section 6: Brand and positioning reframe
A table: Attribute | Current | Recommended
Rows: Primary audience, Positioning line, Geographic focus, Lead trust signals, Primary CTA, Tone of voice, Photography style, Content cadence.

### Section 7: What changes specifically
Two or three sub-sections based on what the site needs. For each change, name the specific element and what it becomes.

---

PART III — THE BUILD

### Section 8: Information architecture
Write out the recommended site map as a structured hierarchy. Top-level nav items and their sub-pages. Keep it to 6 top-level items maximum.

### Section 9: Homepage block structure
Number each content block. For each: block number, block name, what it contains, what specific buyer question it answers. Include every block from hero to footer.

### Section 10: Key page types
A table: Page type | Required content blocks

Include: each main service or product page template, About page, Contact page, and any industry or location pages recommended.

### Section 11: Design direction
A table: Element | Principle | What to avoid
Rows: Colour palette, Typography, Photography, Layout, CTAs, Motion.

### Section 12: Trust signals and lead capture
Table: Trust signal | Priority (Required / Recommended) | Current status | Action needed

Include: certifications, case studies, testimonials, contact mechanisms, form structure, response commitment.

---

PART IV — ENGAGEMENT

### Section 13: Phased roadmap
Phases in sequence. For each phase: name, week range, specific task list.

### Section 14: What we need from you
Grouped list: Access, Business content, Credibility assets, Visual assets, Language considerations.

### Section 15: Open questions
A numbered list of the most important things you need the client to answer before the build begins.`;

  try {
    const anthropic = new Anthropic({ apiKey });

    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
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

    const textBlocks = response.content.filter((b) => b.type === "text");
    const text = textBlocks.map((b) => (b as any).text as string).join("\n");

    if (!text) throw new Error("Received empty response from Claude API");

    return text;
  } catch (error) {
    console.error("generateWebsiteAudit error:", error);
    throw error;
  }
}


