import { NextResponse } from 'next/server';
import { checkTimeouts } from '@/lib/state-machine/timeout-checker';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Vercel Cron Job — every 15 minutes
 * 扫描超时工单并自动处理
 */
export async function GET() {
  try {
    const result = await checkTimeouts();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
