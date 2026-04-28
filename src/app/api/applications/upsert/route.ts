import { NextRequest, NextResponse } from "next/server";
import {
  appendApplication,
  ensureHeaderRow,
  listApplications,
  newId,
  updateApplication,
} from "@/lib/sheets";
import { Application, STATUSES, Status } from "@/lib/types";

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
    const byKey = new Map<string, Application>();
    for (const a of existing) {
      const key = `${a.emailSubject}|${a.emailDate}`.toLowerCase();
      if (a.emailSubject) byKey.set(key, a);
    }
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const incoming of body.applications) {
      if (!incoming.jobTitle || !incoming.company) {
        skipped++;
        continue;
      }
      const status: Status = STATUSES.includes(incoming.status as Status)
        ? (incoming.status as Status)
        : "pending";
      const key = `${incoming.emailSubject || ""}|${incoming.emailDate || ""}`.toLowerCase();
      const match = incoming.emailSubject ? byKey.get(key) : undefined;
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
        const today = new Date().toISOString().slice(0, 10);
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
