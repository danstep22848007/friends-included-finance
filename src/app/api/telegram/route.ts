import { NextRequest, NextResponse } from 'next/server';
import { db, getRow, record, sendTelegram, syncSheet } from '@/lib/server';
import { allocationName, cents, money } from '@/lib/core';

export const dynamic = 'force-dynamic';

type TelegramMessage = { from?: { id: number }; chat: { id: number; type: string }; text?: string };

function parse(text: string) {
  const [command, ...parts] = text.split('|').map(s => s.trim());
  if (command.toLowerCase().startsWith('/sale')) {
    if (parts.length !== 6) throw new Error('Use /sale | reference | customer | A or B | description | amount | Richard/Anastasia/Jean-Claude percentages');
    const [reference, customer, project, description, amount, split] = parts;
    const shares = split.split('/').map(s => Number(s.trim().replace('%', '')));
    if (shares.length !== 3 || shares.some(n => !Number.isInteger(n))) throw new Error('Enter three whole-number commission percentages, for example 50/30/20');
    return { kind: 'sale', reference, customer, project: project.toUpperCase(), description, amount,
      proposed_r: shares[0], proposed_a: shares[1], proposed_j: shares[2] };
  }
  if (command.toLowerCase().startsWith('/expense')) {
    if (parts.length !== 5) throw new Error('Use /expense | reference | description | Materials, Travel, or Other | amount | A, B, or Company overhead');
    const [reference, description, category, amount, allocation] = parts;
    return { kind: 'expense', reference, description, category, amount,
      proposed_allocation: allocation.toUpperCase() === 'A' || allocation.toUpperCase() === 'B' ? allocation.toUpperCase() : allocation };
  }
  throw new Error('Use /sale or /expense. Send /help for the formats.');
}

export async function POST(request: NextRequest) {
  if (!process.env.TELEGRAM_WEBHOOK_SECRET ||
      request.headers.get('x-telegram-bot-api-secret-token') !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const update = await request.json();
  const message = update.message as TelegramMessage | undefined;
  if (!message?.from?.id || message.chat.type !== 'private' || !message.text) return NextResponse.json({ ok: true });
  const userId = message.from.id, chatId = message.chat.id, text = message.text.trim();
  try {
    if (text.startsWith('/start')) {
      const { error } = await db().from('telegram_contacts').upsert({ telegram_user_id: userId, chat_id: chatId, started_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      await sendTelegram(chatId, `Welcome to Friends Included. Your Telegram user ID is ${userId}; your chat ID is ${chatId}. Ask the manager to link this ID to your fictional employee in the website. Send /help for entry formats.`);
      return NextResponse.json({ ok: true });
    }
    if (text.startsWith('/help')) {
      await sendTelegram(chatId, 'Sale: /sale | S01 | Olivia Rose | A | One proud uncle | 1000 | 50/30/20\nExpense: /expense | E01 | Rented suit | Materials | 120 | A\nUse Company overhead for overhead expenses.');
      return NextResponse.json({ ok: true });
    }
    const { data: link, error } = await db().from('telegram_links').select('employee_id').eq('telegram_user_id', userId).single();
    if (error || !link) throw new Error('Your Telegram ID is not linked. Start the bot, then ask the manager to link it on the website.');
    const data = parse(text);
    const row = await record(link.employee_id, 'telegram', chatId, data);
    const synced = await syncSheet(row);
    const saved = await getRow(row.reference);
    const location = saved.kind === 'sale' ? `project ${saved.project}` : `proposed ${allocationName(saved.proposed_allocation)}`;
    await sendTelegram(chatId, `${saved.reference} recorded: ${money(cents(saved.amount))}, ${location}. Status: ${saved.status}.${synced ? '' : ' Google Sheets sync pending; the manager can retry.'}`);
  } catch (error) {
    try { await sendTelegram(chatId, `Could not record: ${error instanceof Error ? error.message : String(error)}`); }
    catch { /* The saved transaction remains intact if Telegram delivery fails. */ }
  }
  return NextResponse.json({ ok: true });
}
