// Slovenski nazivi stanj testa (stroj stanj je v backend/src/testStatus.ts).
export const STATUS_LABELS: Record<string, string> = {
  draft: 'Osnutek',
  submitted: 'Oddan mentorju',
  in_review: 'V pregledu',
  changes_requested: 'Zahtevane spremembe',
  approved: 'Odobren',
  withdrawn: 'Umaknjen',
};

export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;
