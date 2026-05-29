import express from "express";
import dotenv from "dotenv";
import { tasks, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import crypto from "crypto";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Capture raw body for signature verification
app.use(
  express.json({
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    verify: (req: any, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// Slack Signature Verification Middleware
function verifySlackSignature(req: any, res: any, next: any) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  
  // Dev fallback: skip verification if secret is not set or using placeholder
  if (!signingSecret || signingSecret === "placeholder-signing-secret") {
    console.log("⚠️ Slack Signature Verification skipped (no secret or placeholder used)");
    return next();
  }

  const signature = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];

  if (!signature || !timestamp) {
    return res.status(401).send("Unauthorized: Missing signature or timestamp headers");
  }

  // Prevent replay attacks (reject timestamps older than 5 minutes)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp as string, 10) < fiveMinutesAgo) {
    return res.status(401).send("Unauthorized: Replay attack protection triggered (timestamp expired)");
  }

  const rawBody = req.rawBody || "";
  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBaseString, "utf8")
      .digest("hex");

  try {
    if (
      crypto.timingSafeEqual(
        Buffer.from(mySignature, "utf8"),
        Buffer.from(signature as string, "utf8")
      )
    ) {
      return next();
    }
  } catch (err) {
    // Fallback if timingSafeEqual fails due to length mismatch
  }

  return res.status(401).send("Unauthorized: Invalid signature");
}

// Zod Input Validation for WordPress Webhook
const wordpressPayloadSchema = z.object({
  website_url: z.string().url("Invalid website URL format"),
  company_name: z.string().min(1, "Company Name is required"),
  email: z.string().email("Invalid email format"),
  phone: z.string().min(5, "Valid phone number is required"),
  audit_type: z.enum(["website_audit", "seo"], {
    errorMap: () => ({ message: "Audit Type must be 'website_audit' or 'seo'" }),
  }),
});

// Endpoint 1: Receive WordPress Form Webhook
app.post("/api/webhook/wordpress", async (req, res) => {
  try {
    console.log("📥 Received WordPress Form Submission:", req.body);
    
    // Validate request body
    const validatedData = wordpressPayloadSchema.parse(req.body);

    // Trigger the main workflow task
    const handle = await tasks.trigger("free-audit-workflow", validatedData);

    console.log(`🚀 Triggered task 'free-audit-workflow' with run ID: ${handle.id}`);
    
    return res.status(200).json({
      success: true,
      message: "Lead successfully captured and task triggered.",
      runId: handle.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors.map((e) => e.message),
      });
    }
    
    console.error("❌ Error triggering task:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error triggering workflow.",
    });
  }
});

// Endpoint 2: Receive Slack Interactive Button Clicks
app.post("/api/webhook/slack-interactivity", verifySlackSignature, async (req, res) => {
  try {
    if (!req.body.payload) {
      return res.status(400).send("Bad Request: Missing payload");
    }

    const payload = JSON.parse(req.body.payload);
    
    // Handle block actions
    if (payload.type === "block_actions" && payload.actions && payload.actions[0]) {
      const action = payload.actions[0];
      const actionValue = JSON.parse(action.value);
      
      const { tokenId, decision } = actionValue;
      const username = payload.user.name;

      console.log(`🔘 Slack interaction from @${username}: Decision = ${decision}, TokenId = ${tokenId}`);

      // Complete the token in Trigger.dev
      await wait.completeToken(tokenId, {
        approved: decision === "approve",
        reviewer: username,
      });

      // Update the Slack message to remove buttons and show reviewer decision
      if (payload.response_url) {
        let updatedBlocks = payload.message.blocks;
        
        // Remove the action block (usually the last block or block with elements)
        updatedBlocks = updatedBlocks.filter((block: any) => block.type !== "actions");
        
        // Add a context/divider section showing who made the decision
        const statusEmoji = decision === "approve" ? "✅ APPROVED" : "❌ DECLINED";
        updatedBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Status:* ${statusEmoji} by @${username}`,
          },
        });

        await fetch(payload.response_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            replace_original: "true",
            blocks: updatedBlocks,
          }),
        });
      }

      // Return a 200 OK immediately to Slack
      return res.status(200).send();
    }

    return res.status(400).send("Unhandled interaction type");
  } catch (error) {
    console.error("❌ Error handling Slack interactivity:", error);
    return res.status(500).send("Internal server error");
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`🟢 Express Webhook Server is running on port ${PORT}`);
  console.log(`🔗 WordPress Endpoint: http://localhost:${PORT}/api/webhook/wordpress`);
  console.log(`🔗 Slack Interactivity: http://localhost:${PORT}/api/webhook/slack-interactivity`);
});
