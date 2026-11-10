"use client";

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  addSubscriberAction,
  exportSubscribersAction,
  importSubscribersAction,
  removeCampaignAction,
  removeSubscriberAction,
  saveCampaignAction,
  sendCampaignAction,
  sendTestAction,
} from "@/app/(panel)/newsletter/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { UploadBar } from "@/components/ui/upload-bar";
import { Button } from "@/components/ui/button";
import type { Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Icon, type IconName } from "@/components/ui/icon";
import { ConfirmDialog, DELETE_HINT } from "@/components/ui/confirm-dialog";
import {
  ListCard,
  ListEmpty,
  MenuDivider,
  MenuItem,
  RowMenu,
  SearchBox,
  SelectCheckbox,
  Tabs,
  useBulkActions,
  useListTable,
  SortMenu,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import {
  joinBlocks,
  newBlock,
  splitBlocks,
  RichTextStack,
  type RichTextBlock,
} from "@/components/ui/rich-text-box";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { timeAgo } from "@/components/format";
import { countText } from "./list-model";
import type { CampaignItem as NewsletterItem, SubscriberItem } from "./newsletter-model";
import { Select } from "@/components/ui/select";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${dayMonth(d)} ${d.getUTCFullYear()}`;
};
const formatSendTime = (iso: string) => {
  const d = new Date(iso);
  return `${dayMonth(d)}, ${d.toISOString().slice(11, 16)} UTC`;
};
const formatCount = (n: number) => n.toLocaleString("en-US");
const formatRate = (rate: number | null) => (rate === null ? "—" : `${(rate * 100).toFixed(1)}%`);
const formatPoints = (delta: number) =>
  `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)} pts`;

const STATUS_BADGE: Record<NewsletterItem["status"], { label: string; icon: IconName }> = {
  sent: { label: "Sent", icon: "check" },
  sending: { label: "Sending", icon: "send" },
  scheduled: { label: "Scheduled", icon: "clock" },
  draft: { label: "Draft", icon: "dot" },
};

const wentOut = (c: NewsletterItem) => c.status === "sent" || c.status === "sending";
const changeable = (c: NewsletterItem) => c.status === "draft" || c.status === "scheduled";

const EMPTY_ITEM: NewsletterItem = {
  id: "",
  version: 1,
  subject: "",
  body: "",
  status: "draft",
  sendAt: null,
  sentAt: null,
  sentCount: 0,
  openCount: 0,
  clickCount: 0,
  openRate: null,
  clickRate: null,
  modifiedAt: "",
  author: null,
};

export interface NewsletterStats {
  active: number;
  thisMonth: number;
  open: number | null;
  click: number | null;
  openDelta: number | null;
  clickDelta: number | null;
}

type DeleteConfirm = { kind: "campaign"; ids: string[] } | { kind: "subscriber"; ids: string[] };

function EmailPreview({ html }: { html: string }) {
  const doc =
    "<!doctype html><meta charset=utf-8><style>body{font-family:system-ui,sans-serif;" +
    "line-height:1.5;margin:16px}img{max-width:100%;height:auto}</style>" +
    html;
  return <iframe className="admin-newsletter-preview" sandbox="" srcDoc={doc} title="Preview" />;
}

type CampaignSortKey = "subject" | "status" | "recipients" | "open" | "click" | "sent";
type SubscriberSortKey = "name" | "ppi" | "subscribed";

const campaignSortValue = (c: NewsletterItem, key: CampaignSortKey): string | number => {
  switch (key) {
    case "subject":
      return c.subject.toLowerCase();
    case "status":
      return c.status;
    case "recipients":
      return c.sentCount;
    case "open":
      return c.openRate ?? -1;
    case "click":
      return c.clickRate ?? -1;
    case "sent":
      return c.sentAt ?? c.sendAt ?? c.modifiedAt;
  }
};

const subscriberSortValue = (s: SubscriberItem, key: SubscriberSortKey): string =>
  key === "name"
    ? (s.name ?? s.email).toLowerCase()
    : key === "ppi"
      ? (s.ppi ?? "").toLowerCase()
      : s.subscribed;

const campaignFilterText = (c: NewsletterItem, key: CampaignSortKey): string => {
  switch (key) {
    case "subject":
      return c.subject;
    case "status":
      return STATUS_BADGE[c.status].label;
    case "recipients":
      return formatCount(c.sentCount);
    case "open":
      return formatRate(c.openRate);
    case "click":
      return formatRate(c.clickRate);
    case "sent":
      return formatDate(
        c.status === "draft" ? c.modifiedAt : (c.sentAt ?? c.sendAt ?? c.modifiedAt),
      );
  }
};

const subscriberFilterText = (s: SubscriberItem, key: SubscriberSortKey): string =>
  key === "name" ? (s.name ?? s.email) : key === "ppi" ? (s.ppi ?? "") : formatDate(s.subscribed);

interface NewsletterForm {
  subject: string;
  bodies: RichTextBlock[];
}

const EMPTY_FORM: NewsletterForm = {
  subject: "",
  bodies: [newBlock()],
};

interface NewsletterProps {
  campaigns: NewsletterItem[];
  subscribers: SubscriberItem[];
  chapters: { id: string; name: string }[];
  stats: NewsletterStats;
  publicBase: string;
  canEdit: boolean;
  canSend: boolean;
  canExport: boolean;
}

export function NewsletterPage(props: NewsletterProps) {
  const pathname = usePathname();
  return <NewsletterList key={pathname} {...props} />;
}

const EMPTY_SUBSCRIBER = { email: "", name: "", chapterId: "" };

function NewsletterList({
  campaigns,
  subscribers,
  chapters,
  stats,
  publicBase,
  canEdit,
  canSend,
  canExport,
}: NewsletterProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const upload = useImageUpload("newsletter");
  const importInputRef = useRef<HTMLInputElement>(null);
  const [publishFor, setPublishFor] = useState<NewsletterItem[] | null>(null);
  const [scheduleFor, setScheduleFor] = useState<NewsletterItem | null>(null);
  const [sendAt, setSendAt] = useState("");
  const [previewFor, setPreviewFor] = useState<{ subject: string; body: string } | null>(null);
  const [resultsFor, setResultsFor] = useState<NewsletterItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newSubscriber, setNewSubscriber] = useState(EMPTY_SUBSCRIBER);
  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<NewsletterForm>(EMPTY_FORM);

  const [tab, setTab] = useState<"campaign" | "subscriber">("campaign");
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);

  const isCampaign = tab === "campaign";

  const filteredCampaigns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((c) => !q || c.subject.toLowerCase().includes(q));
  }, [campaigns, query]);

  const filteredSubs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return subscribers.filter(
      (s) => !q || s.email.toLowerCase().includes(q) || !!s.name?.toLowerCase().includes(q),
    );
  }, [subscribers, query]);

  const campaignTable = useListTable(
    filteredCampaigns,
    campaignSortValue,
    undefined,
    campaignFilterText,
  );
  const subTable = useListTable(filteredSubs, subscriberSortValue, undefined, subscriberFilterText);
  const selected = isCampaign ? campaignTable.selected : subTable.selected;

  const resetPaging = () => {
    campaignTable.setPage(1);
    subTable.setPage(1);
  };

  const switchTab = (next: "campaign" | "subscriber") => {
    setTab(next);
    campaignTable.clearSelection();
    subTable.clearSelection();
    setQuery("");
    setSearchKey((k) => k + 1);
    resetPaging();
  };

  const clearFilters = () => {
    setQuery("");
    setSearchKey((k) => k + 1);
    campaignTable.clearFilters();
    subTable.clearFilters();
    resetPaging();
  };

  const bulk = useBulkActions({
    noun: "campaign",
    show: toast.show,
    onFailure: (failure) => toast.show(actionMessage(failure)),
    onFinish: () => {
      campaignTable.clearSelection();
      subTable.clearSelection();
    },
  });
  const { busy, setBusy } = bulk;

  const askDelete = (kind: DeleteConfirm["kind"], ids: string[]) => {
    if (ids.length > 0) setDeleteConfirm({ kind, ids });
  };

  const doDelete = async () => {
    if (!deleteConfirm) return;
    const { kind, ids } = deleteConfirm;
    setDeleteConfirm(null);
    if (kind === "subscriber") {
      await bulk.run(
        ids,
        (id) => removeSubscriberAction({ id }),
        (n) => `${countText(n, "subscriber")} deleted`,
      );
      return;
    }
    const rows = campaigns.filter((c) => ids.includes(c.id));
    const deletable = rows.filter((c) => c.status !== "sending");
    await bulk.run(
      deletable,
      (c) => removeCampaignAction({ id: c.id, version: c.version }),
      (n) =>
        `${countText(n, "campaign")} deleted` +
        (rows.length > n ? ` · ${rows.length - n} still sending, kept` : ""),
    );
  };

  const doPublish = async () => {
    if (!publishFor) return;
    const rows = publishFor.filter(changeable);
    setPublishFor(null);
    await bulk.run(
      rows,
      (c) => sendCampaignAction({ id: c.id, version: c.version, sendAt: null }),
      (n) => (n === 1 ? "Sending started" : `Sending started for ${n} campaigns`),
    );
    setView("list");
  };

  const doSchedule = async () => {
    if (!scheduleFor || !sendAt) return;
    setBusy(true);
    const result = await sendCampaignAction({
      id: scheduleFor.id,
      version: scheduleFor.version,
      sendAt: new Date(sendAt).toISOString(),
    });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    setScheduleFor(null);
    setSendAt("");
    router.refresh();
    toast.show(result.data.status === "scheduled" ? "Campaign scheduled" : "Sending started");
  };

  const copyLink = (c: NewsletterItem) => {
    void navigator.clipboard?.writeText(`${publicBase}/newsletter/${c.id}`);
    toast.show("Link copied");
  };

  const exportCsv = async () => {
    const result = await exportSubscribersAction();
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    const url = URL.createObjectURL(
      new Blob(["﻿" + result.data.csv + "\r\n"], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.show(`Exported ${subscribers.length} subscribers`);
  };

  const importCsv = async (file: File) => {
    setBusy(true);
    const result = await importSubscribersAction({ csv: await file.text() });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    const { added, existing, unsubscribed, invalid } = result.data;
    router.refresh();
    toast.show(
      [
        `${added} invited (confirmation e-mail sent)`,
        existing ? `${existing} already on the list` : "",
        unsubscribed ? `${unsubscribed} unsubscribed, skipped` : "",
        invalid.length
          ? `invalid row${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  };

  const addSubscriber = async () => {
    setBusy(true);
    const result = await addSubscriberAction({
      email: newSubscriber.email,
      name: newSubscriber.name,
      chapterId: newSubscriber.chapterId || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    setAddOpen(false);
    setNewSubscriber(EMPTY_SUBSCRIBER);
    router.refresh();
    toast.show(
      result.data.outcome === "start"
        ? "Confirmation e-mail sent; they are added once they confirm"
        : result.data.outcome === "exists"
          ? "This address is already on the list"
          : "This address unsubscribed; they can sign up again on the website",
    );
  };

  const toForm = (mode: "create" | "edit", item?: NewsletterItem) => {
    setFormMode(mode);
    setEditingId(item?.id ?? null);
    setForm(item ? { subject: item.subject, bodies: splitBlocks(item.body) } : EMPTY_FORM);
    campaignTable.clearSelection();
    setView("form");
  };

  const formBody = () => joinBlocks(form.bodies);

  const saveDraft = async (): Promise<{ id: string; version: number } | null> => {
    const current = campaigns.find((c) => c.id === editingId);
    setBusy(true);
    const result = await saveCampaignAction({
      ...(editingId ? { id: editingId } : {}),
      version: current?.version ?? null,
      subject: form.subject,
      body: formBody(),
      segment: "all",
    });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return null;
    }
    setEditingId(result.data.id);
    router.refresh();
    return result.data;
  };

  const saveAndClose = async () => {
    if (await saveDraft()) {
      toast.show("Draft saved");
      setView("list");
    }
  };

  const publishCampaign = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    setPublishFor([
      {
        ...(campaigns.find((c) => c.id === saved.id) ?? EMPTY_ITEM),
        id: saved.id,
        version: saved.version,
        subject: form.subject,
        status: "draft",
      },
    ]);
  };

  const sendTest = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    const result = await sendTestAction({ id: saved.id });
    toast.show(result.ok ? "Test e-mail sent to your address" : actionMessage(result));
  };

  const uploadImage = async (file: File) => {
    const image = await upload.upload(file);
    if (!image) toast.show(upload.error ?? "Upload failed");
    return image ? (publicImage(image)?.url ?? null) : null;
  };

  const checkboxCol = <T extends { id: string }>(
    table: {
      pageAll: boolean;
      pageSome: boolean;
      togglePage: () => void;
      selected: Set<string>;
      toggle: (id: string) => void;
    },
    label: (item: T) => string,
  ): Column<T> => ({
    key: "check",
    width: "24px",
    align: "left",
    header: (
      <SelectCheckbox
        label="Select all on page"
        checked={table.pageAll}
        indeterminate={table.pageSome && !table.pageAll}
        onChange={table.togglePage}
      />
    ),
    render: (r) => (
      <SelectCheckbox
        label={label(r)}
        checked={table.selected.has(r.id)}
        onChange={() => table.toggle(r.id)}
      />
    ),
  });

  const numberCell = (r: NewsletterItem, text: string) => (
    <span className="admin-newsletter-number">{wentOut(r) ? text : "—"}</span>
  );

  const columns: Column<NewsletterItem>[] = [
    checkboxCol<NewsletterItem>(campaignTable, (r) => `Select ${r.subject}`),
    {
      key: "subject",
      header: campaignTable.header("subject", "Campaign"),
      width: "34%",
      render: (r) => (
        <div>
          <div className="admin-table__title">{r.subject}</div>
          <div className="admin-table__sub admin-newsletter-audience">
            <Icon name="user" size={11} />
            All subscribers
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: campaignTable.header("status", "Status"),
      width: "12%",
      render: (r) => (
        <span className={`admin-newsletter-badge admin-newsletter-badge--${r.status}`}>
          <Icon name={STATUS_BADGE[r.status].icon} size={11} />
          {STATUS_BADGE[r.status].label}
        </span>
      ),
    },
    {
      key: "recipients",
      header: campaignTable.header("recipients", "Recipients"),
      width: "10%",
      align: "right",
      render: (r) => numberCell(r, formatCount(r.sentCount)),
    },
    {
      key: "open",
      header: campaignTable.header("open", "Open rate"),
      width: "10%",
      align: "right",
      render: (r) => numberCell(r, formatRate(r.openRate)),
    },
    {
      key: "click",
      header: campaignTable.header("click", "Click rate"),
      width: "10%",
      align: "right",
      render: (r) => numberCell(r, formatRate(r.clickRate)),
    },
    {
      key: "sent",
      header: campaignTable.header("sent", "Sent"),
      width: "15%",
      render: (r) => {
        const when = r.status === "draft" ? r.modifiedAt : (r.sentAt ?? r.sendAt ?? r.modifiedAt);
        return (
          <span className="admin-event-meta">
            {r.status === "scheduled" ? (
              <span className="admin-table__title admin-newsletter-when--scheduled">
                Sends {formatSendTime(when)}
              </span>
            ) : (
              <span className="admin-table__title">{formatDate(when)}</span>
            )}
            {r.author ? <span className="admin-table__sub">{r.author.name}</span> : null}
          </span>
        );
      },
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "10%",
      render: (r) => (
        <div className="admin-table__actions">
          {wentOut(r) ? (
            <Button
              variant="ghost"
              size="icon"
              icon="chart"
              aria-label="Results"
              title="Results"
              onClick={() => setResultsFor(r)}
            />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              icon={canEdit ? "edit" : "eye"}
              aria-label={canEdit ? "Edit" : "Open (read only)"}
              title={canEdit ? "Edit" : "Open (read only)"}
              onClick={() => toForm("edit", r)}
            />
          )}
          <RowMenu>
            {canSend ? (
              <MenuItem
                icon="globeSimple"
                disabled={!changeable(r) || busy}
                onClick={() => setPublishFor([r])}
              >
                Publish
              </MenuItem>
            ) : null}
            <MenuItem icon="eye" onClick={() => setPreviewFor(r)}>
              Preview
            </MenuItem>
            {canSend ? (
              <MenuItem
                icon="clock"
                disabled={!changeable(r) || busy}
                onClick={() => {
                  setSendAt("");
                  setScheduleFor(r);
                }}
              >
                Schedule…
              </MenuItem>
            ) : null}
            <MenuItem
              icon="copy"
              disabled={!wentOut(r) || !publicBase}
              title={wentOut(r) ? undefined : "The public page exists once it is sent"}
              onClick={() => copyLink(r)}
            >
              Copy Link
            </MenuItem>
            {canEdit ? (
              <>
                <MenuDivider />
                <MenuItem
                  icon="trash"
                  danger
                  disabled={r.status === "sending"}
                  onClick={() => askDelete("campaign", [r.id])}
                >
                  Delete campaign
                </MenuItem>
              </>
            ) : null}
          </RowMenu>
        </div>
      ),
    },
  ];

  const subscriberColumns: Column<SubscriberItem>[] = [
    checkboxCol<SubscriberItem>(subTable, (r) => `Select ${r.name ?? r.email}`),
    {
      key: "name",
      header: subTable.header("name", "Subscriber"),
      width: "45%",
      render: (r) => (
        <div>
          <div className="admin-table__title admin-newsletter-subscriber">
            {r.name ?? r.email}
            {r.status !== "confirmed" ? (
              <span className={`admin-newsletter-badge admin-newsletter-badge--${r.status}`}>
                {r.status === "pending" ? "Pending" : "Unsubscribed"}
              </span>
            ) : null}
          </div>
          {r.name ? (
            <div className="admin-table__sub admin-newsletter-audience">
              <Icon name="user" size={11} />
              {r.email}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "ppi",
      header: subTable.header("ppi", "PPI Country"),
      width: "30%",
      render: (r) => <span className="admin-table__title">{r.ppi ?? "—"}</span>,
    },
    {
      key: "subscribed",
      header: subTable.header("subscribed", "Joined"),
      width: "22%",
      render: (r) => (
        <span className="admin-event-meta">
          <span className="admin-table__title">{formatDate(r.subscribed)}</span>
          <span className="admin-table__sub">{timeAgo(r.subscribed)}</span>
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "8%",
      render: (r) =>
        canEdit ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="trash"
              className="admin-newsletter-trash"
              aria-label={`Delete ${r.name ?? r.email}`}
              title="Delete subscriber"
              onClick={() => askDelete("subscriber", [r.id])}
            />
          </div>
        ) : null,
    },
  ];

  const deleteCount = deleteConfirm?.ids.length ?? 0;
  const deleteNoun = deleteConfirm?.kind === "subscriber" ? "Subscriber" : "Campaign";
  const deleteLabel =
    deleteCount === 1 ? `Delete ${deleteNoun}` : `Delete ${deleteCount} ${deleteNoun}s`;
  const publishCount = publishFor?.length ?? 0;
  const publishLabel =
    publishCount === 1 ? "Publish Campaign" : `Publish ${publishCount} Campaigns`;
  const footer = (back: () => void) => (
    <div className="admin-modal__footer-row">
      <Button variant="outline" icon="chevronLeft" onClick={back}>
        Back
      </Button>
    </div>
  );

  const popups = (
    <>
      <ConfirmDialog
        open={deleteConfirm !== null}
        title={`${deleteLabel}?`}
        confirmLabel={deleteLabel}
        icon="trash"
        pending={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleteConfirm(null)}
      >
        {deleteConfirm?.kind === "subscriber"
          ? "They stop getting campaigns now. You can revert deletion on the admin log before 14 days."
          : DELETE_HINT}
      </ConfirmDialog>

      <ConfirmDialog
        open={publishFor !== null}
        title={`${publishLabel}?`}
        confirmLabel={publishLabel}
        tone="primary"
        icon="globeSimple"
        pending={busy}
        onConfirm={() => void doPublish()}
        onCancel={() => setPublishFor(null)}
      >
        {`E-mailed now to ${formatCount(stats.active)} active subscribers (about 100 per cron run). This cannot be undone.`}
        {publishFor && publishFor.some((c) => !changeable(c))
          ? " Campaigns that were already sent are skipped."
          : ""}
      </ConfirmDialog>

      <Modal
        asForm
        open={scheduleFor !== null}
        title="Schedule campaign"
        subtitle={`“${scheduleFor?.subject ?? ""}” goes to every active subscriber at this time.`}
        onClose={() => setScheduleFor(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setScheduleFor(null)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="clock"
              disabled={busy || !sendAt}
              onClick={() => doSchedule()}
            >
              Schedule
            </Button>
          </div>
        }
      >
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="campaign-send-at">
            Send at (your time zone)
          </label>
          <input
            id="campaign-send-at"
            required
            className="admin-input"
            type="datetime-local"
            value={sendAt}
            onChange={(e) => setSendAt(e.target.value)}
          />
          <FieldError id="campaign-send-at-error" />
        </div>
      </Modal>

      <Modal
        open={resultsFor !== null}
        title={resultsFor?.subject ?? "Results"}
        subtitle="Opens are approximate: some mail apps load images for every message, others block them. A click also counts as an open."
        width={460}
        hideClose
        onClose={() => setResultsFor(null)}
        footer={footer(() => setResultsFor(null))}
      >
        {resultsFor ? (
          <dl className="admin-newsletter-results">
            <dt>Recipients</dt>
            <dd>{formatCount(resultsFor.sentCount)}</dd>
            <dt>Opened</dt>
            <dd>
              {formatCount(resultsFor.openCount)} · {formatRate(resultsFor.openRate)}
            </dd>
            <dt>Clicked</dt>
            <dd>
              {formatCount(resultsFor.clickCount)} · {formatRate(resultsFor.clickRate)}
            </dd>
            <dt>{resultsFor.status === "sending" ? "Started" : "Sent"}</dt>
            <dd>{formatDate(resultsFor.sentAt ?? resultsFor.sendAt ?? resultsFor.modifiedAt)}</dd>
          </dl>
        ) : null}
      </Modal>

      <Modal
        open={previewFor !== null}
        title={previewFor?.subject || "Preview"}
        width={680}
        hideClose
        onClose={() => setPreviewFor(null)}
        footer={footer(() => setPreviewFor(null))}
      >
        <EmailPreview html={previewFor?.body ?? ""} />
      </Modal>

      <Modal
        asForm
        open={addOpen}
        title="Add New Subscriber"
        subtitle="They get a confirmation e-mail and receive campaigns only after they confirm."
        onClose={() => setAddOpen(false)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setAddOpen(false)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="plus"
              disabled={busy || !newSubscriber.email.trim()}
              onClick={() => addSubscriber()}
            >
              Add Subscriber
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="subscriber-email">
              E-mail *
            </label>
            <input
              id="subscriber-email"
              className="admin-input"
              type="email"
              required
              autoComplete="off"
              placeholder="name@example.com"
              value={newSubscriber.email}
              onChange={(e) => setNewSubscriber({ ...newSubscriber, email: e.target.value })}
            />
            <FieldError id="subscriber-email-error" />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="subscriber-name">
              Name
            </label>
            <input
              id="subscriber-name"
              className="admin-input"
              type="text"
              maxLength={120}
              value={newSubscriber.name}
              onChange={(e) => setNewSubscriber({ ...newSubscriber, name: e.target.value })}
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="subscriber-ppi">
              PPI Country
            </label>
            <Select
              id="subscriber-ppi"
              className="admin-select"
              value={newSubscriber.chapterId}
              onChange={(e) => setNewSubscriber({ ...newSubscriber, chapterId: e.target.value })}
            >
              <option value="">—</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Modal>
    </>
  );

  const formReadonly = !canEdit;

  if (view === "form") {
    return (
      <div className="admin-newsletter">
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {formMode === "create"
                ? "Newsletter > Campaigns > Create"
                : "Newsletter > Campaigns > Edit"}
            </h1>
            <p className="admin-page-header__desc">
              {formMode === "create"
                ? "Write the campaign, then save it as a draft or publish it."
                : "Update campaign information."}
            </p>
          </div>
        </div>

        <form
          className="admin-dark-form admin-newsletter-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="admin-form-grid">
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="campaign-subject">
                Subject *
              </label>
              <input
                id="campaign-subject"
                required
                className="admin-input"
                type="text"
                placeholder="Campaign subject"
                maxLength={200}
                value={form.subject}
                readOnly={formReadonly}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
              <FieldError id="campaign-subject-error" />
            </div>

            <div className="admin-field admin-form-grid__full">
              <span className="admin-field__label">Content Blocks *</span>
              <div className="admin-article-frame">
                <RichTextStack
                  blocks={form.bodies}
                  onChange={(bodies) => setForm((f) => ({ ...f, bodies }))}
                  uploadImage={uploadImage}
                  label="Campaign content"
                  readOnly={formReadonly}
                />
              </div>
              <UploadBar upload={upload} />
            </div>
          </div>

          <div className="admin-form-actions">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button
                variant="outline"
                size="sm"
                icon="eye"
                onClick={() => setPreviewFor({ subject: form.subject, body: formBody() })}
              >
                Preview
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon="send"
                onClick={() => sendTest()}
                disabled={formReadonly || busy || upload.busy}
              >
                Send Test
              </Button>
              <Button
                type="submit"
                formNoValidate
                variant="outline"
                size="sm"
                icon="cloud"
                onClick={() => saveAndClose()}
                disabled={formReadonly || busy || upload.busy}
              >
                Save draft
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                icon="globeSimple"
                onClick={() => publishCampaign()}
                disabled={formReadonly || !canSend || busy || upload.busy}
              >
                Publish
              </Button>
            </div>
          </div>
        </form>

        {popups}
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  const kpi = (icon: IconName, label: string, value: string, trend: ReactNode) => (
    <div className="admin-newsletter-kpi">
      <span className="admin-newsletter-kpi__label">
        <Icon name={icon} size={14} />
        {label}
      </span>
      <span className="admin-newsletter-kpi__row">
        <span className="admin-newsletter-kpi__value">{value}</span>
        {trend}
      </span>
    </div>
  );
  const trend = (delta: number | null) =>
    delta === null ? null : (
      <span
        className={`admin-newsletter-kpi__trend admin-newsletter-kpi__trend--${delta >= 0 ? "up" : "down"}`}
      >
        {formatPoints(delta)}
      </span>
    );

  const searchBox = (placeholder: string, label: string) => (
    <SearchBox
      key={`${tab}-${searchKey}`}
      placeholder={placeholder}
      label={label}
      onSearch={(text) => {
        setQuery(text);
        resetPaging();
      }}
    />
  );

  return (
    <div className="admin-newsletter">
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">
            {isCampaign ? "Newsletter > Campaigns" : "Newsletter > Subscribers"}
          </h1>
          <p className="admin-page-header__desc">
            {isCampaign
              ? "Write campaigns and send them to the newsletter subscribers."
              : "Everyone on the newsletter list, with their confirmation status."}
          </p>
        </div>
        <div className="admin-page-header__actions">
          {isCampaign ? (
            <>
              <div className="admin-fab">
                {canEdit ? (
                  <Button variant="outline" size="sm" icon="plus" onClick={() => toForm("create")}>
                    Add New Campaign
                  </Button>
                ) : null}
              </div>
              <SortMenu columns={columns} />
              {searchBox("Search by title...", "Search campaigns")}
            </>
          ) : (
            <>
              <div className="admin-fab">
                {canExport ? (
                  <Button variant="outline" size="sm" icon="download" onClick={() => exportCsv()}>
                    Export CSV
                  </Button>
                ) : null}
              </div>
              {canEdit ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    icon="upload"
                    disabled={busy}
                    title="CSV with the columns email, name and ppi (at most 200 rows)"
                    onClick={() => importInputRef.current?.click()}
                  >
                    Import CSV
                  </Button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void importCsv(file);
                    }}
                  />
                  <Button variant="outline" size="sm" icon="plus" onClick={() => setAddOpen(true)}>
                    Add New Subscriber
                  </Button>
                </>
              ) : null}
              <SortMenu columns={subscriberColumns} />
              {searchBox("Search by name or e-mail...", "Search subscribers")}
            </>
          )}
        </div>
      </div>

      <Tabs
        label="Newsletter lists"
        tabs={[
          { key: "campaign", label: "Campaigns", count: campaigns.length },
          { key: "subscriber", label: "Subscribers", count: subscribers.length },
        ]}
        active={tab}
        onSelect={switchTab}
      />

      <div className="admin-newsletter-kpis">
        {kpi(
          "user",
          "Active subscribers",
          formatCount(stats.active),
          <span className="admin-newsletter-kpi__trend admin-newsletter-kpi__trend--up">
            +{formatCount(stats.thisMonth)} this month
          </span>,
        )}
        {kpi("eye", "Avg. open rate · last 5", formatRate(stats.open), trend(stats.openDelta))}
        {kpi("chart", "Avg. click rate · last 5", formatRate(stats.click), trend(stats.clickDelta))}
      </div>

      {isCampaign ? (
        <ListCard
          table={campaignTable}
          noun="campaign"
          columns={columns}
          empty={
            <ListEmpty
              noun="campaign"
              query={query}
              filters={campaignTable.filterCount}
              emptyHint="Write the first campaign."
              onClear={clearFilters}
              addLabel="Add New Campaign"
              onAdd={canEdit ? () => toForm("create") : null}
            />
          }
          bulkActions={
            canSend || canEdit ? (
              <>
                {canSend ? (
                  <Button
                    variant="primary"
                    size="sm"
                    icon="globeSimple"
                    disabled={busy}
                    onClick={() => setPublishFor(campaigns.filter((c) => selected.has(c.id)))}
                  >
                    Publish
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button
                    variant="danger"
                    size="sm"
                    icon="trash"
                    disabled={busy}
                    onClick={() => askDelete("campaign", [...selected])}
                  >
                    Delete
                  </Button>
                ) : null}
              </>
            ) : null
          }
        />
      ) : (
        <ListCard
          table={subTable}
          noun="subscriber"
          columns={subscriberColumns}
          empty={
            <ListEmpty
              noun="subscriber"
              query={query}
              filters={subTable.filterCount}
              emptyHint="People join through the newsletter field on the website."
              onClear={clearFilters}
              addLabel="Add New Subscriber"
              onAdd={canEdit ? () => setAddOpen(true) : null}
            />
          }
          bulkActions={
            canEdit ? (
              <Button
                variant="danger"
                size="sm"
                icon="trash"
                disabled={busy}
                onClick={() => askDelete("subscriber", [...selected])}
              >
                Delete
              </Button>
            ) : null
          }
        />
      )}

      {popups}
      <ToastBanner message={toast.message} />
    </div>
  );
}
