import { NextResponse } from 'next/server';
import { V2Client } from '@/lib/v2-client';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const result = await V2Client.syncWaybills();
  return NextResponse.json(result);
}
