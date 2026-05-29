import nodemailer from "nodemailer";
import { LeadData } from "./sheets.js";

/**
 * Sends a premium-designed, highly personalized email to the client with their Google Doc link.
 */
export async function sendPersonalizedAuditEmail(
  lead: LeadData,
  docLink: string
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM_EMAIL || "audit@thedarenetwork.com";

  if (!host || !user || !pass || pass === "re_placeholder") {
    console.warn("⚠️ SMTP credentials missing or placeholder used. Skipping email delivery.");
    return;
  }

  const isSeo = lead.audit_type === "seo";
  const auditName = isSeo ? "SEO & Search Rankings Audit" : "Website & Conversion Audit";

  const emailSubject = `Your Complimentary ${auditName} is Ready! - ${lead.company_name}`;

  const emailHtml = `
<div style="font-family: 'Arial', sans-serif; line-height: 1.6; color: #333333; max-width: 600px; margin: 0 auto; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
  <!-- Header Banner -->
  <div style="background-color: #1E3A8A; color: #FFFFFF; padding: 30px 25px; text-align: center;">
    <h1 style="margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 0.5px;">THE DARE NETWORK</h1>
    <p style="margin: 6px 0 0 0; color: #93C5FD; font-size: 13px; letter-spacing: 1px; text-transform: uppercase;">Complimentary Performance Assessment</p>
  </div>
  
  <!-- Content Body -->
  <div style="padding: 30px 25px; background-color: #FFFFFF;">
    <p style="font-size: 15px; margin-top: 0; color: #374151;">Hi Team at <strong>${lead.company_name}</strong>,</p>
    
    <p style="font-size: 14.5px; color: #4B5563;">Thank you for requesting a free audit with us! We have completed our comprehensive review of <strong>${lead.website_url}</strong>.</p>
    
    <p style="font-size: 14.5px; color: #4B5563;">Instead of a generic automated checklist, our senior specialists have generated a bespoke <strong>${auditName}</strong> mapping real issues on your site and ranking them by severity.</p>
    
    <!-- CTA Button Block -->
    <div style="text-align: center; margin: 35px 0;">
      <a href="${docLink}" target="_blank" style="background-color: #2563EB; color: #FFFFFF; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 15px; display: inline-block; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">Access Your Google Doc Audit Report 📄</a>
    </div>
    
    <p style="font-size: 14.5px; color: #4B5563;">Our goal is to prove we understand your business and to show you exactly how your current site is costing you customers and organic traffic in ways you can easily see once pointed out.</p>
    
    <p style="font-size: 14.5px; color: #4B5563;"><strong>What's Next?</strong> We would love to host a quick, complimentary 15-minute call to walk you through these findings, clarify any technical aspects, and discuss a potential roadmap to double your conversions.</p>
    
    <p style="font-size: 14.5px; color: #4B5563;">Feel free to reply directly to this email or book a time with us directly!</p>
    
    <p style="font-size: 14.5px; margin-bottom: 0; color: #374151;">Warm regards,</p>
    <p style="font-size: 15px; margin-top: 5px; font-weight: bold; color: #1E3A8A;">The Dare Network Team</p>
  </div>
  
  <!-- Footer Banner -->
  <div style="background-color: #F9FAFB; border-top: 1px solid #F3F4F6; padding: 20px; text-align: center; font-size: 11px; color: #9CA3AF;">
    <p style="margin: 0;">This assessment is sent to ${lead.email} upon free request.</p>
    <p style="margin: 4px 0 0 0;">&copy; ${new Date().getFullYear()} The Dare Network. All rights reserved.</p>
  </div>
</div>
  `.trim();

  try {
    console.log(`✉️ Setting up SMTP transport for email delivery to: ${lead.email}`);
    
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // True for port 465, false for other ports
      auth: {
        user,
        pass,
      },
    });

    await transporter.sendMail({
      from: `"The Dare Network" <${fromEmail}>`,
      to: lead.email,
      subject: emailSubject,
      html: emailHtml,
    });

    console.log(`✅ Personalized audit email successfully dispatched to: ${lead.email}`);
  } catch (error) {
    console.error("❌ Nodemailer SMTP Error:", error);
    throw new Error(`Failed to send email to client: ${error instanceof Error ? error.message : String(error)}`);
  }
}
