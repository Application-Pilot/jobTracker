import { NextRequest, NextResponse } from "next/server";
import {
  appendApplication,
  ensureHeaderRow,
  listApplications,
  newId,
  updateApplication,
} from "@/lib/sheets";
import { Application, STATUSES, Status, localDateString } from "@/lib/types";
import { pickRejectionTarget } from "@/lib/match";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const required = process.env.SYNC_SHARED_SECRET;
  if (!required) return true;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${required}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { applications: Partial<Application>[] };
    if (!body?.applications?.length) {
      return NextResponse.json({ inserted: 0, updated: 0, skipped: 0 });
    }
    await ensureHeaderRow();
    const existing = await listApplications();
    const byThreadId = new Map<string, Application>();
    const bySubjectDate = new Map<string, Application>();
    for (const a of existing) {
      if (a.gmailThreadId) byThreadId.set(a.gmailThreadId, a);
      if (a.emailSubject) {
        bySubjectDate.set(`${a.emailSubject}|${a.emailDate}`.toLowerCase(), a);
      }
    }
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const incoming of body.applications) {
      const status: Status = STATUSES.includes(incoming.status as Status)
        ? (incoming.status as Status)
        : "pending";

      if (status === "rejected") {
        if (!incoming.company) {
          skipped++;
          continue;
        }
        const target = pickRejectionTarget(
          { company: incoming.company, jobTitle: incoming.jobTitle },
          existing,
        );
        if (!target) {
          skipped++;
          continue;
        }
        const merged: Application = {
          ...target,
          ...incoming,
          id: target.id,
          status: "rejected",
          jobTitle: target.jobTitle,
          company: target.company,
          appliedDate: target.appliedDate,
          gmailThreadId: target.gmailThreadId,
          emailSubject: target.emailSubject,
          emailDate: target.emailDate,
        } as Application;
        await updateApplication(merged);
        updated++;
        continue;
      }

      if (!incoming.jobTitle || !incoming.company) {
        skipped++;
        continue;
      }
      let match: Application | undefined;
      if (incoming.gmailThreadId) {
        match = byThreadId.get(incoming.gmailThreadId);
      }
      if (!match && incoming.emailSubject) {
        const key = `${incoming.emailSubject}|${incoming.emailDate || ""}`.toLowerCase();
        match = bySubjectDate.get(key);
      }
      if (match) {
        const merged: Application = {
          ...match,
          ...incoming,
          id: match.id,
          status,
        } as Application;
        await updateApplication(merged);
        updated++;
      } else {
        const today = localDateString();
        const app: Application = {
          id: newId(),
          jobTitle: incoming.jobTitle,
          company: incoming.company,
          appliedDate: incoming.appliedDate || today,
          status,
          interviewDate: incoming.interviewDate || "",
          rejectionReason: incoming.rejectionReason || "",
          jobLink: incoming.jobLink || "",
          emailSubject: incoming.emailSubject || "",
          emailDate: incoming.emailDate || "",
          salaryRange: incoming.salaryRange || "",
          location: incoming.location || "",
          notes: incoming.notes || "",
          easyApply: incoming.easyApply || "",
          gmailThreadId: incoming.gmailThreadId || "",
        };
        await appendApplication(app);
        inserted++;
      }
    }
    return NextResponse.json({ inserted, updated, skipped });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
