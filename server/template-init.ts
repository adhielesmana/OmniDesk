// Automatic Twilio Template Initialization
// Runs on server startup to ensure templates are properly configured

import { storage } from "./storage";
import { 
  isTwilioConfigured, 
  getAuthForHttp, 
  submitTemplateForApproval, 
  deleteTemplateFromTwilio 
} from "./twilio";

const INVOICE_TEMPLATE_BODY = `Yth. {{1}},

{{2}}

Nomor Invoice: {{3}}
Total Tagihan: Rp {{4}}

Untuk melihat detail dan pembayaran, silakan klik:
{{5}}

Jika sudah melakukan pembayaran, mohon abaikan pesan ini.

Terima kasih,
MAXNET Customer Care
wa.me/6208991066262`;

const TEMPLATE_VARIABLES = ["recipient_name", "message_type", "invoice_number", "grand_total", "invoice_url"];

export async function initializeTwilioTemplates(): Promise<void> {
  try {
    // Check if Twilio is configured
    const twilioAvailable = await isTwilioConfigured();
    if (!twilioAvailable) {
      console.log("[Template Init] Twilio not configured, skipping template initialization");
      return;
    }

    // Get invoice_reminder template
    const template = await storage.getMessageTemplateByName("invoice_reminder");
    if (!template) {
      console.log("[Template Init] No invoice_reminder template found, skipping");
      return;
    }

    // Check if template needs recreation
    // Signs it needs recreation:
    // 1. Has ContentSid but content contains [variable_name] format (broken template)
    // 2. ContentSid is null/empty but template exists
    const needsRecreation = !template.twilioContentSid || 
      (template.content && template.content.includes('[recipient_name]')) ||
      (template.content && template.content.includes('[invoice_number]'));

    if (!needsRecreation) {
      console.log(`[Template Init] Template ${template.twilioContentSid} already properly configured`);
      return;
    }

    console.log("[Template Init] Template needs recreation with proper numbered variables...");

    // Get auth for API calls
    const auth = await getAuthForHttp();
    if (!auth) {
      console.error("[Template Init] Cannot get Twilio auth credentials");
      return;
    }

    // Delete old template if exists
    if (template.twilioContentSid) {
      console.log(`[Template Init] Deleting old template ${template.twilioContentSid}...`);
      try {
        await deleteTemplateFromTwilio(template.twilioContentSid);
      } catch (err) {
        console.warn("[Template Init] Error deleting old template (may not exist):", err);
      }
    }

    // Create new template with proper numbered variables
    const payload = {
      friendly_name: `invoice_reminder_${Date.now()}`,
      language: "id",
      types: {
        "twilio/text": {
          body: INVOICE_TEMPLATE_BODY
        }
      },
      variables: {
        "1": "Pelanggan",
        "2": "Berikut adalah tagihan baru untuk layanan internet Anda:",
        "3": "INV000000",
        "4": "100000",
        "5": "https://invoice.example.com"
      }
    };

    console.log("[Template Init] Creating new template with numbered variables...");
    const response = await fetch('https://content.twilio.com/v1/Content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth.authString}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[Template Init] Failed to create template:", result);
      return;
    }

    const newContentSid = result.sid;
    console.log(`[Template Init] Template created: ${newContentSid}`);

    // Submit for WhatsApp approval
    console.log("[Template Init] Submitting for WhatsApp approval...");
    const approvalResult = await submitTemplateForApproval(newContentSid);
    
    let approvalStatus = "pending";
    if (approvalResult.success && approvalResult.status) {
      approvalStatus = approvalResult.status;
    }

    // Update database with new ContentSid and proper content
    await storage.updateMessageTemplate(template.id, {
      content: INVOICE_TEMPLATE_BODY,
      variables: TEMPLATE_VARIABLES,
      twilioContentSid: newContentSid,
      twilioApprovalStatus: approvalStatus,
      twilioSyncedAt: new Date(),
    } as any);

    console.log(`[Template Init] SUCCESS! Template recreated with ContentSid: ${newContentSid}, Status: ${approvalStatus}`);
    console.log("[Template Init] Template will be ready for use once WhatsApp approves it.");

  } catch (error) {
    console.error("[Template Init] Error during template initialization:", error);
  }
}
