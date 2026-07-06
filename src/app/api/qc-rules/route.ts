import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const r = await query('SELECT * FROM qc_rules ORDER BY created_at DESC');
    return NextResponse.json({ rules: r.rows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, exception_type, trigger_conditions, severity, auto_create_ticket, target_approval_level } = body;
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO qc_rules(id, name, description, exception_type, trigger_conditions, severity, auto_create_ticket, target_approval_level)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, description || null, exception_type, JSON.stringify(trigger_conditions), severity || 'medium', auto_create_ticket !== false, target_approval_level || 'level1']
    );
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(fields)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (key === 'trigger_conditions') {
        sets.push(`${dbKey} = $${idx++}`);
        params.push(JSON.stringify(value));
      } else {
        sets.push(`${dbKey} = $${idx++}`);
        params.push(value);
      }
    }
    sets.push('updated_at = NOW()');
    params.push(id);
    await query(`UPDATE qc_rules SET ${sets.join(', ')} WHERE id = $${idx}`, params);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  try {
    await query('DELETE FROM qc_rules WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
