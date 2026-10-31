import { NextResponse } from 'next/server';

/** Retired provider endpoint. Never accept another gateway's secret or imply
 * that this legacy route processes/fulfills a payment. */
export async function POST(_request?: Request) {
  return NextResponse.json(
    { error: { code: 'provider_retired', message: 'Razorpay webhooks are disabled.' } },
    { status: 410 },
  );
}
