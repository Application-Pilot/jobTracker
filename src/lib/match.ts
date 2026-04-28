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
