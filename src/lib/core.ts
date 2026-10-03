export type EmployeeId = 'richard' | 'anastasia' | 'jean_claude' | 'kevin' | 'svetlana';
export type Split = { r: number; a: number; j: number };
export type Allocation = 'A' | 'B' | 'Company overhead';
export type Transaction = {
  reference: string; kind: 'sale' | 'expense'; employee_id: EmployeeId;
  source: 'website' | 'telegram'; origin_chat_id: number | null; submitted_at: string;
  customer: string | null; project: 'A' | 'B' | null; description: string; amount: number;
  category: string | null; proposed_r: number | null; proposed_a: number | null; proposed_j: number | null;
  approved_r: number | null; approved_a: number | null; approved_j: number | null;
  proposed_allocation: Allocation | null; final_allocation: Allocation | null;
  status: 'Pending approval' | 'Approved' | 'Awaiting allocation' | 'Allocated';
  decided_at: string | null; sheet_row: number; sync_status: 'pending' | 'synced' | 'failed';
  sync_error: string | null; notification_chat_id: number | null;
  notification_status: 'not_required' | 'pending' | 'sent' | 'failed' | 'no_recipient';
  notification_error: string | null;
};

export const people: Record<EmployeeId, { name: string; role: 'sales' | 'expenses' | 'manager' }> = {
  richard: { name: 'Richard Darling', role: 'sales' },
  anastasia: { name: 'Anastasia Ferrari', role: 'sales' },
  jean_claude: { name: 'Jean-Claude Bērziņš', role: 'sales' },
  kevin: { name: 'Kevin von Whatever', role: 'expenses' },
  svetlana: { name: 'Svetlana de Monte Carlo', role: 'manager' },
};
export const salespeople: EmployeeId[] = ['richard', 'anastasia', 'jean_claude'];
export const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
export const cents = (amount: number | string) => Math.round(Number(amount) * 100);

export function commission(t: Transaction) {
  if (t.kind !== 'sale' || t.status !== 'Approved') return { pool: 0, r: 0, a: 0, j: 0 };
  const pool = Math.round(cents(t.amount) * 0.1);
  const percentages = { r: t.approved_r!, a: t.approved_a!, j: t.approved_j! };
  const values = {
    r: Math.round(pool * percentages.r / 100),
    a: Math.round(pool * percentages.a / 100),
    j: Math.round(pool * percentages.j / 100),
  };
  const winner = (['r', 'a', 'j'] as const).reduce((best, key) => percentages[key] > percentages[best] ? key : best, 'r');
  values[winner] += pool - values.r - values.a - values.j;
  return { pool, ...values };
}

export function totals(rows: Transaction[]) {
  const projects = {
    A: { income: 0, commissions: 0, expenses: 0, result: 0 },
    B: { income: 0, commissions: 0, expenses: 0, result: 0 },
  };
  const earned = { richard: 0, anastasia: 0, jean_claude: 0 };
  let overhead = 0, awaiting = 0, allExpenses = 0;
  for (const t of rows) {
    if (t.kind === 'sale' && t.status === 'Approved' && t.project) {
      const c = commission(t);
      projects[t.project].income += cents(t.amount);
      projects[t.project].commissions += c.pool;
      earned.richard += c.r; earned.anastasia += c.a; earned.jean_claude += c.j;
    }
    if (t.kind === 'expense') {
      const value = cents(t.amount);
      allExpenses += value;
      if (t.final_allocation === 'A' || t.final_allocation === 'B') projects[t.final_allocation].expenses += value;
      else if (t.final_allocation === 'Company overhead') overhead += value;
      else awaiting += value;
    }
  }
  for (const p of ['A', 'B'] as const) {
    projects[p].result = projects[p].income - projects[p].commissions - projects[p].expenses;
  }
  return {
    projects, overhead, awaiting, earned,
    income: projects.A.income + projects.B.income,
    commissions: projects.A.commissions + projects.B.commissions,
    allExpenses,
    result: projects.A.result + projects.B.result - overhead - awaiting,
  };
}

export function notificationText(t: Transaction) {
  if (t.kind === 'sale') {
    const c = commission(t);
    const changed = t.proposed_r !== t.approved_r || t.proposed_a !== t.approved_a || t.proposed_j !== t.approved_j;
    const share = (name: string, old: number | null, next: number | null, amount: number) =>
      `${name}: ${old}%${changed ? ` → ${next}%` : ''} (${money(amount)})`;
    return `Sale ${t.reference} approved — commission split ${changed ? 'changed' : 'unchanged'}. Sale ${money(cents(t.amount))}; total commission ${money(c.pool)}.\n` +
      [share('Richard', t.proposed_r, t.approved_r, c.r), share('Anastasia', t.proposed_a, t.approved_a, c.a), share('Jean-Claude', t.proposed_j, t.approved_j, c.j)].join('\n');
  }
  const changed = t.proposed_allocation !== t.final_allocation;
  return `Expense ${t.reference} — allocation ${changed ? 'changed' : 'confirmed'}. ${money(cents(t.amount))}: ${t.description}. ` +
    `Proposed: ${allocationName(t.proposed_allocation)}. Approved: ${allocationName(t.final_allocation)}.`;
}

export function allocationName(value: Allocation | null) {
  return value === 'A' ? 'Respectable Relatives' : value === 'B' ? 'Drunk University Friends' : value || 'Awaiting allocation';
}
