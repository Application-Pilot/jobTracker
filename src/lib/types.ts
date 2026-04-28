export const STATUSES = ["pending", "interview", "accepted", "rejected"] as const;
export type Status = (typeof STATUSES)[number];

export type Application = {
  id: string;
  jobTitle: string;
  company: string;
  appliedDate: string;
  status: Status;
  interviewDate: string;
  rejectionReason: string;
  jobLink: string;
  emailSubject: string;
  emailDate: string;
  salaryRange: string;
  location: string;
  notes: string;
};

export const SHEET_HEADERS: (keyof Application)[] = [
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
];

export const SHEET_RANGE = "Applications!A:M";
export const SHEET_NAME = "Applications";

export function rowToApplication(row: string[]): Application {
  const get = (i: number) => (row[i] ?? "").toString();
  return {
    id: get(0),
    jobTitle: get(1),
    company: get(2),
    appliedDate: get(3),
    status: (STATUSES.includes(get(4) as Status) ? get(4) : "pending") as Status,
    interviewDate: get(5),
    rejectionReason: get(6),
    jobLink: get(7),
    emailSubject: get(8),
    emailDate: get(9),
    salaryRange: get(10),
    location: get(11),
    notes: get(12),
  };
}

export function applicationToRow(a: Application): string[] {
  return SHEET_HEADERS.map((k) => a[k] ?? "");
}
