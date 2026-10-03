'use client';

import { useCallback, useEffect, useState } from 'react';
import { allocationName, cents, commission, EmployeeId, money, people, totals, Transaction } from '@/lib/core';

type Contact = { telegram_user_id: number; chat_id: number };
type Link = Contact & { employee_id: EmployeeId };
type State = {
  rows: Transaction[]; totals: ReturnType<typeof totals> | null; contacts: Contact[]; links: Link[];
  config: { name: string; bot: string | null; sheet: string | null; github: string | null };
};

const emptySale = { kind: 'sale', reference: '', customer: '', project: 'A', description: '', amount: '', proposed_r: '50', proposed_a: '30', proposed_j: '20' };
const emptyExpense = { kind: 'expense', reference: '', description: '', category: 'Materials', amount: '', proposed_allocation: 'A' };
const roleIds = Object.keys(people) as EmployeeId[];

function RowCard({ row, manager, onAction, busy }: {
  row: Transaction; manager: boolean; onAction: (data: Record<string, unknown>) => Promise<void>; busy: boolean;
}) {
  const [r, setR] = useState(String(row.proposed_r ?? 0));
  const [a, setA] = useState(String(row.proposed_a ?? 0));
  const [j, setJ] = useState(String(row.proposed_j ?? 0));
  const [allocation, setAllocation] = useState(row.proposed_allocation || 'A');
  const pending = row.status === 'Pending approval' || row.status === 'Awaiting allocation';
  const c = commission(row);
  return <article className="record">
    <div className="record-head"><div><span className="ref">{row.reference}</span><span className={`pill ${pending ? 'amber' : 'green'}`}>{row.status}</span></div><strong>{money(cents(row.amount))}</strong></div>
    <div className="record-title">{row.kind === 'sale' ? row.customer : row.description}</div>
    <p className="muted small">{people[row.employee_id].name} · {row.source === 'telegram' ? 'Telegram' : 'Website'} · {new Date(row.submitted_at).toLocaleString()}</p>
    {row.kind === 'sale' ? <>
      <p className="small">{allocationName(row.project)} · {row.description}</p>
      <p className="small">Proposed Richard / Anastasia / Jean-Claude: {row.proposed_r}% / {row.proposed_a}% / {row.proposed_j}%</p>
      {row.status === 'Approved' && <p className="small">Approved: {row.approved_r}% / {row.approved_a}% / {row.approved_j}% · Earned {money(c.r)} / {money(c.a)} / {money(c.j)}</p>}
    </> : <p className="small">{row.category} · Proposed: {allocationName(row.proposed_allocation)} · Final: {row.final_allocation ? allocationName(row.final_allocation) : 'Awaiting decision'}</p>}
    <div className="delivery"><span>Sheets: <b>{row.sync_status === 'synced' ? 'Synced' : row.sync_status === 'failed' ? 'Sync failed' : 'Sync pending'}</b></span>
      {row.decided_at && <span>Telegram: <b>{row.notification_status === 'no_recipient' ? 'No Telegram recipient linked' : row.notification_status === 'sent' ? 'Sent' : row.notification_status === 'failed' ? 'Failed' : 'Pending'}</b></span>}</div>
    {manager && pending && <div className="decision">
      {row.kind === 'sale' ? <div className="split"><label>Richard %<input inputMode="numeric" value={r} onChange={e => setR(e.target.value)} /></label><label>Anastasia %<input inputMode="numeric" value={a} onChange={e => setA(e.target.value)} /></label><label>Jean-Claude %<input inputMode="numeric" value={j} onChange={e => setJ(e.target.value)} /></label></div> :
        <label>Final allocation<select value={allocation} onChange={e => setAllocation(e.target.value as typeof allocation)}><option value="A">Respectable Relatives</option><option value="B">Drunk University Friends</option><option value="Company overhead">Company overhead</option></select></label>}
      <button className="btn dark" disabled={busy} onClick={() => onAction({ action: 'decide', reference: row.reference,
        split: row.kind === 'sale' ? { r: Number(r), a: Number(a), j: Number(j) } : null,
        allocation: row.kind === 'expense' ? allocation : null })}>Confirm decision</button>
    </div>}
    {manager && (row.sync_status !== 'synced' || row.notification_status === 'failed' || row.notification_status === 'pending') &&
      <button className="text-button" disabled={busy} onClick={() => onAction({ action: 'retry', reference: row.reference })}>Retry delivery</button>}
    {manager && (row.sync_error || row.notification_error) && <p className="error-detail">{row.sync_error || row.notification_error}</p>}
  </article>;
}

export default function Home() {
  const [role, setRole] = useState<EmployeeId>('svetlana');
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sale, setSale] = useState(emptySale);
  const [expense, setExpense] = useState(emptyExpense);
  const [linkId, setLinkId] = useState('');
  const [linkEmployee, setLinkEmployee] = useState<EmployeeId>('richard');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/state?role=${role}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setState(data);
    } catch (error) { setMessage(String(error)); }
  }, [role]);
  useEffect(() => { void load(); }, [load]);

  async function action(data: Record<string, unknown>) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, role }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Action failed');
      setMessage(data.action === 'create' ? `${result.row.reference} recorded. ${result.row.sync_status === 'synced' ? 'Google Sheets synced.' : 'Google Sheets sync pending; a manager can retry.'}` : 'Saved successfully.');
      if (data.action === 'create') { setSale(emptySale); setExpense(emptyExpense); }
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const manager = role === 'svetlana';
  const rows = state?.rows || [];
  const pending = rows.filter(r => r.status === 'Pending approval' || r.status === 'Awaiting allocation');
  const decided = rows.filter(r => !pending.includes(r));
  const t = state?.totals;
  return <main>
    <header className="topbar"><div className="brand"><span className="mark">FI</span><div><strong>Friends Included</strong><span>Finance operations</span></div></div><span className="top-note">A fictional wedding guest agency</span></header>
    <div className="wrap">
      <div className="hero"><div><p className="eyebrow">WEDDING GUESTS FOR HIRE · FINANCE SYSTEM</p><h1>Every friendship has a balance.</h1><p>Submit sales and expenses, approve decisions, and see the results update across the business.</p></div><div className="hero-side"><span>Prepared by</span><strong>{state?.config.name || 'Dans Stepanovs'}</strong><small>Day 4 homework</small></div></div>
      <div className="toolbar"><label>Demonstration role<select value={role} onChange={e => { setRole(e.target.value as EmployeeId); setMessage(''); }}>
        {roleIds.map(id => <option key={id} value={id}>{people[id].name}</option>)}</select></label><button className="btn light" onClick={() => void load()}>Refresh records</button></div>
      {message && <div className="notice" role="status">{message}</div>}
      {!state && <p>Loading records…</p>}
      {manager && t && <section className="dashboard"><div className="section-heading"><div><p className="eyebrow">LIVE FINANCIALS</p><h2>Results at a glance</h2></div><span className="muted">Approved sales and all recorded expenses</span></div>
        <div className="metric-grid"><div className="metric featured"><span>Company result</span><strong>{money(t.result)}</strong><small>Income {money(t.income)} · Commissions {money(t.commissions)} · Expenses {money(t.allExpenses)}</small></div>
          {(['A', 'B'] as const).map(p => <div className="metric" key={p}><span>Project {p} · {allocationName(p)}</span><strong>{money(t.projects[p].result)}</strong><small>Income {money(t.projects[p].income)} · Commission {money(t.projects[p].commissions)} · Expenses {money(t.projects[p].expenses)}</small></div>)}</div>
        <div className="summary-line"><span>Company overhead <b>{money(t.overhead)}</b></span><span>Awaiting allocation <b>{money(t.awaiting)}</b></span><span>Pending sales <b>{pending.filter(r => r.kind === 'sale').length}</b></span></div>
        <div className="earned"><strong>Commission earned</strong><span>Richard {money(t.earned.richard)}</span><span>Anastasia {money(t.earned.anastasia)}</span><span>Jean-Claude {money(t.earned.jean_claude)}</span></div>
      </section>}
      {!manager && <section className="panel"><div className="section-heading"><div><p className="eyebrow">NEW TRANSACTION</p><h2>{people[role].role === 'sales' ? 'Record a sale' : 'Record an expense'}</h2></div></div>
        {people[role].role === 'sales' ? <form onSubmit={e => { e.preventDefault(); void action({ action: 'create', data: { ...sale, proposed_r: Number(sale.proposed_r), proposed_a: Number(sale.proposed_a), proposed_j: Number(sale.proposed_j) } }); }}>
          <div className="form-grid"><label>Reference<input required placeholder="S01" value={sale.reference} onChange={e => setSale({ ...sale, reference: e.target.value })} /></label><label>Customer<input required value={sale.customer} onChange={e => setSale({ ...sale, customer: e.target.value })} /></label><label>Project<select value={sale.project} onChange={e => setSale({ ...sale, project: e.target.value })}><option value="A">Respectable Relatives</option><option value="B">Drunk University Friends</option></select></label><label>Amount €<input required type="number" min="0.01" step="0.01" value={sale.amount} onChange={e => setSale({ ...sale, amount: e.target.value })} /></label></div>
          <label>Description<textarea required value={sale.description} onChange={e => setSale({ ...sale, description: e.target.value })} /></label><p className="form-subtitle">Proposed share of the 10% commission pool</p>
          <div className="split"><label>Richard %<input required type="number" min="0" max="100" value={sale.proposed_r} onChange={e => setSale({ ...sale, proposed_r: e.target.value })} /></label><label>Anastasia %<input required type="number" min="0" max="100" value={sale.proposed_a} onChange={e => setSale({ ...sale, proposed_a: e.target.value })} /></label><label>Jean-Claude %<input required type="number" min="0" max="100" value={sale.proposed_j} onChange={e => setSale({ ...sale, proposed_j: e.target.value })} /></label></div><button className="btn dark" disabled={busy}>Submit sale</button>
        </form> : <form onSubmit={e => { e.preventDefault(); void action({ action: 'create', data: expense }); }}><div className="form-grid"><label>Reference<input required placeholder="E01" value={expense.reference} onChange={e => setExpense({ ...expense, reference: e.target.value })} /></label><label>Amount €<input required type="number" min="0.01" step="0.01" value={expense.amount} onChange={e => setExpense({ ...expense, amount: e.target.value })} /></label><label>Category<select value={expense.category} onChange={e => setExpense({ ...expense, category: e.target.value })}><option>Materials</option><option>Travel</option><option>Other</option></select></label><label>Proposed allocation<select value={expense.proposed_allocation} onChange={e => setExpense({ ...expense, proposed_allocation: e.target.value })}><option value="A">Respectable Relatives</option><option value="B">Drunk University Friends</option><option>Company overhead</option></select></label></div><label>Description<textarea required value={expense.description} onChange={e => setExpense({ ...expense, description: e.target.value })} /></label><button className="btn dark" disabled={busy}>Submit expense</button></form>}
      </section>}
      {manager && <section className="panel"><div className="section-heading"><div><p className="eyebrow">MANAGER DESK</p><h2>Decisions needed <span className="count">{pending.length}</span></h2></div></div><div className="records">{pending.length ? pending.map(row => <RowCard key={row.reference} row={row} manager onAction={action} busy={busy} />) : <p className="muted">Nothing awaits approval or allocation.</p>}</div></section>}
      <section className="panel"><div className="section-heading"><div><p className="eyebrow">TRANSACTION HISTORY</p><h2>{manager ? 'Completed records' : 'Your submissions'}</h2></div></div><div className="records">{(manager ? decided : rows).length ? (manager ? decided : rows).map(row => <RowCard key={row.reference} row={row} manager={manager} onAction={action} busy={busy} />) : <p className="muted">No transactions yet.</p>}</div></section>
      {manager && <section className="panel"><div className="section-heading"><div><p className="eyebrow">TELEGRAM SETUP</p><h2>Link a bot user</h2></div></div><p className="muted">The person first opens the bot and sends /start. Their Telegram ID then appears below. You can reassign the same account to another fictional employee for testing.</p>
        <div className="link-form"><label>Telegram user ID<input inputMode="numeric" value={linkId} onChange={e => setLinkId(e.target.value)} placeholder="Shown by /start" /></label><label>Fictional employee<select value={linkEmployee} onChange={e => setLinkEmployee(e.target.value as EmployeeId)}>{roleIds.map(id => <option key={id} value={id}>{people[id].name}</option>)}</select></label><button className="btn dark" disabled={busy || !linkId} onClick={() => void action({ action: 'link', telegram_user_id: linkId, employee_id: linkEmployee })}>Link account</button></div>
        <div className="contact-list">{state?.contacts.map(contact => <div key={contact.telegram_user_id}><b>{contact.telegram_user_id}</b><span>Chat {contact.chat_id}</span><span>{state.links.find(link => link.telegram_user_id === contact.telegram_user_id)?.employee_id ? people[state.links.find(link => link.telegram_user_id === contact.telegram_user_id)!.employee_id].name : 'Not linked'}</span><button className="text-button" onClick={() => setLinkId(String(contact.telegram_user_id))}>Use ID</button></div>)}</div>
        <button className="btn light" disabled={busy} onClick={() => void action({ action: 'webhook' })}>Connect Telegram webhook</button>
      </section>}
      <section className="guide"><div><p className="eyebrow">HOW TO USE</p><h2>Three simple steps</h2></div><ol><li>Select a demonstration role, then enter a sale or expense.</li><li>Choose Svetlana to approve sales, commission splits, and expense allocations.</li><li>Refresh to check the dashboard and delivery status. Retry any failed Sheets or Telegram delivery.</li></ol></section>
      <footer><span>Friends Included Ltd · Fictional training data</span><nav>{state?.config.bot && <a href={state.config.bot} target="_blank">Telegram bot ↗</a>}{state?.config.sheet && <a href={state.config.sheet} target="_blank">Google Sheets ↗</a>}{state?.config.github && <a href={state.config.github} target="_blank">GitHub ↗</a>}</nav></footer>
    </div>
  </main>;
}
