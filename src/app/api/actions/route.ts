import { NextRequest, NextResponse } from 'next/server';
import { db, decide, getRow, record, sendDecision, setWebhook, syncSheet } from '@/lib/server';
import { people } from '@/lib/core';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const input = await request.json();
    const role = String(input.role || '');
    if (!(role in people)) throw new Error('Choose a demonstration role');
    if (input.action === 'create') {
      const row = await record(role, 'website', null, input.data);
      await syncSheet(row);
      return NextResponse.json({ ok: true, row: await getRow(row.reference) });
    }
    if (role !== 'svetlana') throw new Error('Only Svetlana can perform manager actions');
    if (input.action === 'decide') {
      const row = await decide(role, String(input.reference || ''), input.split || null, input.allocation || null);
      await syncSheet(row);
      await sendDecision(row);
      return NextResponse.json({ ok: true, row: await getRow(row.reference) });
    }
    if (input.action === 'retry') {
      const row = await getRow(String(input.reference || ''));
      if (row.sync_status !== 'synced') await syncSheet(row);
      if (row.notification_status === 'failed' || row.notification_status === 'pending') await sendDecision(row);
      return NextResponse.json({ ok: true, row: await getRow(row.reference) });
    }
    if (input.action === 'link') {
      const id = Number(input.telegram_user_id);
      const employee = String(input.employee_id || '');
      if (!Number.isSafeInteger(id) || !people[employee as keyof typeof people]) throw new Error('Choose a valid Telegram ID and employee');
      const { data: contact, error: contactError } = await db().from('telegram_contacts').select('*').eq('telegram_user_id', id).single();
      if (contactError || !contact) throw new Error('That Telegram user must start the bot before linking');
      const { error } = await db().from('telegram_links').upsert({ telegram_user_id: id, chat_id: contact.chat_id, employee_id: employee, linked_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    if (input.action === 'webhook') {
      const url = await setWebhook();
      return NextResponse.json({ ok: true, url });
    }
    throw new Error('Unknown action');
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
