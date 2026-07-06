import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const r = await query('SELECT * FROM approval_configs WHERE enabled = true');
    const configs: Record<string, any> = {};
    for (const row of r.rows) {
      configs[row.config_key] = row.config_value;
    }
    return NextResponse.json({ configs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { config_key, config_value } = body;
    if (!config_key || !config_value) {
      return NextResponse.json({ error: '缺少必填参数: config_key, config_value' }, { status: 400 });
    }
    await query(
      `UPDATE approval_configs SET config_value = $1, updated_at = NOW() WHERE config_key = $2`,
      [JSON.stringify(config_value), config_key]
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
