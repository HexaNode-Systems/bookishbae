import { fetchCashfreeOrder, fetchCashfreePayments } from './cashfree';
import { ApiError } from './api/errors';
import type { Order } from '@/types/database';

/** Both the return page and signed webhooks use Cashfree's authoritative ledger. */
export async function confirmCashfreePayment(order: Pick<Order, 'razorpay_order_id' | 'order_number' | 'total_paise' | 'currency'>): Promise<{ paid: boolean; status: 'paid' | 'pending' | 'cancelled' | 'failed'; paymentId?: string }> {
  const reference = order.razorpay_order_id || order.order_number;
  const remote = await fetchCashfreeOrder(reference);
  if (remote.order_id !== reference || Math.round(Number(remote.order_amount) * 100) !== order.total_paise || remote.order_currency !== order.currency) {
    throw new ApiError('upstream_error', 'Payment details could not be matched to this order. Please contact support.');
  }
  const payments = await fetchCashfreePayments(reference);
  const success = payments.find(payment => payment.payment_status === 'SUCCESS' &&
    payment.order_id === reference && payment.payment_currency === order.currency &&
    Math.round(Number(payment.payment_amount) * 100) === order.total_paise && payment.cf_payment_id != null);
  if (remote.order_status === 'PAID' && success) return { paid: true, status: 'paid', paymentId: String(success.cf_payment_id) };
  if (remote.order_status === 'PAID') return { paid: false, status: 'pending' };
  if (['EXPIRED', 'TERMINATED', 'TERMINATION_REQUESTED'].includes(remote.order_status || '')) return { paid: false, status: 'cancelled' };
  const latest = [...payments].sort((a, b) => String(b.payment_time || '').localeCompare(String(a.payment_time || '')))[0];
  if (latest?.payment_status === 'USER_DROPPED') return { paid: false, status: 'cancelled' };
  if (latest?.payment_status === 'FAILED') return { paid: false, status: 'failed' };
  return { paid: false, status: 'pending' };
}
