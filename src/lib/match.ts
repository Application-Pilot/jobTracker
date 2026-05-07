import { Application } from "./types";

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export type Match = { app: Application; score: number; reasons: string[] };

export function findSimilarOpen(
  rejected: Application,
  all: Application[],
): Match[] {
  const candidates = all.filter(
    (a) =>
      a.id !== rejected.id &&
      (a.status === "pending" || a.status === "interview"),
  );
  const titleA = tokens(rejected.jobTitle);
  const locA = (rejected.location || "").toLowerCase().trim();
  const compA = (rejected.company || "").toLowerCase().trim();

  const matches: Match[] = candidates.map((a) => {
    const reasons: string[] = [];
    let score = 0;

    const titleSim = jaccard(titleA, tokens(a.jobTitle));
    if (titleSim > 0) {
      score += titleSim * 0.6;
      if (titleSim >= 0.4) reasons.push("similar title");
    }

    const compB = (a.company || "").toLowerCase().trim();
    if (compB && compA && compB === compA) {
      score += 0.25;
      reasons.push("same company");
    }

    const locB = (a.location || "").toLowerCase().trim();
    if (locA && locB && (locA === locB || locA.includes(locB) || locB.includes(locA))) {
      score += 0.15;
      reasons.push("same location");
    }

    return { app: a, score, reasons };
  });

  return matches
    .filter((m) => m.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function normalizeCompany(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function companiesMatch(a: string, b: string): boolean {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

export function pickRejectionTarget(
  incoming: { company: string; jobTitle?: string },
  existing: Application[],
): Application | null {
  const candidates = existing.filter((a) =>
    companiesMatch(a.company, incoming.company),
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const titleA = tokens(incoming.jobTitle || "");
  if (titleA.size > 0) {
    const scored = candidates
      .map((a) => ({ a, s: jaccard(titleA, tokens(a.jobTitle)) }))
      .sort((x, y) => y.s - x.s);
    if (scored[0].s >= 0.4 && (scored.length === 1 || scored[0].s > scored[1].s)) {
      return scored[0].a;
    }
  }

  return [...candidates].sort((a, b) => {
    const da = a.appliedDate || a.emailDate || "";
    const db = b.appliedDate || b.emailDate || "";
    if (da !== db) return db.localeCompare(da);
    return (b.id || "").localeCompare(a.id || "");
  })[0];
}
