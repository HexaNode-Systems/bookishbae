/** SDK transport doubles live only in tests; application code always calls Cashfree. */
export const gatewayOrders = new Map<string, any>();
export const gatewayPayments = new Map<string, any[]>();
export const gatewayCreates: any[] = [];
export function setGatewayPaid(reference: string, amountPaise?: number) {
  const order = gatewayOrders.get(reference);
  if (!order) throw new Error(`Missing gateway test order: ${reference}`);
  order.order_status = 'PAID';
  gatewayPayments.set(reference, [{ order_id: reference, cf_payment_id: `cf_${reference}`, payment_status: 'SUCCESS', payment_amount: (amountPaise ?? Math.round(order.order_amount * 100)) / 100, payment_currency: 'INR', payment_time: new Date().toISOString() }]);
}
export async function installPaymentFixture() {
  const { cashfree } = await import('../src/lib/cashfree');
  const client = cashfree();
  client.PGCreateOrder = (async (request: any) => {
    gatewayCreates.push(request);
    const order = { ...request, order_status: 'ACTIVE', payment_session_id: `fixture_session_${crypto.randomUUID()}`, cf_order_id: String(gatewayCreates.length) };
    gatewayOrders.set(request.order_id, order); gatewayPayments.set(request.order_id, []);
    return { data: order };
  }) as typeof client.PGCreateOrder;
  client.PGFetchOrder = (async (reference: string) => {
    const order = gatewayOrders.get(reference);
    if (!order) throw new Error('Gateway order not found');
    return { data: order };
  }) as typeof client.PGFetchOrder;
  client.PGOrderFetchPayments = (async (reference: string) => ({ data: gatewayPayments.get(reference) ?? [] })) as typeof client.PGOrderFetchPayments;
  client.PGOrderCreateRefund = (async (_reference: string, body: any) => ({ data: { refund_id: body.refund_id, refund_status: 'SUCCESS' } })) as typeof client.PGOrderCreateRefund;
}
