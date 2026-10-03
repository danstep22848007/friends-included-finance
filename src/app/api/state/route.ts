import { NextRequest, NextResponse } from 'next/server';
import { getRows, db } from '@/lib/server';
import { people, totals } from '@/lib/core';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const employee = request.nextUrl.searchParams.get('role') || '';
    if (!(employee in people)) return NextResponse.json({ error: 'Choose a demonstration role' }, { status: 400 });
    const rows = await getRows(employee);
    let contacts: unknown[] = [], links: unknown[] = [];
    if (employee === 'svetlana') {
      const [c, l] = await Promise.all([
        db().from('telegram_contacts').select('*').order('started_at', { ascending: false }),
        db().from('telegram_links').select('*').order('linked_at', { ascending: false }),
      ]);
      if (c.error) throw c.error;
      if (l.error) throw l.error;
      contacts = c.data || []; links = l.data || [];
    }
    return NextResponse.json({ rows, totals: employee === 'svetlana' ? totals(rows) : null, contacts, links,
      config: {
        name: process.env.STUDENT_NAME || 'Dans Stepanovs',
        bot: process.env.TELEGRAM_BOT_USERNAME ? `https://t.me/${process.env.TELEGRAM_BOT_USERNAME.replace('@', '')}` : null,
        sheet: process.env.GOOGLE_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit` : null,
        github: process.env.GITHUB_REPO_URL || null,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
