/**
 * Upload HTML to Google Drive as a native Google Doc via Service Account.
 *
 * Google Drive auto-converts the uploaded HTML into a Google Doc — no extra
 * conversion step needed. The result is an editable, shareable Google Doc.
 *
 * One-time setup (~5 minutes):
 *  1. console.cloud.google.com → APIs & Services → Enable "Google Drive API"
 *  2. IAM & Admin → Service Accounts → Create
 *     - Name: "trigger-audit-uploader" (anything)
 *     - Click the account → Keys → Add Key → JSON → download
 *  3. Paste the entire JSON contents into .env as GOOGLE_SERVICE_ACCOUNT_JSON
 *     (one line — the whole file contents)
 *  4. In Google Drive: open your audit folder → Share →
 *     paste the service account email (xxx@yyy.iam.gserviceaccount.com)
 *     → set "Editor" → Done
 *
 * That's it. The service account will now upload docs to that exact folder,
 * under your Google account, because you shared it.
 */

import { createSign } from "node:crypto";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function buildJWT(sa: ServiceAccount): string {
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss:   sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud:   "https://oauth2.googleapis.com/token",
    iat:   now,
    exp:   now + 3600,
  })).toString("base64url");

  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  return `${header}.${payload}.${sign.sign(sa.private_key, "base64url")}`;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${buildJWT(sa)}`,
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Google OAuth failed: ${data.error ?? "unknown"} — ${data.error_description ?? JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function createDoc(
  token:       string,
  htmlContent: string,
  title:       string,
  folderId:    string
): Promise<string> {
  const metadata = JSON.stringify({
    name:     title,
    mimeType: "application/vnd.google-apps.document", // tells Drive to convert HTML → Google Doc
    parents:  folderId ? [folderId] : undefined,
  });

  const boundary  = "gdocs_audit_boundary";
  const fileBytes = Buffer.from(htmlContent, "utf-8");

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset=UTF-8\r\n\r\n`
    ),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name",
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(60_000),
    }
  );

  const file = (await res.json()) as { id?: string; webViewLink?: string; error?: unknown };
  if (!file.id) throw new Error(`Drive upload failed: ${JSON.stringify(file)}`);
  return file.id;
}

async function makePublic(token: string, fileId: string): Promise<string> {
  // Grant "anyone with the link" read access
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ role: "reader", type: "anyone" }),
    signal:  AbortSignal.timeout(15_000),
  });

  // Fetch the canonical share link
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
  );
  const meta = (await metaRes.json()) as { webViewLink?: string };
  return meta.webViewLink ?? `https://docs.google.com/document/d/${fileId}/view`;
}

export async function uploadToGoogleDocs(
  htmlContent: string,
  title:       string,
  folderId:    string
): Promise<string> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");

  const sa    = JSON.parse(saJson) as ServiceAccount;
  const token = await getAccessToken(sa);

  console.log(`Creating Google Doc: "${title}" in folder ${folderId || "root"}`);
  const fileId  = await createDoc(token, htmlContent, title, folderId);
  const fileUrl = await makePublic(token, fileId);

  console.log(`Google Doc ready: ${fileUrl}`);
  return fileUrl;
}
