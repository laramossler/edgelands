import twilio from 'twilio';
import sgMail from '@sendgrid/mail';

// Initialize Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER!;

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function sendSMS(to: string, message: string): Promise<boolean> {
  try {
    await twilioClient.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to,
    });
    return true;
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return false;
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string
): Promise<boolean> {
  try {
    await sgMail.send({
      to,
      from: process.env.SENDGRID_FROM_EMAIL || 'edgelands@yourdomain.com',
      subject,
      text,
      html: html || text,
    });
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

// Sunday ops review notification
export async function sendOpsReviewNotification(phone: string, email: string): Promise<void> {
  const smsMessage = "Edgelands weekly review time 🌲";
  const emailSubject = "Time for your weekly Edgelands review";
  const emailBody = `
    <h2>Weekly Ops Review</h2>
    <p>It's time for your Sunday operations review.</p>
    <p><a href="${process.env.NEXT_PUBLIC_APP_URL}/chat">Start your review</a></p>
  `;

  await Promise.all([
    sendSMS(phone, smsMessage),
    sendEmail(email, emailSubject, "Time for your weekly Edgelands review. Visit the chat to start.", emailBody),
  ]);
}

// Relationship nudge notification
export async function sendRelationshipNudge(phone: string, email: string, relationshipName: string, tier: number, daysSince: number): Promise<void> {
  const smsMessage = `Edgelands: ${relationshipName} (Tier ${tier}) - ${daysSince} days since last contact`;

  const emailSubject = `Relationship nudge: ${relationshipName}`;
  const emailBody = `
    <h2>Relationship Check-in</h2>
    <p><strong>${relationshipName}</strong> (Tier ${tier})</p>
    <p>It's been ${daysSince} days since your last contact.</p>
    <p>Consider reaching out to maintain this connection.</p>
  `;

  await Promise.all([
    sendSMS(phone, smsMessage),
    sendEmail(email, emailSubject, `${relationshipName} (Tier ${tier}) - ${daysSince} days since last contact`, emailBody),
  ]);
}

// Monthly pattern report
export async function sendMonthlyReport(email: string, report: string): Promise<void> {
  const subject = "Edgelands Monthly Pattern Analysis";
  const html = `
    <h2>Monthly Pattern Analysis</h2>
    <div style="white-space: pre-wrap; font-family: monospace;">
      ${report}
    </div>
  `;

  await sendEmail(email, subject, report, html);
}

// Generic notification helper
export async function notify(
  channels: { sms?: string; email?: string },
  content: { subject?: string; message: string; html?: string }
): Promise<{ sms: boolean; email: boolean }> {
  const results = {
    sms: false,
    email: false,
  };

  if (channels.sms) {
    results.sms = await sendSMS(channels.sms, content.message);
  }

  if (channels.email && content.subject) {
    results.email = await sendEmail(
      channels.email,
      content.subject,
      content.message,
      content.html
    );
  }

  return results;
}
