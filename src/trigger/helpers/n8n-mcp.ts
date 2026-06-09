/**
 * n8n MCP Client — Drive upload only
 *
 * Trigger.dev uses this to upload the finished audit HTML to Google Drive
 * via an n8n MCP workflow. All other operations (Sheets, Slack, CRM, email)
 * are handled directly inside n8n.
 *
 * Required env vars:
 *   N8N_MCP_URL          — your n8n MCP endpoint
 *   N8N_API_KEY          — Bearer token (optional but recommended)
 *   GOOGLE_DRIVE_FOLDER_ID — Drive folder for audit uploads
 *
 * ── n8n MCP workflow node you must have ──────────────────────────────────────
 *  Node: Google Drive — Upload file
 *  MCP tool name: Upload_file_in_Google_Drive
 *
 *  The n8n Code node before it must:
 *  1. Receive { File_Name, File_Content, Folder_ID }
 *  2. Convert File_Content (base64) → binary:
 *       const buf = Buffer.from($json.File_Content, 'base64');
 *       return [{ json: {}, binary: { data: { data: buf.toString('base64'),
 *         mimeType: 'text/html', fileName: $json.File_Name } } }];
 *  3. Google Drive Upload node uses that binary
 *  4. Google Drive Share node — set "Anyone with link can view"
 *  5. Return { fileUrl: <webViewLink> }
 */

// ── JSON-RPC / SSE response parser ───────────────────────────────────────────

async function parseJsonRpcResponse<T>(
  response: Response
): Promise<{ result?: T; error?: { message: string; code?: number } }> {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const trimmed = line.slice(6).trim();
      if (!trimmed || trimmed === "[DONE]") continue;
      return JSON.parse(trimmed) as { result?: T; error?: { message: string } };
    }
    throw new Error("n8n MCP SSE response contained no data lines");
  }

  return response.json() as Promise<{ result?: T; error?: { message: string } }>;
}

// ── Core MCP caller (initialize → notifications/initialized → tools/call) ────

async function callN8nMcpTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  const url = process.env.N8N_MCP_URL;
  if (!url) throw new Error("N8N_MCP_URL is not set");

  const apiKey = process.env.N8N_API_KEY;
  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  // Step 1 — initialize
  const initRes = await fetch(url, {
    method: "POST",
    headers: baseHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "free-audit-backend", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`n8n MCP initialize failed (HTTP ${initRes.status}): ${text}`);
  }

  const sessionId = initRes.headers.get("Mcp-Session-Id");
  const sessionHeaders: Record<string, string> = sessionId
    ? { ...baseHeaders, "Mcp-Session-Id": sessionId }
    : baseHeaders;

  const initJson = await parseJsonRpcResponse(initRes);
  if (initJson.error) throw new Error(`n8n MCP initialize error: ${initJson.error.message}`);

  // Step 2 — notifications/initialized (fire-and-forget)
  await fetch(url, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});

  // Step 3 — tools/call
  const toolRes = await fetch(url, {
    method: "POST",
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${toolName}-${Date.now()}`,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });

  if (!toolRes.ok) {
    const text = await toolRes.text();
    throw new Error(`n8n MCP HTTP ${toolRes.status} for tool "${toolName}": ${text}`);
  }

  const json = await parseJsonRpcResponse<T>(toolRes);
  if (json.error) {
    throw new Error(`n8n MCP tool error (${toolName}): ${json.error.message ?? JSON.stringify(json.error)}`);
  }

  const res = json.result as any;
  if (res?.isError === true) {
    const text = (res.content ?? []).map((b: any) => b.text ?? "").join(" ").trim();
    throw new Error(`n8n MCP tool error (${toolName}): ${text || JSON.stringify(res)}`);
  }

  return json.result as T;
}

// ── Extract Drive URL from n8n response ──────────────────────────────────────

function extractDriveUrl(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;

  if (Array.isArray((r as any).content)) {
    for (const block of (r as any).content) {
      if (block?.type === "text" && typeof block.text === "string") {
        try {
          const parsed = JSON.parse(block.text.trim()) as Record<string, unknown>;
          return (parsed.fileUrl ?? parsed.webViewLink ?? parsed.url ?? "") as string;
        } catch {
          // not JSON — ignore
        }
      }
    }
  }

  return (r.fileUrl ?? r.webViewLink ?? r.url ?? r.file_url ?? r.link ?? "") as string;
}

// ── Upload audit HTML to Google Drive ─────────────────────────────────────────
// Returns the shareable Google Drive view link.

export async function uploadAuditToGoogleDrive(
  htmlContent: string,
  filename: string
): Promise<string> {
  console.log(`Uploading to Google Drive: ${filename}`);

  const result = await callN8nMcpTool<unknown>("Upload_file_in_Google_Drive", {
    File_Name:    filename,
    HTML_Content: htmlContent,
    Folder_ID:    process.env.GOOGLE_DRIVE_FOLDER_ID ?? "",
    MIME_Type:    "text/html",
  });

  const fileUrl = extractDriveUrl(result);
  if (!fileUrl) {
    console.warn("Drive upload returned no URL — raw result:", JSON.stringify(result));
    throw new Error("Google Drive upload did not return a fileUrl. Check your n8n Drive workflow.");
  }

  console.log(`Drive upload complete: ${fileUrl}`);
  return fileUrl;
}
