import { previewOf } from "@/lib/format";

const BRAND = "#5D8156";
const SAGE = "#CFD5B9";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layout(title: string, bodyHtml: string, footerHtml: string): string {
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${SAGE};font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif;color:#1D1C1D">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${SAGE};padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
        <tr><td style="background:${BRAND};padding:18px 28px;color:#fff;font-size:18px;font-weight:700">Stayful</td></tr>
        <tr><td style="padding:28px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
        <tr><td style="padding:0 28px 24px;font-size:12px;line-height:1.5;color:#616061">${footerHtml}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(label)}</a></p>`;
}

export interface WelcomeEmailInput {
  recipientName: string;
  email: string;
  password: string;
  loginUrl: string;
  invitedBy: string;
  groups: string[];
}

export function welcomeEmail(input: WelcomeEmailInput) {
  const subject = "Your Stayful messaging account";
  const groups = input.groups.length
    ? `<p>You've been added to: <strong>${input.groups.map(escapeHtml).join(", ")}</strong>.</p>`
    : "";
  const html = layout(
    subject,
    `<p>Hi ${escapeHtml(input.recipientName)},</p>
     <p>${escapeHtml(input.invitedBy)} has set up your Stayful messaging account. This is where you'll hear from the team about your property, and where you can message us any time.</p>
     <table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0;background:#F3F6F0;border-radius:10px;width:100%">
       <tr><td style="padding:14px 18px;font-size:14px"><div style="color:#616061">Login email</div><div style="font-weight:600">${escapeHtml(input.email)}</div></td></tr>
       <tr><td style="padding:0 18px 14px;font-size:14px"><div style="color:#616061">Password</div><div style="font-weight:600;font-family:ui-monospace,Menlo,monospace;font-size:16px;letter-spacing:.5px">${escapeHtml(input.password)}</div></td></tr>
     </table>
     ${groups}
     ${button(input.loginUrl, "Sign in to Stayful")}
     <p style="color:#616061;font-size:14px">Your browser will offer to remember the login so you won't need to type it again. You can change the password at any time from <em>You → Account</em> in the app.</p>`,
    `<p>Messages with our team may be viewed by Stayful management for quality and continuity.</p>
     <p>Sent to ${escapeHtml(input.email)} because a Stayful team member created an account for you.</p>`,
  );
  const text = `Hi ${input.recipientName},

${input.invitedBy} has set up your Stayful messaging account.

Login email: ${input.email}
Password: ${input.password}
${input.groups.length ? `\nYou've been added to: ${input.groups.join(", ")}\n` : ""}
Sign in: ${input.loginUrl}

You can change the password at any time from You -> Account in the app.
Messages with our team may be viewed by Stayful management for quality and continuity.`;
  return { subject, html, text };
}

export interface MessageEmailItem {
  senderName: string;
  body: string;
  createdAt: string;
}

export interface MessageEmailInput {
  recipientName: string;
  conversationTitle: string;
  items: MessageEmailItem[];
  viewUrl: string;
  unsubscribeUrl: string;
  canReplyByEmail?: boolean;
}

export function messageEmail(input: MessageEmailInput) {
  const first = input.items[0];
  const subject =
    input.items.length === 1
      ? `${first.senderName} sent you a message`
      : `${input.items.length} new messages from ${Array.from(new Set(input.items.map((i) => i.senderName))).join(", ")}`;
  const itemsHtml = input.items
    .map(
      (i) =>
        `<div style="margin:0 0 14px;padding:12px 16px;background:#F3F6F0;border-radius:10px"><div style="font-weight:700">${escapeHtml(i.senderName)}</div><div style="white-space:pre-wrap">${escapeHtml(i.body)}</div></div>`,
    )
    .join("");
  const html = layout(
    subject,
    `<p>Hi ${escapeHtml(input.recipientName)},</p>
     <p>New in <strong>${escapeHtml(input.conversationTitle)}</strong>:</p>
     ${itemsHtml}
     ${button(input.viewUrl, "View and reply")}
     ${input.canReplyByEmail ? `<p style="color:#616061;font-size:14px">You can also just reply to this email and your message will reach the team in the same conversation.</p>` : ""}`,
    `<p>You're receiving this because email notifications are on for your Stayful account. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#3E6E3A">Turn off email notifications</a>.</p>`,
  );
  const text = `Hi ${input.recipientName},

New in ${input.conversationTitle}:

${input.items.map((i) => `${i.senderName}: ${previewOf(i.body, 2000)}`).join("\n\n")}

View and reply: ${input.viewUrl}
${input.canReplyByEmail ? "\nYou can also reply to this email and your message will reach the team.\n" : ""}
Turn off email notifications: ${input.unsubscribeUrl}`;
  return { subject, html, text };
}
