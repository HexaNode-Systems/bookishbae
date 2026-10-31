/**
 * Webhook Controller
 * Handles incoming payment provider webhooks with cryptographic signature verification.
 */

import * as cashfreeWebhook from '../api/webhooks/cashfree/route';
import * as razorpayWebhook from '../api/webhooks/razorpay/route';

export const WebhookController = {
  handleCashfree: cashfreeWebhook.POST,
  handleRazorpay: razorpayWebhook.POST,
};
