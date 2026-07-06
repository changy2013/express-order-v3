import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticketId = searchParams.get('ticket_id');
    const direction = searchParams.get('direction');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10));

    const where: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (ticketId) { params.push(ticketId); where.push(`cr.ticket_id = $${idx++}`); }
    if (direction) { params.push(direction); where.push(`cr.compensation_direction = $${idx++}`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const r = await query(
      `SELECT cr.*, et.ticket_no, et.waybill_no 
       FROM compensation_records cr
       LEFT JOIN exception_tickets et ON cr.ticket_id = et.id
       ${whereSql} ORDER BY cr.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset]
    );
    const countR = await query(`SELECT COUNT(*) as total FROM compensation_records cr ${whereSql}`, params);

    // 统计
    const stats = await query(
      `SELECT compensation_direction, COUNT(*)::int as count, SUM(amount)::numeric as total_amount
       FROM compensation_records GROUP BY compensation_direction`
    );

    return NextResponse.json({
      records: r.rows,
      total: parseInt(countR.rows[0]?.total || '0'),
      page, pageSize,
      stats: stats.rows,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
