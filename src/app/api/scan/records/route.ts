import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const waybillNo = searchParams.get('waybill_no');
    const ticketId = searchParams.get('ticket_id');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10));

    const where: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (waybillNo) { params.push(waybillNo); where.push(`waybill_no = $${idx++}`); }
    if (ticketId) { params.push(ticketId); where.push(`ticket_id = $${idx++}`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const r = await query(
      `SELECT * FROM scan_records ${whereSql} ORDER BY scanned_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset]
    );

    return NextResponse.json({ records: r.rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
