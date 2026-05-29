import { google } from "googleapis";

/**
 * Custom parser to convert Claude markdown to beautiful semantic HTML with inline styling.
 * This guarantees Google Docs will render it with premium typography and layouts.
 */
function convertMarkdownToPremiumHtml(md: string, companyName: string): string {
  // Convert basic markers
  let html = md;

  // Escape standard characters for safety
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Restore the header elements safely
  html = html.replace(/^# (.*?)$/gm, '<h1 style="color: #1E3A8A; font-size: 26px; font-weight: bold; border-bottom: 2px solid #1E3A8A; padding-bottom: 8px; margin-top: 35px; font-family: \'Arial\', sans-serif;">$1</h1>');
  html = html.replace(/^## (.*?)$/gm, '<h2 style="color: #2563EB; font-size: 20px; font-weight: bold; border-bottom: 1px solid #E5E7EB; padding-bottom: 6px; margin-top: 25px; font-family: \'Arial\', sans-serif;">$1</h2>');
  html = html.replace(/^### (.*?)$/gm, '<h3 style="color: #4B5563; font-size: 15px; font-weight: bold; margin-top: 20px; font-family: \'Arial\', sans-serif;">$1</h3>');

  // Convert Bold and Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #111827; font-weight: bold;">$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em style="color: #374151;">$1</em>');

  // Inline backticks code formatting
  html = html.replace(/`(.*?)`/g, '<code style="background-color: #F3F4F6; color: #DC2626; padding: 2px 4px; border-radius: 4px; font-family: \'Courier New\', monospace; font-size: 13px;">$1</code>');

  // Inject beautiful colored CSS badges for Priority Severity Levels
  html = html.replace(/severity:\s*high/gi, 'severity: <span style="background-color: #FEE2E2; color: #DC2626; font-weight: bold; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: Arial, sans-serif;">HIGH</span>');
  html = html.replace(/severity:\s*medium/gi, 'severity: <span style="background-color: #FEF3C7; color: #D97706; font-weight: bold; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: Arial, sans-serif;">MEDIUM</span>');
  html = html.replace(/severity:\s*low/gi, 'severity: <span style="background-color: #ECFDF5; color: #059669; font-weight: bold; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: Arial, sans-serif;">LOW</span>');

  const lines = html.split("\n");
  const output: string[] = [];
  let inList = false;
  let listType = ""; // 'ul' or 'ol'

  for (let line of lines) {
    const trimmed = line.trim();

    // Check list item structures
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        inList = true;
        listType = "ul";
        output.push('<ul style="margin-left: 20px; margin-bottom: 15px; font-size: 14px; line-height: 1.6; font-family: \'Arial\', sans-serif;">');
      }
      output.push(`<li style="margin-bottom: 6px; color: #374151;">${trimmed.substring(2)}</li>`);
    } else if (/^\d+\.\s/.test(trimmed)) {
      if (!inList) {
        inList = true;
        listType = "ol";
        output.push('<ol style="margin-left: 20px; margin-bottom: 15px; font-size: 14px; line-height: 1.6; font-family: \'Arial\', sans-serif;">');
      }
      const text = trimmed.replace(/^\d+\.\s/, "");
      output.push(`<li style="margin-bottom: 6px; color: #374151;">${text}</li>`);
    } else {
      if (inList) {
        inList = false;
        output.push(`</${listType}>`);
      }

      if (trimmed === "") {
        output.push("<br/>");
      } else if (
        !trimmed.startsWith("<h") && 
        !trimmed.startsWith("<ul") && 
        !trimmed.startsWith("<ol") && 
        !trimmed.startsWith("<li") &&
        !trimmed.startsWith("<br")
      ) {
        output.push(`<p style="margin-bottom: 15px; font-size: 14.5px; line-height: 1.6; font-family: 'Arial', sans-serif; color: #374151;">${trimmed}</p>`);
      } else {
        output.push(trimmed);
      }
    }
  }

  if (inList) {
    output.push(`</${listType}>`);
  }

  // Wrap inside a premium branded shell
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${companyName} - Audit Report</title>
</head>
<body style="font-family: 'Arial', sans-serif; color: #333333; line-height: 1.6; margin: 40px;">
  <!-- Premium Branded Header Card -->
  <div style="background-color: #1E3A8A; padding: 25px; border-radius: 8px; margin-bottom: 30px; text-align: center;">
    <h1 style="color: #FFFFFF; font-size: 28px; margin: 0; font-family: 'Arial', sans-serif; font-weight: bold; letter-spacing: 0.5px;">THE DARE NETWORK</h1>
    <p style="color: #93C5FD; font-size: 14px; margin: 8px 0 0 0; font-family: 'Arial', sans-serif; letter-spacing: 1px; text-transform: uppercase;">Growth Marketing & Conversion Optimization Agency</p>
  </div>
  
  <div style="margin-top: 20px;">
    ${output.join("\n")}
  </div>
  
  <!-- Premium Branded Footer Card -->
  <div style="margin-top: 50px; border-top: 1px solid #E5E7EB; padding-top: 20px; text-align: center; font-size: 12px; color: #9CA3AF; font-family: 'Arial', sans-serif;">
    <p>This audit is a complimentary assessment prepared by The Dare Network.</p>
    <p>&copy; ${new Date().getFullYear()} The Dare Network. All rights reserved.</p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Creates a beautifully styled Google Doc in Google Drive and returns a shareable link.
 */
export async function createGoogleDocFromMarkdown(
  markdown: string,
  companyName: string
): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!email || !privateKey) {
    throw new Error("Google Drive credentials missing in environment variables.");
  }

  try {
    // 1. Authenticate with Google Drive API
    const auth = new google.auth.JWT(
      email,
      undefined,
      privateKey.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/drive"]
    );

    const drive = google.drive({ version: "v3", auth });

    // Convert markdown to HTML
    const htmlContent = convertMarkdownToPremiumHtml(markdown, companyName);

    console.log(`📂 Generating Google Doc in Drive for ${companyName}...`);

    // 2. Upload and convert HTML to Google Doc
    const fileMetadata: any = {
      name: `${companyName} - Free Audit Report`,
      mimeType: "application/vnd.google-apps.document", // Forces auto-conversion to Google Doc format
    };

    if (folderId && folderId !== "placeholder_google_drive_folder_id") {
      fileMetadata.parents = [folderId];
    }

    const media = {
      mimeType: "text/html",
      body: htmlContent,
    };

    const fileRes = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id,webViewLink",
    });

    const fileId = fileRes.data.id;
    const webViewLink = fileRes.data.webViewLink;

    if (!fileId || !webViewLink) {
      throw new Error("Failed to retrieve file ID or Web View Link from Google Drive response.");
    }

    console.log(`✅ Created Google Doc file in Drive. FileID: ${fileId}`);

    // 3. Make the file viewable by anyone with the link so the client can access it
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    console.log(`✅ Google Doc permissions set: Viewable by anyone with link.`);

    return webViewLink;
  } catch (error) {
    console.error("❌ Google Drive Doc Error:", error);
    throw new Error(`Failed to create Google Doc: ${error instanceof Error ? error.message : String(error)}`);
  }
}
