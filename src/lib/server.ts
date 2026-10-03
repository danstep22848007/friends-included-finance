import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { JWT } from 'google-auth-library';
import { commission, notificationText, people, Transaction } from './core';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function db() {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function record(employee: string, source: 'website' | 'telegram', chat: number | null, data: unknown) {
  const { data: row, error } = await db().rpc('record_transaction', {
    p_employee: employee, p_source: source, p_chat: chat, p_data: data,
  });
  if (error) throw new Error(error.message);
  return row as Transaction;
}

export async function decide(manager: string, reference: string, split: unknown, allocation: string | null) {
  const { data: row, error } = await db().rpc('decide_transaction', {
    p_manager: manager, p_reference: reference, p_split: split, p_allocation: allocation,
  });
  if (error) throw new Error(error.message);
  return row as Transaction;
}

export async function getRow(reference: string) {
  const { data, error } = await db().from('transactions').select('*').eq('reference', reference.toUpperCase()).single();
  if (error) throw new Error(error.message);
  return data as Transaction;
}

export async function getRows(employee: string) {
  const role = people[employee as keyof typeof people]?.role;
  if (!role) throw new Error('Choose a demonstration role');
  let query = db().from('transactions').select('*').order('submitted_at', { ascending: true });
  if (role !== 'manager') query = query.eq('employee_id', employee);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as Transaction[];
}

async function update(reference: string, patch: Record<string, unknown>) {
  const { error } = await db().from('transactions').update(patch).eq('reference', reference);
  if (error) throw new Error(error.message);
}

async function googleRequest(path: string, method: string, body?: unknown) {
  const credentials = JSON.parse(required('GOOGLE_SERVICE_ACCOUNT_JSON'));
  const auth = new JWT({ email: credentials.client_email, key: credentials.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const token = await auth.getAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${required('GOOGLE_SHEET_ID')}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Google Sheets ${response.status}: ${(await response.text()).slice(0, 350)}`);
  return response.json();
}

const salesHeader = ['Reference', 'Submission time', 'Salesperson', 'Customer', 'Project', 'Description', 'Amount EUR',
  'Proposed Richard %', 'Proposed Anastasia %', 'Proposed Jean-Claude %', 'Approved Richard %',
  'Approved Anastasia %', 'Approved Jean-Claude %', 'Richard earned EUR', 'Anastasia earned EUR',
  'Jean-Claude earned EUR', 'Status'];
const expenseHeader = ['Reference', 'Submission time', 'Reporter', 'Description', 'Category', 'Amount EUR',
  'Proposed allocation', 'Final allocation', 'Status'];

export async function ensureSheets() {
  const metadata = await googleRequest('?fields=sheets.properties(title%2CsheetId)', 'GET') as { sheets?: { properties: { title: string; sheetId: number } }[] };
  const existing = new Set((metadata.sheets || []).map(s => s.properties.title));
  const missing = ['Sales', 'Expenses'].filter(title => !existing.has(title));
  if (missing.length) await googleRequest(':batchUpdate', 'POST', { requests: missing.map(title => ({ addSheet: { properties: { title } } })) });
  const ids = missing.length ? await googleRequest('?fields=sheets.properties(title%2CsheetId)', 'GET') as typeof metadata : metadata;
  const defaultSheet = ids.sheets?.find(s => s.properties.title === 'Sheet1');
  if (defaultSheet) {
    const content = await googleRequest(`/values/${encodeURIComponent('Sheet1!A1:Z20')}`, 'GET') as { values?: unknown[][] };
    if (!content.values?.length) await googleRequest(':batchUpdate', 'POST', { requests: [{ deleteSheet: { sheetId: defaultSheet.properties.sheetId } }] });
  }
  for (const [title, header] of [['Sales', salesHeader], ['Expenses', expenseHeader]] as const) {
    await googleRequest(`/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, 'PUT', { values: [header] });
  }
  const formats = [{ title: 'Sales', start: 6, end: 7 }, { title: 'Sales', start: 13, end: 16 }, { title: 'Expenses', start: 5, end: 6 }];
  await googleRequest(':batchUpdate', 'POST', { requests: formats.map(format => ({ repeatCell: {
    range: { sheetId: ids.sheets!.find(s => s.properties.title === format.title)!.properties.sheetId,
      startRowIndex: 1, startColumnIndex: format.start, endColumnIndex: format.end },
    cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '€#,##0.00' } } },
    fields: 'userEnteredFormat.numberFormat',
  } })) });
}

export async function syncSheet(t: Transaction) {
  try {
    await ensureSheets();
    const sale = t.kind === 'sale';
    const earned = commission(t);
    const values = sale ? [t.reference, t.submitted_at, people[t.employee_id].name, t.customer, t.project,
      t.description, Number(t.amount), t.proposed_r, t.proposed_a, t.proposed_j,
      t.approved_r ?? '', t.approved_a ?? '', t.approved_j ?? '',
      earned.r / 100, earned.a / 100, earned.j / 100, t.status] :
      [t.reference, t.submitted_at, people[t.employee_id].name, t.description, t.category,
        Number(t.amount), t.proposed_allocation, t.final_allocation ?? '', t.status];
    const tab = sale ? 'Sales' : 'Expenses';
    await googleRequest(`/values/${encodeURIComponent(`${tab}!A${t.sheet_row}`)}?valueInputOption=RAW`, 'PUT', { values: [values] });
    await update(t.reference, { sync_status: 'synced', sync_error: null });
    return true;
  } catch (error) {
    await update(t.reference, { sync_status: 'failed', sync_error: String(error).slice(0, 500) });
    return false;
  }
}

export async function sendTelegram(chatId: number, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${required('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }), cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${response.status}`);
}

export async function sendDecision(t: Transaction) {
  if (!t.notification_chat_id) return false;
  try {
    await sendTelegram(t.notification_chat_id, notificationText(t));
    await update(t.reference, { notification_status: 'sent', notification_error: null });
    return true;
  } catch (error) {
    await update(t.reference, { notification_status: 'failed', notification_error: String(error).slice(0, 500) });
    return false;
  }
}

export async function setWebhook() {
  const url = `${required('APP_BASE_URL').replace(/\/$/, '')}/api/telegram`;
  const response = await fetch(`https://api.telegram.org/bot${required('TELEGRAM_BOT_TOKEN')}/setWebhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: required('TELEGRAM_WEBHOOK_SECRET'), allowed_updates: ['message'] }),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || 'Could not set Telegram webhook');
  return url;
}
