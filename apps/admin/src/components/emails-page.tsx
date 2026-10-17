"use client";

import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

interface EmailItem {
  id: string;
  from: string;
  subject: string;
  preview: string;
  time: string;
  unread: boolean;
}

const EMAILS: EmailItem[] = [
  {
    id: "e1",
    from: "PPIDK Asiania",
    subject: "October newsletter sent",
    preview: "Your October edition was sent to 4,321 recipients.",
    time: "2 hours ago",
    unread: true,
  },
  {
    id: "e2",
    from: "System",
    subject: "New article published",
    preview: '"Workshop Activity Recap" is now live on the website.',
    time: "5 hours ago",
    unread: true,
  },
  {
    id: "e3",
    from: "Event Committee",
    subject: "Event updated",
    preview: '"Social Media Ethics Webinar" details were updated.',
    time: "1 day ago",
    unread: false,
  },
  {
    id: "e4",
    from: "Audit Service",
    subject: "Login from new device",
    preview: "A new sign-in was detected from Chrome on Windows.",
    time: "1 day ago",
    unread: false,
  },
  {
    id: "e5",
    from: "PPIDK Asiania",
    subject: "Weekly report",
    preview: "Here is your weekly activity summary for PPIDK Asiania.",
    time: "2 days ago",
    unread: false,
  },
  {
    id: "e6",
    from: "System",
    subject: "Backup completed",
    preview: "The automatic database backup finished successfully.",
    time: "2 days ago",
    unread: false,
  },
  {
    id: "e7",
    from: "Organizations",
    subject: "New member registered",
    preview: "United Informatics Students joined the directory.",
    time: "3 days ago",
    unread: false,
  },
  {
    id: "e8",
    from: "PPIDK Asiania",
    subject: "Account notice",
    preview: "Your administrator role and permissions were reviewed.",
    time: "5 days ago",
    unread: false,
  },
];

const unreadCount = EMAILS.filter((e) => e.unread).length;

/**
 * Recovered admin "Emails" page (Vite admin, session b561ba27) ported to the
 * new admin: inbox list with unread highlights and a New pill per unread item.
 */
export function EmailsPage() {
  return (
    <div className="admin-acct-page">
      <Card className="admin-acct-card">
        <CardHeader title="Emails" subtitle={`${EMAILS.length} messages · ${unreadCount} unread`} />
        <CardBody flush>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {EMAILS.map((email) => (
              <div key={email.id} className="admin-acct-email">
                <div
                  className="admin-acct-avatar"
                  style={{
                    background: email.unread ? "var(--color-brand-50)" : "var(--color-panel-line)",
                    color: email.unread ? "var(--color-brand-950)" : "var(--color-on-panel-muted)",
                  }}
                >
                  <Icon name="mail" size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className={[
                      "admin-acct-email__subject",
                      email.unread ? "admin-acct-email__subject--unread" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {email.subject}
                    {email.unread ? <span className="admin-acct-email__dot">•</span> : null}
                  </div>
                  <div className="admin-acct-email__meta">
                    <span>{email.from}</span>
                    <span>·</span>
                    <span className="admin-acct-email__preview">{email.preview}</span>
                  </div>
                </div>
                <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                  <span className="admin-acct-email__time">{email.time}</span>
                  <div style={{ marginTop: "var(--space-1)" }}>
                    {email.unread ? <span className="admin-acct-newpill">New</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
