/**
 * Gamma document generation via REST API
 * Docs: https://developers.gamma.app
 *
 * Required env var:
 *   GAMMA_API_KEY — from gamma.app/settings/api-keys (requires Pro/Ultra/Teams/Business plan)
 *
 * Flow:
 *   1. POST /generations   — kick off document generation
 *   2. GET  /generations/{id} — poll until status = "complete"
 *   3. Return the shareable Gamma URL
 */

import { wait } from "@trigger.dev/sdk";

const GAMMA_API = "https://public-api.gamma.app/v1.0";

interface GenerationResponse {
  id?:     string;
  error?:  string;
  message?: string;
}

interface GenerationStatus {
  id:      string;
  status:  string; // "pending" | "processing" | "complete" | "failed"
  gamma?: {
    id?:       string;
    url?:      string;
    shareUrl?: string;
    webUrl?:   string;
  };
  result?: {
    url?:      string;
    shareUrl?: string;
    webUrl?:   string;
    id?:       string;
  };
  url?:      string;
  shareUrl?: string;
}

function authHeader(): Record<string, string> {
  const key = process.env.GAMMA_API_KEY;
  if (!key) throw new Error("GAMMA_API_KEY is not set");
  return {
    Authorization:  `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function extractUrl(data: GenerationStatus): string {
  return (
    data.gamma?.shareUrl ??
    data.gamma?.webUrl   ??
    data.gamma?.url      ??
    data.result?.shareUrl ??
    data.result?.webUrl  ??
    data.result?.url     ??
    data.shareUrl        ??
    data.url             ??
    ""
  );
}

export async function createGammaDocument(
  markdownContent: string,
  title:           string,
  auditType:       "seo" | "website"
): Promise<string> {
  const headers = authHeader();

  // ── Step 1: Start generation ────────────────────────────────────────────────
  console.log(`Creating Gamma document: "${title}"`);

  const genRes = await fetch(`${GAMMA_API}/generations`, {
    method:  "POST",
    headers,
    body: JSON.stringify({
      inputText: markdownContent,
      title,
      format:   "document",           // long-form doc, not slides
      textMode: "full",               // preserve the full content we send
      numCards: auditType === "seo" ? 12 : 12, // sections match our 12-section reports
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const genData = (await genRes.json()) as GenerationResponse;

  if (!genData.id) {
    throw new Error(`Gamma generation failed to start: ${JSON.stringify(genData)}`);
  }

  const generationId = genData.id;
  console.log(`Gamma generation started: ${generationId}`);

  // ── Step 2: Poll until complete ─────────────────────────────────────────────
  // Gamma docs typically take 30–120 seconds to generate
  const maxAttempts = 24; // 24 × 15s = 6 minutes max

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await wait.for({ seconds: 15 }); // checkpointed by Trigger.dev

    const statusRes = await fetch(`${GAMMA_API}/generations/${generationId}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    const status = (await statusRes.json()) as GenerationStatus;
    console.log(`Gamma status (attempt ${attempt}/${maxAttempts}): ${status.status}`);

    if (status.status === "complete") {
      const gammaUrl = extractUrl(status);
      if (!gammaUrl) {
        throw new Error(`Gamma completed but returned no URL. Full response: ${JSON.stringify(status)}`);
      }
      console.log(`Gamma document ready: ${gammaUrl}`);
      return gammaUrl;
    }

    if (status.status === "failed" || status.status === "error") {
      throw new Error(`Gamma generation failed: ${JSON.stringify(status)}`);
    }
  }

  throw new Error("Gamma generation timed out after 6 minutes");
}
