import { LeadData } from "./n8n-mcp.js";

interface ZohoAccessTokenResponse {
  access_token: string;
  expires_in: number;
  api_domain: string;
  token_type: string;
}

/**
 * Gets a fresh Zoho access token using the Refresh Token.
 */
async function getZohoAccessToken(): Promise<string> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Zoho CRM OAuth credentials missing in environment variables.");
  }

  const url = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${refreshToken}&client_id=${clientId}&client_secret=${clientSecret}&grant_type=refresh_token`;

  try {
    const response = await fetch(url, { method: "POST" });
    const data: any = await response.json();

    if (!data.access_token) {
      throw new Error(`Zoho auth failed: ${JSON.stringify(data)}`);
    }

    return data.access_token;
  } catch (error) {
    console.error("âŒ Zoho Auth Token Error:", error);
    throw error;
  }
}

/**
 * Creates Account, Contact, and Deal inside Zoho Bigin CRM.
 */
export async function createZohoBiginDeal(lead: LeadData): Promise<void> {
  const pipelineId = process.env.ZOHO_PIPELINE_ID;
  const stageId = process.env.ZOHO_PIPELINE_STAGE_ID;

  if (
    !process.env.ZOHO_CLIENT_ID ||
    process.env.ZOHO_CLIENT_ID === "placeholder_client_id"
  ) {
    console.warn("âš ï¸ Zoho CRM credentials not set. Skipping Zoho Deal creation.");
    return;
  }

  try {
    const accessToken = await getZohoAccessToken();
    const headers = {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    };

    console.log(`ðŸ’¼ Connecting to Zoho Bigin for company: ${lead.company_name}`);

    // Step 1: Search or Create Account (Company)
    let accountId = "";
    const searchAccountUrl = `https://www.zohoapis.com/bigin/v1/Accounts/search?word=${encodeURIComponent(lead.company_name)}`;
    const searchAccountRes = await fetch(searchAccountUrl, { headers });
    const searchAccountData: any = await searchAccountRes.json();

    if (searchAccountData.data && searchAccountData.data.length > 0) {
      accountId = searchAccountData.data[0].id;
      console.log(`âœ… Existing Zoho Account found: ${accountId}`);
    } else {
      const createAccountUrl = "https://www.zohoapis.com/bigin/v1/Accounts";
      const accountBody = {
        data: [
          {
            Account_Name: lead.company_name,
            Website: lead.website_url,
            Phone: lead.phone,
          },
        ],
      };
      
      const createAccountRes = await fetch(createAccountUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(accountBody),
      });
      const createAccountData: any = await createAccountRes.json();

      if (!createAccountData.data || !createAccountData.data[0]) {
        throw new Error(`Failed to create Account: ${JSON.stringify(createAccountData)}`);
      }

      accountId = createAccountData.data[0].details.id;
      console.log(`âœ… Created new Zoho Account: ${accountId}`);
    }

    // Step 2: Search or Create Contact
    let contactId = "";
    const searchContactUrl = `https://www.zohoapis.com/bigin/v1/Contacts/search?email=${encodeURIComponent(lead.email)}`;
    const searchContactRes = await fetch(searchContactUrl, { headers });
    const searchContactData: any = await searchContactRes.json();

    if (searchContactData.data && searchContactData.data.length > 0) {
      contactId = searchContactData.data[0].id;
      console.log(`âœ… Existing Zoho Contact found: ${contactId}`);
    } else {
      const createContactUrl = "https://www.zohoapis.com/bigin/v1/Contacts";
      const contactBody = {
        data: [
          {
            First_Name: "Contact (Free Audit)",
            Last_Name: lead.company_name,
            Email: lead.email,
            Phone: lead.phone,
            Account_Name: {
              id: accountId,
            },
          },
        ],
      };

      const createContactRes = await fetch(createContactUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(contactBody),
      });
      const createContactData: any = await createContactRes.json();

      if (!createContactData.data || !createContactData.data[0]) {
        throw new Error(`Failed to create Contact: ${JSON.stringify(createContactData)}`);
      }

      contactId = createContactData.data[0].details.id;
      console.log(`âœ… Created new Zoho Contact: ${contactId}`);
    }

    // Step 3: Create Deal associated with the Account & Contact
    const createDealUrl = "https://www.zohoapis.com/bigin/v1/Deals";
    const dealBody: any = {
      data: [
        {
          Deal_Name: `${lead.company_name} - ${lead.audit_type === "website_audit" ? "Website Audit" : "SEO Audit"} Request`,
          Account_Name: {
            id: accountId,
          },
          Contact_Name: {
            id: contactId,
          },
          Description: `Automated Free Audit Request for ${lead.website_url}. Requested option: ${lead.audit_type}`,
        },
      ],
    };

    // If sub-pipeline and specific stage IDs are set, associate them
    if (pipelineId && pipelineId !== "placeholder_pipeline_id") {
      dealBody.data[0].Pipeline = { id: pipelineId };
    }
    if (stageId && stageId !== "placeholder_stage_id") {
      dealBody.data[0].Stage = stageId;
    } else {
      // Zoho Bigin standard default stage
      dealBody.data[0].Stage = "Qualification";
    }

    const createDealRes = await fetch(createDealUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(dealBody),
    });
    const createDealData: any = await createDealRes.json();

    if (!createDealData.data || !createDealData.data[0]) {
      throw new Error(`Failed to create Zoho Deal: ${JSON.stringify(createDealData)}`);
    }

    console.log(`âœ… Zoho Deal created successfully: ${createDealData.data[0].details.id}`);
  } catch (error) {
    console.error("âŒ Zoho CRM Error:", error);
    throw new Error(`Failed to update Zoho Bigin CRM: ${error instanceof Error ? error.message : String(error)}`);
  }
}

