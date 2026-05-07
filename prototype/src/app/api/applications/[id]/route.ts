import { NextRequest, NextResponse } from "next/server";
import { deleteApplication, listApplications, updateApplication } from "@/lib/sheets";
import { Application, STATUSES, Status } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const patch = (await req.json()) as Partial<Application>;
    const apps = await listApplications();
    const existing = apps.find((a) => a.id === id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const status: Status =
      patch.status && STATUSES.includes(patch.status as Status)
        ? (patch.status as Status)
        : existing.status;
    const updated: Application = { ...existing, ...patch, id, status };
    await updateApplication(updated);
    return NextResponse.json({ application: updated });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    await deleteApplication(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
