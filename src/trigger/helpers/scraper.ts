import * as cheerio from "cheerio";

export interface ScrapedData {
  scraped_pages: string;
  tech_stack: string;
  performance_data: string;
}

/**
 * Scrapes a website's homepage, detects its technology stack, and calls Google PageSpeed Insights API.
 */
export async function scrapeWebsiteAndGetMetrics(url: string): Promise<ScrapedData> {
  console.log(`🔍 Goated Scraper starting for: ${url}`);
  
  let formattedUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    formattedUrl = `https://${url}`;
  }

  let scrapedContent = "Data not available";
  let techStack = "Data not available";
  let performanceData = "Data not available";

  // 1. Scrape Homepage HTML
  try {
    const response = await fetch(formattedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract SEO & Page Details
      const title = $("title").text().trim() || "No title found";
      const metaDescription = $('meta[name="description"]').attr("content")?.trim() || "No meta description found";
      
      const headingsH1: string[] = [];
      $("h1").each((i, el) => {
        const txt = $(el).text().trim();
        if (txt) headingsH1.push(txt);
      });

      const headingsH2: string[] = [];
      $("h2").slice(0, 10).each((i, el) => {
        const txt = $(el).text().trim();
        if (txt) headingsH2.push(txt);
      });

      // Extract main body copy
      const paragraphs: string[] = [];
      $("p").slice(0, 8).each((i, el) => {
        const txt = $(el).text().trim();
        if (txt && txt.length > 20) paragraphs.push(txt);
      });

      // Extract alt texts
      const imageAlts: string[] = [];
      $("img").slice(0, 5).each((i, el) => {
        const alt = $(el).attr("alt")?.trim();
        if (alt) imageAlts.push(alt);
      });

      scrapedContent = `
PAGE DETAILS:
- Title Tag: "${title}"
- Meta Description: "${metaDescription}"

HEADINGS:
- H1 Headings: ${headingsH1.length > 0 ? headingsH1.map(h => `"${h}"`).join(", ") : "None found"}
- Key H2 Headings: ${headingsH2.length > 0 ? headingsH2.map(h => `"${h}"`).join(", ") : "None found"}

PAGE CONTENT EXCERPTS:
${paragraphs.map((p, idx) => `[Sec ${idx + 1}] ${p}`).join("\n")}

IMAGE ALT TEXTS DETECTED:
${imageAlts.length > 0 ? imageAlts.map(alt => `- "${alt}"`).join("\n") : "No descriptive alt tags found in top images."}
      `.trim();

      // 2. Detect Tech Stack
      const techList: string[] = [];
      
      // CMS / Framework Checks
      if (html.includes("/wp-content/") || html.includes("/wp-includes/")) {
        techList.push("WordPress CMS");
      }
      if (html.includes("cdn.shopify.com") || html.includes("shopify-payment-button") || html.includes("/collections/")) {
        techList.push("Shopify E-commerce");
      }
      if (html.includes("data-wf-page") || html.includes("data-wf-site")) {
        techList.push("Webflow Site Builder");
      }
      if (html.includes("wix.com") || html.includes("wix-code")) {
        techList.push("Wix Builder");
      }

      // Page Builder / Plugins Checks
      if (html.includes("elementor")) {
        techList.push("Elementor Page Builder");
      }
      if (html.includes("divi")) {
        techList.push("Divi Builder");
      }
      if (html.includes("woocommerce")) {
        techList.push("WooCommerce (WordPress)");
      }

      // Analytics & Tracking
      if (html.includes("googletagmanager.com") || html.includes("google-analytics")) {
        techList.push("Google Analytics / GTM");
      }
      if (html.includes("connect.facebook.net")) {
        techList.push("Meta (Facebook) Pixel");
      }

      techStack = techList.length > 0 ? techList.join(", ") : "Custom stack or unrecognized platform";
    }
  } catch (error) {
    console.warn("⚠️ Website Scraper failed to fetch page content. Using fallback placeholders.", error);
    scrapedContent = "Failed to crawl site. Page was inaccessible or blocked crawling.";
  }

  // 3. Call Google PageSpeed Insights API
  try {
    console.log(`⚡ Fetching Google PageSpeed Insights for: ${formattedUrl}`);
    const pagespeedUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(formattedUrl)}&category=performance&category=accessibility&category=seo`;
    
    const response = await fetch(pagespeedUrl);
    if (response.ok) {
      const data: any = await response.json();
      const lr = data.lighthouseResult;

      if (lr) {
        const perfScore = lr.categories.performance?.score ? Math.round(lr.categories.performance.score * 100) : "N/A";
        const accessScore = lr.categories.accessibility?.score ? Math.round(lr.categories.accessibility.score * 100) : "N/A";
        const seoScore = lr.categories.seo?.score ? Math.round(lr.categories.seo.score * 100) : "N/A";

        const lcp = lr.audits["largest-contentful-paint"]?.displayValue || "N/A";
        const cls = lr.audits["cumulative-layout-shift"]?.displayValue || "N/A";
        const speedIndex = lr.audits["speed-index"]?.displayValue || "N/A";
        const fcp = lr.audits["first-contentful-paint"]?.displayValue || "N/A";

        performanceData = `
LIGHTHOUSE SCORES:
- Performance Score: ${perfScore}/100
- Accessibility Score: ${accessScore}/100
- SEO Score: ${seoScore}/100

CORE WEB VITALS & METRICS:
- Largest Contentful Paint (LCP): ${lcp}
- Cumulative Layout Shift (CLS): ${cls}
- Speed Index: ${speedIndex}
- First Contentful Paint (FCP): ${fcp}
        `.trim();
        
        console.log("✅ PageSpeed Insights loaded successfully.");
      }
    }
  } catch (error) {
    console.warn("⚠️ Google PageSpeed Insights API call failed.", error);
    performanceData = "PageSpeed API timeout. Core Web Vitals not accessible at this moment.";
  }

  return {
    scraped_pages: scrapedContent,
    tech_stack: techStack,
    performance_data: performanceData,
  };
}
