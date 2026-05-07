"use client";

import { useEffect, useMemo, useState } from "react";
import { Application, STATUSES, Status, localDateString } from "@/lib/types";
import { findSimilarOpen } from "@/lib/match";

type SortKey = "newest" | "oldest" | "company" | "status";

const STATUS_STYLES: Record<Status, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-600/20",
  interview: "bg-blue-100 text-blue-800 ring-blue-600/20",
  accepted: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  rejected: "bg-rose-100 text-rose-800 ring-rose-600/20",
};

function emptyDraft(): Partial<Application> {
  return {
    jobTitle: "",
    company: "",
    appliedDate: localDateString(),
    status: "pending",
    interviewDate: "",
    rejectionReason: "",
    jobLink: "",
    salaryRange: "",
    location: "",
    notes: "",
    easyApply: "",
    gmailThreadId: "",
  };
}

export default function Dashboard() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [editing, setEditing] = useState<Partial<Application> | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      const res = await fetch("/api/applications", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setApps(data.applications || []);
      setLastSync(new Date());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length };
    for (const s of STATUSES) c[s] = 0;
    for (const a of apps) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }, [apps]);

  const visible = useMemo(() => {
    let list = apps;
    if (filter !== "all") list = list.filter((a) => a.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.company.toLowerCase().includes(q) ||
          a.jobTitle.toLowerCase().includes(q) ||
          a.location.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "newest":
          return (b.appliedDate || "").localeCompare(a.appliedDate || "");
        case "oldest":
          return (a.appliedDate || "").localeCompare(b.appliedDate || "");
        case "company":
          return a.company.localeCompare(b.company);
        case "status":
          return a.status.localeCompare(b.status);
      }
    });
    return sorted;
  }, [apps, filter, search, sortKey]);

  async function save(draft: Partial<Application>) {
    setSaving(true);
    try {
      const isNew = !draft.id;
      const res = await fetch(
        isNew ? "/api/applications" : `/api/applications/${draft.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setEditing(null);
      await refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(app: Application, status: Status) {
    await fetch(`/api/applications/${app.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this application?")) return;
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    await refresh();
  }

  function exportCsv() {
    const headers = [
      "id",
      "jobTitle",
      "company",
      "appliedDate",
      "status",
      "interviewDate",
      "rejectionReason",
      "jobLink",
      "emailSubject",
      "emailDate",
      "salaryRange",
      "location",
      "notes",
      "easyApply",
      "gmailThreadId",
    ] as const;
    const rows = [headers.join(",")];
    for (const a of apps) {
      rows.push(
        headers
          .map((h) => `"${(a[h] || "").toString().replace(/"/g, '""')}"`)
          .join(","),
      );
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `jobtracker-${localDateString()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-full w-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Job Application Tracker
            </h1>
            <p className="text-xs text-zinc-500">
              {lastSync
                ? `Synced ${lastSync.toLocaleTimeString()}`
                : "Loading…"}
              {error ? ` · ${error}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refresh}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Refresh
            </button>
            <button
              onClick={exportCsv}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              Export CSV
            </button>
            <button
              onClick={() => setEditing(emptyDraft())}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              + Add
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Total" value={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
          {STATUSES.map((s) => (
            <StatCard
              key={s}
              label={s[0].toUpperCase() + s.slice(1)}
              value={counts[s] || 0}
              active={filter === s}
              onClick={() => setFilter(s)}
              accent={STATUS_STYLES[s]}
            />
          ))}
        </section>

        <DailyChart apps={apps} />

        <section className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company, title, location…"
            className="flex-1 min-w-[200px] rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="company">By company</option>
            <option value="status">By status</option>
          </select>
        </section>

        {loading ? (
          <p className="text-sm text-zinc-500">Loading applications…</p>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No applications yet. Click <span className="font-medium">+ Add</span> to create one,
            or wire up the Apps Script to sync from Gmail.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {visible.map((app) => (
              <Card
                key={app.id}
                app={app}
                allApps={apps}
                onEdit={() => setEditing(app)}
                onDelete={() => remove(app.id)}
                onQuickStatus={(s) => quickStatus(app, s)}
              />
            ))}
          </div>
        )}
      </main>

      {editing && (
        <EditModal
          draft={editing}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  active,
  onClick,
  accent,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition ${
        active
          ? "border-zinc-900 bg-white shadow-sm dark:border-white dark:bg-zinc-900"
          : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {accent && <span className={`h-2 w-2 rounded-full ${accent.split(" ")[0]}`} />}
      </div>
    </button>
  );
}

type DayBucket = {
  date: string;
  label: string;
  easy: number;
  regular: number;
};

function DailyChart({ apps }: { apps: Application[] }) {
  const series = useMemo<DayBucket[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let minDate: Date | null = null;
    let maxDate = today;
    for (const a of apps) {
      const key = (a.appliedDate || a.emailDate || "").slice(0, 10);
      if (!key) continue;
      const d = new Date(key + "T00:00:00");
      if (isNaN(d.getTime())) continue;
      if (!minDate || d < minDate) minDate = d;
      if (d > maxDate) maxDate = d;
    }
    if (!minDate) return [];
    const start = minDate;

    const days: DayBucket[] = [];
    for (let d = new Date(start); d <= maxDate; d.setDate(d.getDate() + 1)) {
      days.push({
        date: localDateString(d),
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        easy: 0,
        regular: 0,
      });
    }
    const byDate = new Map(days.map((d) => [d.date, d]));
    for (const a of apps) {
      const key = (a.appliedDate || a.emailDate || "").slice(0, 10);
      const bucket = byDate.get(key);
      if (!bucket) continue;
      if (a.easyApply === "true") bucket.easy++;
      else bucket.regular++;
    }
    return days;
  }, [apps]);

  if (series.length === 0) return null;

  const max = Math.max(1, ...series.map((d) => d.easy + d.regular));
  const totalEasy = series.reduce((s, d) => s + d.easy, 0);
  const totalRegular = series.reduce((s, d) => s + d.regular, 0);
  const total = totalEasy + totalRegular;
  const width = 800;
  const height = 160;
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const barW = innerW / series.length;
  const showLabelEvery = Math.max(1, Math.ceil(series.length / 14));

  return (
    <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Applications per day
        </h2>
        <span className="text-xs text-zinc-500">
          {total} total · since {series[0]?.date ?? "—"}
        </span>
      </div>
      <div className="mb-2 flex items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-indigo-500 dark:bg-indigo-400" />
          Manual / direct ({totalRegular})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500 dark:bg-amber-400" />
          LinkedIn Easy Apply ({totalEasy})
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        <line
          x1={padL}
          y1={padT + innerH}
          x2={padL + innerW}
          y2={padT + innerH}
          className="stroke-zinc-300 dark:stroke-zinc-700"
          strokeWidth={1}
        />
        <text
          x={padL - 6}
          y={padT + 4}
          textAnchor="end"
          className="fill-zinc-500 text-[10px]"
        >
          {max}
        </text>
        <text
          x={padL - 6}
          y={padT + innerH}
          textAnchor="end"
          className="fill-zinc-500 text-[10px]"
        >
          0
        </text>
        {series.map((d, i) => {
          const dayTotal = d.easy + d.regular;
          const x = padL + i * barW;
          const w = Math.max(1, barW - 2);
          const regularH = (d.regular / max) * innerH;
          const easyH = (d.easy / max) * innerH;
          const regularY = padT + innerH - regularH;
          const easyY = regularY - easyH;
          const totalTopY = padT + innerH - regularH - easyH;
          return (
            <g key={d.date}>
              {d.regular > 0 && (
                <rect
                  x={x + 1}
                  y={regularY}
                  width={w}
                  height={regularH}
                  className="fill-indigo-500 dark:fill-indigo-400"
                >
                  <title>{`${d.date} · Manual: ${d.regular}`}</title>
                </rect>
              )}
              {d.easy > 0 && (
                <rect
                  x={x + 1}
                  y={easyY}
                  width={w}
                  height={easyH}
                  className="fill-amber-500 dark:fill-amber-400"
                >
                  <title>{`${d.date} · Easy Apply: ${d.easy}`}</title>
                </rect>
              )}
              {dayTotal > 0 && (
                <text
                  x={x + barW / 2}
                  y={totalTopY - 2}
                  textAnchor="middle"
                  className="fill-zinc-600 text-[9px] dark:fill-zinc-400"
                >
                  {dayTotal}
                </text>
              )}
              {i % showLabelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={padT + innerH + 14}
                  textAnchor="middle"
                  className="fill-zinc-500 text-[10px]"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function Card({
  app,
  allApps,
  onEdit,
  onDelete,
  onQuickStatus,
}: {
  app: Application;
  allApps: Application[];
  onEdit: () => void;
  onDelete: () => void;
  onQuickStatus: (s: Status) => void;
}) {
  const matches = useMemo(
    () => (app.status === "rejected" ? findSimilarOpen(app, allApps) : []),
    [app, allApps],
  );

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 truncate text-base font-semibold">
            <span className="truncate">{app.jobTitle}</span>
            {app.easyApply === "true" && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900">
                Easy Apply
              </span>
            )}
          </h3>
          <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
            {app.company}
            {app.location ? ` · ${app.location}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            STATUS_STYLES[app.status]
          }`}
        >
          {app.status}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {app.appliedDate && (
          <div>
            <dt className="inline text-zinc-500">Applied:</dt>{" "}
            <dd className="inline">{app.appliedDate}</dd>
          </div>
        )}
        {app.interviewDate && (
          <div>
            <dt className="inline text-zinc-500">Interview:</dt>{" "}
            <dd className="inline">{app.interviewDate}</dd>
          </div>
        )}
        {app.salaryRange && (
          <div>
            <dt className="inline text-zinc-500">Salary:</dt>{" "}
            <dd className="inline">{app.salaryRange}</dd>
          </div>
        )}
      </dl>

      {app.rejectionReason && (
        <p className="mt-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {app.rejectionReason}
        </p>
      )}

      {app.notes && (
        <p className="mt-2 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
          {app.notes}
        </p>
      )}

      {matches.length > 0 && (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
            Similar still open:
          </p>
          <ul className="space-y-1">
            {matches.map((m) => (
              <li key={m.app.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {m.app.jobTitle} · {m.app.company}
                </span>
                <span className="shrink-0 text-zinc-400">
                  {m.reasons.join(", ") || `${Math.round(m.score * 100)}%`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <div className="flex flex-wrap gap-1">
          {STATUSES.filter((s) => s !== app.status).map((s) => (
            <button
              key={s}
              onClick={() => onQuickStatus(s)}
              className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              → {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 text-xs">
          {app.jobLink && (
            <a
              href={app.jobLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Posting
            </a>
          )}
          <button onClick={onEdit} className="text-zinc-700 hover:underline dark:text-zinc-300">
            Edit
          </button>
          <button onClick={onDelete} className="text-rose-600 hover:underline">
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function EditModal({
  draft,
  saving,
  onClose,
  onSave,
}: {
  draft: Partial<Application>;
  saving: boolean;
  onClose: () => void;
  onSave: (d: Partial<Application>) => void;
}) {
  const [form, setForm] = useState<Partial<Application>>(draft);
  const isNew = !draft.id;

  function set<K extends keyof Application>(k: K, v: Application[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isNew ? "Add application" : "Edit application"}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            ✕
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Job title *">
            <input
              value={form.jobTitle || ""}
              onChange={(e) => set("jobTitle", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Company *">
            <input
              value={form.company || ""}
              onChange={(e) => set("company", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Status">
            <select
              value={form.status || "pending"}
              onChange={(e) => set("status", e.target.value as Status)}
              className={inputCls}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Applied date">
            <input
              type="date"
              value={form.appliedDate || ""}
              onChange={(e) => set("appliedDate", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Interview date">
            <input
              type="date"
              value={form.interviewDate || ""}
              onChange={(e) => set("interviewDate", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Location">
            <input
              value={form.location || ""}
              onChange={(e) => set("location", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Salary range">
            <input
              value={form.salaryRange || ""}
              onChange={(e) => set("salaryRange", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Job link">
            <input
              value={form.jobLink || ""}
              onChange={(e) => set("jobLink", e.target.value)}
              className={inputCls}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Rejection reason">
              <input
                value={form.rejectionReason || ""}
                onChange={(e) => set("rejectionReason", e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea
                value={form.notes || ""}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
                className={inputCls}
              />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            disabled={saving || !form.jobTitle || !form.company}
            onClick={() => onSave(form)}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}
