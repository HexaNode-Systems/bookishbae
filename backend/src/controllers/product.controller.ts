/**
 * Product Controller
 * Handles catalogue queries and product management for both public storefront and admin panel.
 */

import * as publicProducts from '../api/products/route';
import * as publicProductSlug from '../api/products/[slug]/route';
import * as adminProducts from '../api/admin/products/route';
import * as adminProductDetail from '../api/admin/products/[id]/route';

export const ProductController = {
  // Public Storefront
  getPublicProducts: publicProducts.GET,
  getProductBySlug: publicProductSlug.GET,

  // Admin Management
  getAdminProducts: adminProducts.GET,
  createAdminProduct: adminProducts.POST,
  getAdminProductById: adminProductDetail.GET,
  updateAdminProduct: adminProductDetail.PATCH,
  deleteAdminProduct: adminProductDetail.DELETE,
};
