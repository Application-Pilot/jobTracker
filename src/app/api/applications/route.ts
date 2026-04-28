import { NextRequest, NextResponse } from "next/server";
import {
  appendApplication,
  ensureHeaderRow,
  listApplications,
  newId,
} from "@/lib/sheets";
import { Application, STATUSES, Status } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureHeaderRow();
    const apps = await listApplications();
    return NextResponse.json({ applications: apps });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<Application>;
    if (!body.jobTitle || !body.company) {
      return NextResponse.json(
        { error: "jobTitle and company are required" },
        { status: 400 },
      );
    }
    const status: Status = STATUSES.includes(body.status as Status)
      ? (body.status as Status)
      : "pending";
    const today = new Date().toISOString().slice(0, 10);
    const app: Application = {
      id: body.id || newId(),
      jobTitle: body.jobTitle,
      company: body.company,
      appliedDate: body.appliedDate || today,
      status,
      interviewDate: body.interviewDate || "",
      rejectionReason: body.rejectionReason || "",
      jobLink: body.jobLink || "",
      emailSubject: body.emailSubject || "",
      emailDate: body.emailDate || "",
      salaryRange: body.salaryRange || "",
      location: body.location || "",
      notes: body.notes || "",
    };
    await ensureHeaderRow();
    await appendApplication(app);
    return NextResponse.json({ application: app });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
