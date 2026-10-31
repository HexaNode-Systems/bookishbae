'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  LoaderCircle,
  Mail,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { OrderStatus } from '@/types/database';
import type { CatalogueBook } from './admin-types';
import { currency, safeReadApiResponse } from './admin-types';

interface OrderRecord {
  id: string; // Order number (e.g. BB-2026-12345)
  orderUuid: string;
  orderItemId?: string;
  buyerName: string;
  email: string;
  bookTitle: string;
  bookSlug?: string;
  amountRupees: number;
  totalPaise: number;
  paymentGateway: string;
  gatewayOrderId?: string | null;
  status: OrderStatus;
  downloadsUsed: number;
  downloadLimit: number;
  date: string;
  createdAt: string;
  paidAt?: string | null;
  refundedAt?: string | null;
}

const statusLabels: Record<OrderStatus, string> = {
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function OrdersPanel({ books }: { books: CatalogueBook[] }) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [title, setTitle] = useState('all');
  const [downloads, setDownloads] = useState('all');

  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [newLimit, setNewLimit] = useState<number>(5);

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/orders', {
        headers: { 'x-dev-admin': 'true' },
      });
      const { ok, data } = await safeReadApiResponse(res);
      if (ok && Array.isArray(data?.orders)) {
        const mapped: OrderRecord[] = data.orders.map((o: any) => {
            const item = o.items?.[0];
            return {
              id: o.order_number || o.id.slice(0, 8),
              orderUuid: o.id,
              orderItemId: item?.id,
              buyerName: o.full_name || 'Guest reader',
              email: o.email,
              bookTitle: item?.title_snapshot || 'E-book title',
              bookSlug: item?.slug_snapshot,
              amountRupees: Math.round(o.total_paise / 100),
              totalPaise: o.total_paise,
              paymentGateway: 'Cashfree',
              gatewayOrderId: o.razorpay_order_id,
              status: o.status as OrderStatus,
              downloadsUsed: item?.downloads_used ?? 0,
              downloadLimit:
                item?.download_limit_override ?? item?.download_limit ?? 5,
              date: new Date(o.created_at).toLocaleDateString(),
              createdAt: o.created_at,
              paidAt: o.paid_at,
              refundedAt: o.refunded_at,
            };
          });
          setOrders(mapped);
        }
    } catch {
      // Keep previous orders
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleRefresh = () => {
    setRefreshing(true);
    setActionNotice(null);
    loadOrders();
  };

  const handleRefund = async () => {
    if (!selectedOrder) return;
    setActionLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/admin/orders/refund', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-admin': 'true',
        },
        body: JSON.stringify({
          orderId: selectedOrder.orderUuid,
          reason: refundReason.trim() || 'Refund requested by administrator',
        }),
      });

      const { ok, error } = await safeReadApiResponse(res);
      if (!ok) {
        throw new Error(error || 'Refund processing failed.');
      }

      setActionNotice({
        kind: 'success',
        text: `Order ${selectedOrder.id} has been refunded. Entitlement revoked and email sent.`,
      });
      setShowRefundConfirm(false);
      setRefundReason('');

      // Update in local state
      setOrders((prev) =>
        prev.map((o) =>
          o.orderUuid === selectedOrder.orderUuid
            ? { ...o, status: 'refunded', refundedAt: new Date().toISOString() }
            : o,
        ),
      );
      setSelectedOrder((prev) =>
        prev
          ? { ...prev, status: 'refunded', refundedAt: new Date().toISOString() }
          : null,
      );
    } catch (err: any) {
      setActionNotice({
        kind: 'error',
        text: err.message || 'Could not process refund.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleResend = async () => {
    if (!selectedOrder) return;
    setActionLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/admin/orders/resend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-admin': 'true',
        },
        body: JSON.stringify({
          orderId: selectedOrder.orderUuid,
        }),
      });

      const { ok, error } = await safeReadApiResponse(res);
      if (!ok) {
        throw new Error(error || 'Failed to resend email.');
      }

      setActionNotice({
        kind: 'success',
        text: `Download link email successfully resent to ${selectedOrder.email}.`,
      });
    } catch (err: any) {
      setActionNotice({
        kind: 'error',
        text: err.message || 'Could not resend email.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateLimit = async () => {
    if (!selectedOrder?.orderItemId) {
      setActionNotice({
        kind: 'error',
        text: 'Order item reference missing for this order.',
      });
      return;
    }

    setActionLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/admin/orders/downloads', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-admin': 'true',
        },
        body: JSON.stringify({
          orderItemId: selectedOrder.orderItemId,
          downloadLimitOverride: newLimit,
        }),
      });

      const { ok, error } = await safeReadApiResponse(res);
      if (!ok) {
        throw new Error(error || 'Failed to update download limit.');
      }

      setActionNotice({
        kind: 'success',
        text: `Download limit updated to ${newLimit} for this order.`,
      });

      // Update in local state
      setOrders((prev) =>
        prev.map((o) =>
          o.orderUuid === selectedOrder.orderUuid
            ? { ...o, downloadLimit: newLimit }
            : o,
        ),
      );
      setSelectedOrder((prev) =>
        prev ? { ...prev, downloadLimit: newLimit } : null,
      );
    } catch (err: any) {
      setActionNotice({
        kind: 'error',
        text: err.message || 'Could not update download limit.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const filtering =
    !!query.trim() ||
    status !== 'all' ||
    title !== 'all' ||
    downloads !== 'all';

  const visible = orders.filter(
    (order) =>
      `${order.id} ${order.buyerName} ${order.email} ${order.bookTitle} ${order.orderUuid}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (status === 'all' || order.status === status) &&
      (title === 'all' || order.bookTitle === title) &&
      (downloads === 'all' ||
        (downloads === 'unused' && order.downloadsUsed === 0) ||
        (downloads === 'used' && order.downloadsUsed > 0) ||
        (downloads === 'limit' && order.downloadsUsed >= order.downloadLimit)),
  );

  const clear = () => {
    setQuery('');
    setStatus('all');
    setTitle('all');
    setDownloads('all');
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <h2>Order & Delivery Ledger</h2>
          <p>
            Real customer purchases, verified payment status, and download records.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="admin-button admin-button-secondary"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Refresh orders from database"
          >
            <RefreshCw
              size={15}
              className={refreshing ? 'admin-spin' : ''}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
          <span className="admin-badge">
            {loading ? 'Loading…' : `${orders.length} orders recorded`}
          </span>
        </div>
      </div>

      <div className="admin-order-filters">
        <div className="admin-field admin-order-search">
          <label htmlFor="order-search">Search orders</label>
          <div className="admin-search">
            <Search size={17} aria-hidden="true" />
            <input
              id="order-search"
              type="search"
              placeholder="Order number, customer, email, or book…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="admin-field">
          <label htmlFor="order-status">Payment status</label>
          <select
            id="order-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            {Object.entries(statusLabels).map(([val, lbl]) => (
              <option key={val} value={val}>
                {lbl}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="order-book">Book</label>
          <select
            id="order-book"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          >
            <option value="all">All books</option>
            {books.map((b) => (
              <option key={b.slug} value={b.title}>
                {b.title}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label htmlFor="order-downloads">Download usage</label>
          <select
            id="order-downloads"
            value={downloads}
            onChange={(event) => setDownloads(event.target.value)}
          >
            <option value="all">All download states</option>
            <option value="unused">Not downloaded</option>
            <option value="used">At least one download</option>
            <option value="limit">Limit reached</option>
          </select>
        </div>
      </div>

      <div className="admin-filter-summary">
        <p role="status">
          {visible.length} records loaded{filtering ? ' · Filters applied' : ''}
        </p>
        {filtering && (
          <button className="admin-text-button" onClick={clear}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Reset filters
          </button>
        )}
      </div>

      <div
        className="admin-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Orders and deliveries table"
      >
        <table className="admin-orders-table">
          <thead>
            <tr>
              {[
                'Order ID',
                'Customer',
                'Book',
                'Amount',
                'Payment Status',
                'Gateway',
                'Date',
                'Downloads',
                'Action',
              ].map((label) => (
                <th scope="col" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((order) => (
              <tr key={order.orderUuid || order.id}>
                <th scope="row">
                  <strong>{order.id}</strong>
                </th>
                <td>
                  <strong>{order.buyerName}</strong>
                  <small>{order.email}</small>
                </td>
                <td>{order.bookTitle}</td>
                <td className="admin-numeric">
                  {currency(order.amountRupees)}
                </td>
                <td>
                  <span className={`admin-badge admin-status-${order.status}`}>
                    {statusLabels[order.status] || order.status}
                  </span>
                </td>
                <td>{order.paymentGateway}</td>
                <td>{order.date}</td>
                <td>
                  {order.downloadsUsed} / {order.downloadLimit}
                  <small>
                    {order.downloadsUsed >= order.downloadLimit
                      ? 'Limit reached'
                      : order.downloadsUsed > 0
                        ? 'Downloaded'
                        : 'Not downloaded'}
                  </small>
                </td>
                <td>
                  <button
                    className="admin-button admin-button-secondary"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => {
                      setSelectedOrder(order);
                      setNewLimit(order.downloadLimit);
                      setActionNotice(null);
                      setShowRefundConfirm(false);
                    }}
                  >
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 && !loading && (
        <div className="admin-empty-state">
          <span className="admin-empty-icon">
            {filtering ? (
              <Search size={25} aria-hidden="true" />
            ) : (
              <ShoppingBag size={25} aria-hidden="true" />
            )}
          </span>
          <h3>
            {filtering
              ? 'No matching order records'
              : 'No customer orders yet'}
          </h3>
          <p>
            {filtering
              ? 'There are no records matching your current filter settings.'
              : 'Purchases made on the storefront will appear here with live payment status and download tracking.'}
          </p>
          {filtering && (
            <button
              className="admin-button admin-button-secondary"
              onClick={clear}
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Order Details & Management Modal */}
      {selectedOrder && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(40, 36, 48, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              maxWidth: 580,
              width: '100%',
              padding: 28,
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              position: 'relative',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <button
              onClick={() => setSelectedOrder(null)}
              aria-label="Close modal"
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#706978',
              }}
            >
              <X size={20} />
            </button>

            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
              Order {selectedOrder.id}
            </h2>
            <p style={{ color: '#706978', fontSize: 13, marginBottom: 20 }}>
              UUID: <code>{selectedOrder.orderUuid}</code>
            </p>

            {actionNotice && (
              <div
                className={`admin-notice admin-notice-${actionNotice.kind}`}
                style={{ marginBottom: 16 }}
              >
                {actionNotice.kind === 'success' ? (
                  <CheckCircle2 size={16} />
                ) : (
                  <AlertCircle size={16} />
                )}
                <p>{actionNotice.text}</p>
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px 20px',
                padding: '16px',
                background: '#fcfaf7',
                borderRadius: 8,
                marginBottom: 20,
                fontSize: 13,
              }}
            >
              <div>
                <strong style={{ display: 'block', color: '#706978', fontSize: 11, textTransform: 'uppercase' }}>
                  Customer Name
                </strong>
                {selectedOrder.buyerName}
              </div>
              <div>
                <strong style={{ display: 'block', color: '#706978', fontSize: 11, textTransform: 'uppercase' }}>
                  Email Address
                </strong>
                {selectedOrder.email}
              </div>
              <div>
                <strong style={{ display: 'block', color: '#706978', fontSize: 11, textTransform: 'uppercase' }}>
                  Book Title
                </strong>
                {selectedOrder.bookTitle}
              </div>
              <div>
                <strong style={{ display: 'block', color: '#706978', fontSize: 11, textTransform: 'uppercase' }}>
                  Amount Paid
                </strong>
                <strong>{currency(selectedOrder.amountRupees)}</strong>
              </div>
              <div>
                <strong style={{ display: 'block', color: '#706978', fontSize: 11, textTransform: 'uppercase' }}>
                  Payment Status
                </strong>
                <span className={`admin-badge admin-status-${selectedOrder.status}`}>
                  {statusLabels[selectedOrder.status] || selectedOrder.status}
                </span>
              </div>
              <div>
                <strong style={{ display: 'block', color: '#706978', fontSize: 11, textTransform: 'uppercase' }}>
                  Date Created
                </strong>
                {new Date(selectedOrder.createdAt).toLocaleString()}
              </div>
              <div>
                <strong style={{ display: 'block', color: '#706978', fontSize: 11, textTransform: 'uppercase' }}>
                  Downloads Used
                </strong>
                {selectedOrder.downloadsUsed} / {selectedOrder.downloadLimit}
              </div>
              <div>
                <strong style={{ display: 'block', color: '#706978', fontSize: 11, textTransform: 'uppercase' }}>
                  Gateway Order ID
                </strong>
                <code>{selectedOrder.gatewayOrderId || 'None'}</code>
              </div>
            </div>

            {/* Actions for Paid Orders */}
            {selectedOrder.status === 'paid' && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                  Delivery & Order Actions
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                  <button
                    className="admin-button admin-button-secondary"
                    onClick={handleResend}
                    disabled={actionLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Mail size={15} />
                    <span>Resend Delivery Email</span>
                  </button>

                  <button
                    className="admin-button admin-button-secondary"
                    onClick={() => setShowRefundConfirm(!showRefundConfirm)}
                    disabled={actionLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#aa4747' }}
                  >
                    <RotateCcw size={15} />
                    <span>Refund Order</span>
                  </button>
                </div>

                {/* Refund confirmation section */}
                {showRefundConfirm && (
                  <div
                    style={{
                      background: '#fff0f0',
                      border: '1px solid #efd0d0',
                      borderRadius: 8,
                      padding: 16,
                      marginBottom: 20,
                    }}
                  >
                    <strong style={{ color: '#aa4747', display: 'block', marginBottom: 8 }}>
                      Confirm refund for {currency(selectedOrder.amountRupees)}?
                    </strong>
                    <p style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
                      This revokes full e-book download access and marks the order as refunded in the database.
                    </p>
                    <div className="admin-field" style={{ marginBottom: 12 }}>
                      <label htmlFor="refund-reason" style={{ fontSize: 12 }}>
                        Reason for refund
                      </label>
                      <input
                        id="refund-reason"
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        placeholder="e.g. Customer request or accidental double order"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        className="admin-button"
                        onClick={handleRefund}
                        disabled={actionLoading}
                        style={{ background: '#aa4747', borderColor: '#aa4747', color: '#fff' }}
                      >
                        {actionLoading ? (
                          <LoaderCircle size={15} className="admin-spin" />
                        ) : null}{' '}
                        Confirm & Issue Refund
                      </button>
                      <button
                        className="admin-button admin-button-secondary"
                        onClick={() => setShowRefundConfirm(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Download Limit Override */}
                <div
                  style={{
                    borderTop: '1px solid #e7e2e9',
                    paddingTop: 16,
                    marginTop: 16,
                  }}
                >
                  <strong style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
                    Adjust Download Limit
                  </strong>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={newLimit}
                      onChange={(e) => setNewLimit(Number(e.target.value))}
                      style={{ width: 90 }}
                    />
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={handleUpdateLimit}
                      disabled={actionLoading || newLimit === selectedOrder.downloadLimit}
                      style={{ fontSize: 13 }}
                    >
                      Update Limit
                    </button>
                    <span style={{ fontSize: 12, color: '#706978' }}>
                      Current limit: {selectedOrder.downloadLimit}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {selectedOrder.status === 'refunded' && (
              <div
                style={{
                  background: '#f0eff3',
                  padding: 14,
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#74677b',
                  marginTop: 16,
                }}
              >
                <AlertCircle size={16} style={{ display: 'inline', marginRight: 6 }} />
                This order was refunded. E-book download access is revoked.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
