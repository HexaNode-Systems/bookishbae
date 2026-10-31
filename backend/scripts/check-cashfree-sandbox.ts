/** Creates an unpaid sandbox session only. Never submits a payment. */
import { env } from '../src/lib/env';
import { createCashfreeOrder } from '../src/lib/cashfree';
import { confirmCashfreePayment } from '../src/lib/payment-verification';

async function main() {
  if (env.CASHFREE_ENVIRONMENT !== 'TEST') throw new Error('Refusing to run verification against Cashfree production.');
  const reference = `BB-VERIFY-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const session = await createCashfreeOrder({
    orderId: reference, amountPaise: 100,
    customer: { id: `verify_${reference.slice(-20)}`, name: 'Sandbox Verification', email: 'sandbox-verification@example.com', phone: '9876543210' },
    note: 'Sandbox integration verification; no payment submitted',
  });
  const state = await confirmCashfreePayment({ razorpay_order_id: reference, order_number: reference, total_paise: 100, currency: 'INR' });
  if (state.paid || state.status !== 'pending') throw new Error('A newly created, unpaid sandbox order must remain pending.');
  console.log(JSON.stringify({ mode: 'sandbox', orderReference: reference, sessionReturned: !!session.paymentSessionId, serverVerification: state.status, paymentSubmitted: false }, null, 2));
}

main().catch((error: any) => {
  // Axios errors contain authenticated headers; never print the raw object.
  console.error(JSON.stringify({ message: error.message, status: error.response?.status, code: error.response?.data?.code }));
  process.exitCode = 1;
});
