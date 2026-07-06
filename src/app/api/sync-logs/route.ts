import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestId = searchParams.get('requestId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10));

    let where = '';
    const params: any[] = [];
    let idx = 1;
    if (requestId) {
      params.push(requestId);
      where = `WHERE request_id = $${idx++}`;
    }

    const offset = (page - 1) * pageSize;
    const r = await query(
      `SELECT * FROM sync_logs ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset]
    );
    const countR = await query(`SELECT COUNT(*) as total FROM sync_logs ${where}`, params);

    // 统计最近 24h 数据
    const stats = await query(
      `SELECT 
        COUNT(*)::int as total,
        SUM(CASE WHEN success THEN 1 ELSE 0 END)::int as success_count,
        ROUND(AVG(duration_ms)::numeric, 0)::int as avg_duration
       FROM sync_logs WHERE created_at > NOW() - INTERVAL '24 hours'`
    );

    return NextResponse.json({
      logs: r.rows,
      total: parseInt(countR.rows[0]?.total || '0'),
      page,
      pageSize,
      stats: stats.rows[0] || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
