/**
 * Order Controller
 * Handles admin order ledger inspection, download overrides, refunds, and email resends.
 */

import * as adminOrders from '../api/admin/orders/route';
import * as adminOrderDetail from '../api/admin/orders/[id]/route';
import * as adminOrderDownloads from '../api/admin/orders/downloads/route';
import * as adminOrderRefund from '../api/admin/orders/refund/route';
import * as adminOrderResend from '../api/admin/orders/resend/route';

export const OrderController = {
  getOrders: adminOrders.GET,
  getOrderById: adminOrderDetail.GET,
  overrideDownloads: adminOrderDownloads.PATCH,
  refundOrder: adminOrderRefund.POST,
  resendDeliveryEmail: adminOrderResend.POST,
};
