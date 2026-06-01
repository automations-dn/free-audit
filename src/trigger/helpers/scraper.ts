import * as cheerio from "cheerio";

export interface ScrapedData {
  scraped_pages: string;
  tech_stack: string;
  performance_data: string;
  technical_seo_data: string;
}

/**
 * Scrapes a website's homepage, detects its technology stack, calls Google PageSpeed Insights,
 * and collects technical SEO signals (robots.txt, sitemap, schema, canonicals, meta robots).
 */
export async function scrapeWebsiteAndGetMetrics(url: string): Promise<ScrapedData> {
  console.log(`Scraper starting for: ${url}`);

  let formattedUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    formattedUrl = `https://${url}`;
  }

  // Ensure no trailing slash issues when building adjacent URLs
  const origin = new URL(formattedUrl).origin;

  let scrapedContent = "Data not available";
  let techStack = "Data not available";
  let performanceData = "Data not available";
  let technicalSeoData = "Data not available";

  let html = "";

  // ── 1. Scrape Homepage HTML ──────────────────────────────────────────────
  try {
    const response = await fetch(formattedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      html = await response.text();
      const $ = cheerio.load(html);

      const title = $("title").text().trim() || "No title found";
      const titleLength = title.length;

      const metaDescription =
        $('meta[name="description"]').attr("content")?.trim() || "No meta description found";
      const metaDescLength = metaDescription === "No meta description found" ? 0 : metaDescription.length;

      const canonicalTag = $('link[rel="canonical"]').attr("href")?.trim() || "Not set";

      const metaRobots = $('meta[name="robots"]').attr("content")?.trim() || "Not set (defaults to index, follow)";
      const isNoindex = metaRobots.toLowerCase().includes("noindex");

      const h1Tags: string[] = [];
      $("h1").each((_, el) => {
        const txt = $(el).text().trim();
        if (txt) h1Tags.push(txt);
      });

      const h2Tags: string[] = [];
      $("h2").slice(0, 10).each((_, el) => {
        const txt = $(el).text().trim();
        if (txt) h2Tags.push(txt);
      });

      const h3Tags: string[] = [];
      $("h3").slice(0, 5).each((_, el) => {
        const txt = $(el).text().trim();
        if (txt) h3Tags.push(txt);
      });

      const paragraphs: string[] = [];
      $("p").slice(0, 8).each((_, el) => {
        const txt = $(el).text().trim();
        if (txt && txt.length > 30) paragraphs.push(txt);
      });

      const imageAlts: string[] = [];
      const imagesMissingAlt: number[] = [];
      $("img").slice(0, 10).each((i, el) => {
        const alt = $(el).attr("alt")?.trim();
        if (alt) {
          imageAlts.push(alt);
        } else {
          imagesMissingAlt.push(i + 1);
        }
      });

      // Nav links (top-level menu structure)
      const navLinks: string[] = [];
      $("nav a, header a").slice(0, 12).each((_, el) => {
        const txt = $(el).text().trim();
        if (txt && txt.length > 1 && txt.length < 50) navLinks.push(txt);
      });

      // Internal link count (rough proxy for internal linking depth)
      let internalLinkCount = 0;
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (href.startsWith("/") || href.startsWith(origin)) {
          internalLinkCount++;
        }
      });

      // CTAs — buttons and links with action-oriented text
      const ctaTexts: string[] = [];
      $("a, button").each((_, el) => {
        const txt = $(el).text().trim();
        if (
          txt &&
          txt.length < 60 &&
          /^(get|buy|book|shop|start|try|contact|learn|request|sign|apply|download|schedule|claim)/i.test(txt)
        ) {
          ctaTexts.push(txt);
        }
      });

      scrapedContent = `
PAGE DETAILS:
- Title Tag (${titleLength} chars): "${title}"
- Meta Description (${metaDescLength} chars): "${metaDescription}"
- Canonical Tag: ${canonicalTag}
- Meta Robots: ${metaRobots}${isNoindex ? " ⚠ PAGE IS SET TO NOINDEX" : ""}

HEADING STRUCTURE:
- H1 Tags (${h1Tags.length} found): ${h1Tags.length > 0 ? h1Tags.map((h) => `"${h}"`).join(", ") : "None found"}
- Key H2 Tags: ${h2Tags.length > 0 ? h2Tags.map((h) => `"${h}"`).join(", ") : "None found"}
- Key H3 Tags: ${h3Tags.length > 0 ? h3Tags.map((h) => `"${h}"`).join(", ") : "None found"}

NAVIGATION STRUCTURE:
${navLinks.length > 0 ? navLinks.map((l) => `- ${l}`).join("\n") : "- Navigation links not detected"}

CALLS TO ACTION DETECTED:
${ctaTexts.length > 0 ? [...new Set(ctaTexts)].slice(0, 8).map((c) => `- "${c}"`).join("\n") : "- No clear CTA buttons/links detected"}

PAGE CONTENT EXCERPTS:
${paragraphs.map((p, idx) => `[Section ${idx + 1}] ${p}`).join("\n")}

IMAGE ALT TEXTS (first 10 images):
${imageAlts.length > 0 ? imageAlts.map((alt) => `- "${alt}"`).join("\n") : "- No alt texts found on top images"}
${imagesMissingAlt.length > 0 ? `- Images missing alt text: positions ${imagesMissingAlt.join(", ")}` : ""}

INTERNAL LINKS ON HOMEPAGE: ${internalLinkCount} detected
      `.trim();

      // ── 2. Detect Tech Stack ───────────────────────────────────────────
      const techList: string[] = [];

      if (html.includes("/wp-content/") || html.includes("/wp-includes/")) {
        techList.push("WordPress CMS");
      }
      if (
        html.includes("cdn.shopify.com") ||
        html.includes("shopify-payment-button") ||
        html.includes("/collections/")
      ) {
        techList.push("Shopify E-commerce");
      }
      if (html.includes("data-wf-page") || html.includes("data-wf-site")) {
        techList.push("Webflow");
      }
      if (html.includes("wix.com") || html.includes("wix-code")) {
        techList.push("Wix");
      }
      if (html.includes("squarespace")) {
        techList.push("Squarespace");
      }
      if (html.includes("elementor")) {
        techList.push("Elementor Page Builder");
      }
      if (html.includes("divi") || html.includes("et_pb_")) {
        techList.push("Divi Builder");
      }
      if (html.includes("woocommerce") || html.includes("wc-")) {
        techList.push("WooCommerce");
      }
      if (html.includes("yoast") || html.includes("rank-math") || html.includes("all-in-one-seo")) {
        techList.push("SEO Plugin detected (Yoast/RankMath/AIOSEO)");
      }
      if (html.includes("googletagmanager.com") || html.includes("google-analytics")) {
        techList.push("Google Analytics / GTM");
      }
      if (html.includes("connect.facebook.net")) {
        techList.push("Meta (Facebook) Pixel");
      }
      if (html.includes("hotjar") || html.includes("hj.q")) {
        techList.push("Hotjar");
      }
      if (html.includes("intercom")) {
        techList.push("Intercom (live chat)");
      }

      // Schema markup detection
      const schemaTypes: string[] = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const raw = $(el).html() || "";
          const parsed = JSON.parse(raw);
          const types = Array.isArray(parsed) ? parsed.map((p: any) => p["@type"]) : [parsed["@type"]];
          types.forEach((t: string) => {
            if (t && !schemaTypes.includes(t)) schemaTypes.push(t);
          });
        } catch {
          // ignore malformed JSON-LD
        }
      });

      if (schemaTypes.length > 0) {
        techList.push(`Schema markup: ${schemaTypes.join(", ")}`);
      }

      techStack = techList.length > 0 ? techList.join(" | ") : "Custom stack or unrecognized platform";
    }
  } catch (error) {
    console.warn("Scraper failed to fetch page content:", error);
    scrapedContent = "Failed to crawl site. The page was inaccessible or blocked crawling.";
  }

  // ── 3. Technical SEO Signals (robots.txt, sitemap, schema already in techStack) ──
  try {
    const seoSignals: string[] = [];

    // robots.txt
    try {
      const robotsRes = await fetch(`${origin}/robots.txt`, {
        signal: AbortSignal.timeout(8000),
      });
      if (robotsRes.ok) {
        const robotsText = await robotsRes.text();
        const lines = robotsText.split("\n").slice(0, 20).join("\n").trim();
        const hasSitemapDirective = /sitemap:/i.test(robotsText);
        const hasDisallowAll = /Disallow:\s*\//m.test(robotsText) && /User-agent:\s*\*/m.test(robotsText);

        seoSignals.push(`ROBOTS.TXT:
  - Found: Yes
  - Contains sitemap directive: ${hasSitemapDirective ? "Yes" : "No"}
  - Blocks all crawlers (Disallow: /): ${hasDisallowAll ? "YES - CRITICAL ISSUE" : "No"}
  - First 20 lines:
${lines
  .split("\n")
  .map((l) => `    ${l}`)
  .join("\n")}`);
      } else {
        seoSignals.push(`ROBOTS.TXT:\n  - Found: No (returned ${robotsRes.status})`);
      }
    } catch {
      seoSignals.push("ROBOTS.TXT:\n  - Could not be fetched (timeout or DNS error)");
    }

    // sitemap.xml
    try {
      const sitemapRes = await fetch(`${origin}/sitemap.xml`, {
        signal: AbortSignal.timeout(8000),
      });
      if (sitemapRes.ok) {
        const sitemapText = await sitemapRes.text();
        const urlCount = (sitemapText.match(/<loc>/g) || []).length;
        seoSignals.push(`SITEMAP.XML:\n  - Found: Yes at /sitemap.xml\n  - Approximate URLs listed: ${urlCount}`);
      } else {
        // Try sitemap_index.xml
        const altRes = await fetch(`${origin}/sitemap_index.xml`, {
          signal: AbortSignal.timeout(6000),
        });
        if (altRes.ok) {
          seoSignals.push("SITEMAP.XML:\n  - Found: Yes at /sitemap_index.xml (sitemap index)");
        } else {
          seoSignals.push(`SITEMAP.XML:\n  - Not found at /sitemap.xml or /sitemap_index.xml (returned ${sitemapRes.status})`);
        }
      }
    } catch {
      seoSignals.push("SITEMAP.XML:\n  - Could not be fetched (timeout or DNS error)");
    }

    // HTTPS check
    const isHttps = formattedUrl.startsWith("https://");
    seoSignals.push(`HTTPS:\n  - ${isHttps ? "Yes — site loads over HTTPS" : "No — site is HTTP only (Critical SEO and trust issue)"}`);

    // Schema markup from scraped HTML
    if (html) {
      const $ = cheerio.load(html);
      const schemaTypes: string[] = [];
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const raw = $(el).html() || "";
          const parsed = JSON.parse(raw);
          const types = Array.isArray(parsed)
            ? parsed.map((p: any) => p["@type"])
            : [parsed["@type"]];
          types.forEach((t: string) => {
            if (t && !schemaTypes.includes(t)) schemaTypes.push(t);
          });
        } catch {
          // ignore
        }
      });

      if (schemaTypes.length > 0) {
        seoSignals.push(`STRUCTURED DATA (Schema.org JSON-LD):\n  - Types detected: ${schemaTypes.join(", ")}`);
      } else {
        seoSignals.push("STRUCTURED DATA (Schema.org JSON-LD):\n  - None detected on homepage");
      }

      // Canonical check
      const canonical = $('link[rel="canonical"]').attr("href")?.trim();
      seoSignals.push(
        canonical
          ? `CANONICAL TAG:\n  - Set to: ${canonical}`
          : "CANONICAL TAG:\n  - Not present on homepage"
      );

      // Meta robots
      const metaRobots = $('meta[name="robots"]').attr("content")?.trim();
      seoSignals.push(
        metaRobots
          ? `META ROBOTS:\n  - Set to: "${metaRobots}"${metaRobots.toLowerCase().includes("noindex") ? " ⚠ NOINDEX DETECTED" : ""}`
          : "META ROBOTS:\n  - Not set (defaults to index, follow)"
      );

      // Open Graph tags
      const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
      const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();
      seoSignals.push(
        `OPEN GRAPH TAGS:\n  - og:title: ${ogTitle || "Not set"}\n  - og:description: ${ogDesc || "Not set"}`
      );
    }

    technicalSeoData = seoSignals.join("\n\n");
  } catch (error) {
    console.warn("Technical SEO data collection failed:", error);
    technicalSeoData = "Technical SEO signals could not be collected due to a fetch error.";
  }

  // ── 4. Google PageSpeed Insights ─────────────────────────────────────────
  try {
    console.log(`Fetching Google PageSpeed Insights for: ${formattedUrl}`);
    const pagespeedUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(formattedUrl)}&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo`;

    const response = await fetch(pagespeedUrl, { signal: AbortSignal.timeout(30000) });
    if (response.ok) {
      const data: any = await response.json();
      const lr = data.lighthouseResult;

      if (lr) {
        const score = (cat: string) =>
          lr.categories[cat]?.score != null
            ? Math.round(lr.categories[cat].score * 100)
            : "N/A";

        const metric = (id: string) => lr.audits[id]?.displayValue || "N/A";

        // INP replaced FID as a Core Web Vital; PageSpeed may label it differently
        const inpValue =
          lr.audits["interaction-to-next-paint"]?.displayValue ||
          lr.audits["experimental-interaction-to-next-paint"]?.displayValue ||
          "N/A";

        performanceData = `
LIGHTHOUSE SCORES (Mobile):
- Performance: ${score("performance")}/100
- Accessibility: ${score("accessibility")}/100
- Best Practices: ${score("best-practices")}/100
- SEO (Lighthouse): ${score("seo")}/100

CORE WEB VITALS:
- Largest Contentful Paint (LCP): ${metric("largest-contentful-paint")}
- Interaction to Next Paint (INP): ${inpValue}
- Cumulative Layout Shift (CLS): ${metric("cumulative-layout-shift")}
- First Contentful Paint (FCP): ${metric("first-contentful-paint")}
- Speed Index: ${metric("speed-index")}
- Total Blocking Time (TBT): ${metric("total-blocking-time")}

KEY OPPORTUNITIES:
${
  Object.values(lr.audits as Record<string, any>)
    .filter(
      (a: any) =>
        a.score != null && a.score < 0.9 && a.details?.type === "opportunity" && a.description
    )
    .slice(0, 5)
    .map((a: any) => `- ${a.title}: ${a.displayValue || ""}`)
    .join("\n") || "- No major opportunities flagged"
}
        `.trim();

        console.log("PageSpeed Insights loaded successfully.");
      }
    } else {
      console.warn("PageSpeed API returned non-OK status:", response.status);
    }
  } catch (error) {
    console.warn("Google PageSpeed Insights API call failed:", error);
    performanceData =
      "PageSpeed API timed out. Core Web Vitals not available for this run.";
  }

  return {
    scraped_pages: scrapedContent,
    tech_stack: techStack,
    performance_data: performanceData,
    technical_seo_data: technicalSeoData,
  };
}
