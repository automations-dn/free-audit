import { google } from "googleapis";

export interface LeadData {
  company_name: string;
  website_url: string;
  email: string;
  phone: string;
  audit_type: "website_audit" | "seo";
}

/**
 * Appends lead details to Google Sheets using Google Service Account credentials.
 */
export async function appendLeadToSheets(lead: LeadData): Promise<void> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!email || !privateKey || !spreadsheetId) {
    console.warn("⚠️ Google Sheets credentials or Sheet ID missing in environment. Skipping sheet log.");
    return;
  }

  try {
    // Authenticate with Google Sheets API using JWT
    const auth = new google.auth.JWT(
      email,
      undefined,
      privateKey.replace(/\\n/g, "\n"), // Replace escape characters with actual newlines
      ["https://www.googleapis.com/auth/spreadsheets"]
    );

    const sheets = google.sheets({ version: "v4", auth });

    const timestamp = new Date().toLocaleString();
    const values = [
      [
        lead.company_name,
        lead.website_url,
        lead.email,
        lead.phone,
        lead.audit_type === "website_audit" ? "Website Audit" : "SEO Audit",
        timestamp,
      ],
    ];

    console.log(`📊 Appending row to Google Sheet:`, values[0]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A:F", // Assumes standard sheet name is 'Sheet1' and has at least columns A-F
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values,
      },
    });

    console.log("✅ Google Sheets logged successfully.");
  } catch (error) {
    console.error("❌ Google Sheets Error:", error);
    throw new Error(`Failed to log lead to Google Sheets: ${error instanceof Error ? error.message : String(error)}`);
  }
}
