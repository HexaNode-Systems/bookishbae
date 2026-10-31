/**
 * Money handling for BookishBae.
 *
 * Every amount in this codebase is an integer number of paise. Rupees exist
 * only at the edge, when something is shown to a human. Payment amounts are safely converted from
 * denominated in paise, so nothing is ever converted on the way to or from the
 * gateway — which is exactly why there is no rounding bug to find here.
 *
 * Never store or compute money as a float.
 */

export const PAISE_PER_RUPEE = 100;

/** Largest amount accepted in a single order, in paise (₹5,00,000). */
export const MAX_ORDER_PAISE = 50_000_000;

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Format paise as Indian currency: ₹1,299 or ₹1,299.50.
 *
 * Whole rupees drop the decimals, because "₹299.00" on a book cover reads like
 * a spreadsheet. `en-IN` also gives the lakh/crore grouping Indian buyers
 * expect rather than thousands.
 */
export function formatPaise(paise: number, options: { showDecimals?: boolean } = {}): string {
  const rupees = paiseToRupees(paise);
  const hasPaise = paise % PAISE_PER_RUPEE !== 0;
  const showDecimals = options.showDecimals ?? hasPaise;

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(rupees);
}

/** Bare number with Indian grouping, no symbol — for charts and tables. */
export function formatPaiseCompact(paise: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(paiseToRupees(paise));
}

/** The price a buyer actually pays: the discount if there is one, else list. */
export function effectivePrice(product: {
  price_paise: number;
  discount_price_paise?: number | null;
}): number {
  return product.discount_price_paise ?? product.price_paise;
}

/** Whole-percent saving, rounded. Returns 0 when there is no discount. */
export function discountPercent(product: {
  price_paise: number;
  discount_price_paise?: number | null;
}): number {
  if (!product.discount_price_paise || product.price_paise <= 0) return 0;
  const saving = product.price_paise - product.discount_price_paise;
  return Math.round((saving / product.price_paise) * 100);
}

/**
 * Guard for anything that claims to be an amount in paise.
 *
 * Rejects non-integers, negatives and absurd values, which is what you want
 * before handing a number to the payment gateway or writing it into an order row.
 */
export function isValidPaise(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ORDER_PAISE
  );
}

export function assertValidPaise(value: unknown, label = 'amount'): number {
  if (!isValidPaise(value)) {
    throw new Error(`${label} must be a whole number of paise between 0 and ${MAX_ORDER_PAISE}`);
  }
  return value;
}
