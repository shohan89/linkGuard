import { Resend } from "resend";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const FROM_ADDRESS = process.env.NOTIFICATIONS_FROM_EMAIL ?? "LinkGuard <onboarding@resend.dev>";

let client: Resend | undefined;

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!client) {
    client = new Resend(apiKey);
  }
  return client;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY is not set — email sending is disabled");
    this.name = "EmailNotConfiguredError";
  }
}

export const EmailService = {
  /**
   * Throws EmailNotConfiguredError when RESEND_API_KEY isn't set, rather
   * than silently no-op-ing — callers (NotificationService) catch that
   * specifically to record the notification as FAILED with a clear reason,
   * instead of the scan/scheduler pipeline breaking because email isn't
   * wired up yet.
   */
  async send(message: EmailMessage): Promise<void> {
    const resend = getClient();
    if (!resend) {
      throw new EmailNotConfiguredError();
    }

    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (error) {
      throw new Error(`Resend rejected the email: ${error.message}`);
    }
  },
};
