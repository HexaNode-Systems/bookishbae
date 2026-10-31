/**
 * Coupon Controller
 * Handles discount code verification and price reduction computation.
 */

import * as couponRoute from '../api/coupons/validate/route';

export const CouponController = {
  validateCoupon: couponRoute.POST,
};
