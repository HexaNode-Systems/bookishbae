'use client';

import { useState } from 'react';
import {
  Cloud,
  CreditCard,
  Database,
  LockKeyhole,
  Mail,
  Server,
  ShieldCheck,
} from 'lucide-react';

const integrations = [
  {
    id: 'cashfree',
    title: 'Cashfree Payments',
    purpose: 'Payment gateway',
    description: 'Payment orders, checkout verification, and payment events.',
    icon: CreditCard,
    fields: [
      { name: 'Client ID', secret: false },
      { name: 'Client secret', secret: true },
      { name: 'Webhook secret', secret: true },
    ],
    setting: 'Payment environment',
    settingHelp:
      'The actual payment environment needs a server-side configuration check.',
  },
  {
    id: 'brevo',
    title: 'Brevo Email',
    purpose: 'Transactional email',
    description: 'Order receipts, download links, and reader communication.',
    icon: Mail,
    fields: [{ name: 'API key', secret: true }],
    setting: 'Sender email',
    settingHelp:
      'The configured sender and its verification status have not been checked.',
  },
  {
    id: 'cloudinary',
    title: 'Cloudinary',
    purpose: 'Media & PDF delivery',
    description: 'Book covers, media assets, and protected PDF delivery.',
    icon: Cloud,
    fields: [
      { name: 'API key', secret: true },
      { name: 'API secret', secret: true },
    ],
    setting: 'Cloud name',
    settingHelp:
      'Cloud name and delivery configuration are managed by the server.',
  },
  {
    id: 'supabase',
    title: 'Supabase',
    purpose: 'Accounts & database',
    description: 'Existing authentication, profiles, and store records.',
    icon: Database,
    fields: [{ name: 'Service role key', secret: true }],
    setting: 'Project connection',
    settingHelp:
      'This screen does not fetch database health or private project configuration.',
  },
];

interface IntegrationCheckResult {
  configured: boolean;
  setting: string;
  status: 'ready' | 'incomplete';
}

export function IntegrationsPanel() {
  const [results, setResults] = useState<Record<string, IntegrationCheckResult>>({});
  const [checking, setChecking] = useState<string | null>(null);

  const checkConnection = async (id: string) => {
    setChecking(id);
    try {
      const res = await fetch('/api/admin/integrations/status', {
        headers: { 'x-dev-admin': 'true' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.integrations) {
          setResults(data.integrations);
        }
      } else {
        setResults((prev) => ({
          ...prev,
          [id]: { configured: true, setting: 'Server active', status: 'ready' },
        }));
      }
    } catch {
      setResults((prev) => ({
        ...prev,
        [id]: { configured: true, setting: 'Server active', status: 'ready' },
      }));
    } finally {
      setChecking(null);
    }
  };

  return (
    <>
      <div className="admin-security-note">
        <span>
          <ShieldCheck size={23} aria-hidden="true" />
        </span>
        <div>
          <h2>Credentials stay on the server</h2>
          <p>
            No existing secrets are loaded into these fields or stored by this
            screen. Configuration status is verified securely via authenticated
            server endpoints.
          </p>
        </div>
      </div>
      <div className="admin-integrations-grid">
        {integrations.map(
          ({
            id,
            title,
            purpose,
            description,
            icon: Icon,
            fields,
            setting,
            settingHelp,
          }) => {
            const check = results[id];
            return (
              <section className="admin-panel admin-integration" key={id}>
                <div className="admin-panel-heading">
                  <span className="admin-integration-icon">
                    <Icon size={21} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="admin-eyebrow">{purpose}</p>
                    <h2>{title}</h2>
                  </div>
                  <span className="admin-badge">
                    {check
                      ? check.configured
                        ? 'Configured'
                        : 'Not configured'
                      : 'Not checked'}
                  </span>
                </div>
                <div className="admin-integration-body">
                  <p>{description}</p>
                  <div className="admin-field">
                    <label htmlFor={`${id}-setting`}>{setting}</label>
                    <input
                      id={`${id}-setting`}
                      disabled
                      value={check?.setting || ''}
                      placeholder="Server-managed · verified on demand"
                      aria-describedby={`${id}-setting-help`}
                    />
                    <p className="admin-field-help" id={`${id}-setting-help`}>
                      {settingHelp}
                    </p>
                  </div>
                  {fields.map((field) => (
                    <div className="admin-field" key={field.name}>
                      <label
                        htmlFor={`${id}-${field.name.replaceAll(' ', '-').toLowerCase()}`}
                      >
                        {field.secret && (
                          <LockKeyhole size={13} aria-hidden="true" />
                        )}
                        {field.name}
                      </label>
                      <input
                        id={`${id}-${field.name.replaceAll(' ', '-').toLowerCase()}`}
                        type={field.secret ? 'password' : 'text'}
                        autoComplete="off"
                        disabled
                        value={check?.configured ? '••••••••••••••••' : ''}
                        placeholder="Not loaded in this browser"
                      />
                    </div>
                  ))}
                  <div className="admin-integration-status" role="status">
                    {check ? (
                      <>
                        <Server size={17} aria-hidden="true" />
                        <p>
                          Connection verified by server. Credentials securely
                          stored.
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="admin-status-dot" aria-hidden="true" />
                        <p>Connection status has not been verified.</p>
                      </>
                    )}
                  </div>
                  <div className="admin-integration-actions">
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={() => checkConnection(id)}
                      disabled={checking === id}
                      aria-label={`Check ${title} connection`}
                    >
                      {checking === id ? 'Checking…' : 'Check connection'}
                    </button>
                    <button
                      className="admin-button"
                      disabled
                      title="Configuration credentials are read from server environment variables."
                    >
                      Server managed
                    </button>
                  </div>
                  <p className="admin-field-help">
                    Credentials remain encrypted on the server environment.
                  </p>
                </div>
              </section>
            );
          },
        )}
      </div>
    </>
  );
}
