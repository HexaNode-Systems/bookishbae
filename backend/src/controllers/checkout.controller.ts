/**
 * Checkout Controller
 * Handles server-calculated payment creation and server-side payment verification.
 */

import * as checkoutRoute from '../api/checkout/route';
import * as checkoutVerifyRoute from '../api/checkout/verify/route';

export const CheckoutController = {
  getConfiguration: checkoutRoute.GET,
  createOrder: checkoutRoute.POST,
  verifyPayment: checkoutVerifyRoute.POST,
};
