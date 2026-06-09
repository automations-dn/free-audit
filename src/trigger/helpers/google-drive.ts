/**
 * Direct Google Drive upload via Service Account + REST API.
 * Uses only Node.js built-ins (crypto) and fetch — no googleapis package.
 *
 * Setup (one-time, ~5 minutes):
 *  1. Go to console.cloud.google.com → IAM & Admin → Service Accounts
 *  2. Create a service account (name it anything, e.g. "trigger-drive-uploader")
 *  3. On the service account page → Keys → Add Key → JSON → download the file
 *  4. Open the downloaded JSON, copy the entire contents
 *  5. In .env set: GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
 *     (paste the entire JSON on one line, or use a multiline env var)
 *  6. In Google Drive: open the target folder → Share → paste the service account
 *     email (looks like xxx@yyy.iam.gserviceaccount.com) → give Editor access
 *
 * That's it. The service account can now upload files to that folder.
 */

import { createSign } from "crypto";

interface ServiceAccount {
  client_email: string;
  private_key:  string;
}

// ── JWT / OAuth helpers ───────────────────────────────────────────────────────

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
  const sig = sign.sign(sa.private_key, "base64url");

  return `${header}.${payload}.${sig}`;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const jwt = buildJWT(sa);
  const res  = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Drive OAuth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── File upload ───────────────────────────────────────────────────────────────

async function uploadFile(
  token:    string,
  content:  string,
  filename: string,
  folderId: string
): Promise<string> {
  const metadata = JSON.stringify({
    name:    filename,
    parents: folderId ? [folderId] : undefined,
    // Uncomment the next line to auto-convert to Google Doc:
    // mimeType: "application/vnd.google-apps.document",
  });

  const fileBytes = Buffer.from(content, "utf-8");
  const boundary  = "audit_boundary_x7k9";

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n`
    ),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name",
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  const file = (await uploadRes.json()) as { id?: string; webViewLink?: string; error?: unknown };
  if (!file.id) throw new Error(`Drive upload failed: ${JSON.stringify(file)}`);

  return file.id;
}

// ── Make file publicly readable ───────────────────────────────────────────────

async function makePublic(token: string, fileId: string): Promise<string> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ role: "reader", type: "anyone" }),
  });

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = (await metaRes.json()) as { webViewLink?: string };
  return meta.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
}

// ── Public function ───────────────────────────────────────────────────────────

export async function uploadHtmlToDrive(
  htmlContent: string,
  filename:    string,
  folderId:    string
): Promise<string> {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");

  const sa    = JSON.parse(saJson) as ServiceAccount;
  const token = await getAccessToken(sa);

  console.log(`Uploading "${filename}" to Google Drive folder ${folderId || "root"}…`);
  const fileId  = await uploadFile(token, htmlContent, filename, folderId);
  const fileUrl = await makePublic(token, fileId);

  console.log(`Drive upload complete: ${fileUrl}`);
  return fileUrl;
}
