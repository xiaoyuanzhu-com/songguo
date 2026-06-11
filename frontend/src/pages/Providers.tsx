import { useState } from 'react';
import { CheckCircle2, KeyRound, Pencil, Plus, Server, Trash2, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Provider, VendorTestResult } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Page } from '../components/Layout';
import { Modal } from '../components/Modal';
import { ProviderForm } from '../components/ProviderForm';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useFetch } from '../lib/useFetch';
import { ms, percent } from '../lib/format';
import styles from './Providers.module.css';

type ModalState =
  | { kind: 'none' }
  | { kind: 'edit'; provider: Provider }
  | { kind: 'delete'; provider: Provider };

export function ProvidersPage() {
  const { data, error, initialLoading, refetch } = useFetch(() => api.providers(), []);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const toast = useToast();

  const close = () => setModal({ kind: 'none' });

  const onDelete = async (provider: Provider) => {
    try {
      await api.deleteProvider(provider.id);
      refetch();
      close();
      toast.success(`Removed "${provider.name}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  return (
    <Page
      title="Providers"
      actions={
        <Link to="/providers/new" className="btn btn-primary">
          <Plus size={15} /> Add provider
        </Link>
      }
    >
      {error ? (
        <ErrorBanner message={error} onRetry={refetch} />
      ) : initialLoading ? (
        <div className={styles.list}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={`card ${styles.provider}`} style={{ padding: 16 }}>
              <Skeleton height={20} width={180} />
              <Skeleton height={14} width="60%" style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No providers yet"
          hint={
            <>
              <Link to="/providers/new">Add a provider</Link> — pick a known provider preset or
              configure a custom endpoint.
            </>
          }
        />
      ) : (
        <div className={styles.list}>
          {data.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              onChanged={refetch}
              onEdit={() => setModal({ kind: 'edit', provider: p })}
              onDelete={() => setModal({ kind: 'delete', provider: p })}
            />
          ))}
        </div>
      )}

      {modal.kind === 'edit' && (
        <ProviderForm
          editing={modal.provider}
          onClose={close}
          onSaved={() => {
            refetch();
            close();
            toast.success('Provider updated.');
          }}
        />
      )}

      {modal.kind === 'delete' && (
        <Modal
          title="Remove provider"
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => onDelete(modal.provider)}>
                Remove provider
              </button>
            </>
          }
        >
          <p className={styles.confirmText}>
            Remove <strong>{modal.provider.name}</strong>? Its key and prices are deleted and it
            will stop routing immediately. This cannot be undone.
          </p>
        </Modal>
      )}
    </Page>
  );
}

interface ProviderCardProps {
  provider: Provider;
  onChanged: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ProviderCard({ provider, onChanged, onEdit, onDelete }: ProviderCardProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<VendorTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const { stats } = provider;
  const complete = provider.masked_key !== '' && provider.models.length > 0;

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testProvider(provider.id));
    } catch (e) {
      setResult({
        reachable: false,
        status: 0,
        latency_ms: 0,
        error: e instanceof Error ? e.message : 'Test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const toggleEnabled = async () => {
    setBusy(true);
    try {
      await api.patchProvider(provider.id, { enabled: !provider.enabled });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card ${styles.provider} ${provider.enabled ? '' : styles.disabled}`}>
      <div className={styles.head}>
        <div className={styles.headLeft}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{provider.name}</span>
            <span className="chip">{provider.adapter}</span>
            {provider.vendor && <span className={styles.vendorTag}>{provider.vendor}</span>}
            {!provider.enabled ? (
              <span className={`${styles.badge} ${styles.off}`}>Disabled</span>
            ) : !complete ? (
              <span className={`${styles.badge} ${styles.draft}`}>Draft</span>
            ) : (
              <span className={`${styles.badge} ${stats.healthy ? styles.healthy : styles.unhealthy}`}>
                {stats.healthy ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {stats.healthy ? 'Healthy' : 'Unhealthy'}
              </span>
            )}
          </div>
          <div className={styles.baseUrl}>{provider.base_url}</div>
        </div>
        <div className={styles.headRight}>
          <button className="btn btn-sm" onClick={runTest} disabled={testing}>
            {testing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null}
            {testing ? 'Testing…' : 'Test'}
          </button>
          <button className="btn btn-sm" onClick={toggleEnabled} disabled={busy}>
            {provider.enabled ? 'Disable' : 'Enable'}
          </button>
          <button className="btn btn-sm" onClick={onEdit}>
            <Pencil size={12} /> Edit
          </button>
          <button className="btn btn-sm btn-danger" onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {result && (
        <div
          className={`${styles.testResult} ${result.reachable ? styles.testOk : styles.testErr}`}
        >
          {result.reachable
            ? `reachable · ${result.status} · ${ms(result.latency_ms)}`
            : result.error || `unreachable · ${result.status}`}
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.section}>
          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Priority</span>
              <span className={styles.metaValue}>{provider.priority}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Weight</span>
              <span className={styles.metaValue}>{provider.weight}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Requests</span>
              <span className={styles.metaValue}>{stats.requests}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Error rate</span>
              <span className={styles.metaValue}>{percent(stats.error_rate)}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Avg latency</span>
              <span className={styles.metaValue}>{ms(stats.avg_latency_ms)}</span>
            </div>
          </div>

          <span className={styles.sectionTitle}>Wires</span>
          <div className={styles.creds} style={{ marginBottom: 10 }}>
            {provider.wires.length === 0 ? (
              <span className="muted" style={{ fontSize: 12 }}>
                No wires enabled — all paths are denied.
              </span>
            ) : (
              provider.wires.map((w) => (
                <span key={w} className="chip chip-mono" style={{ fontSize: 11 }}>
                  {w}
                </span>
              ))
            )}
            {provider.allow_unmatched && (
              <span
                className="chip"
                style={{ fontSize: 11, color: 'var(--danger, #b54)', fontWeight: 600 }}
                title="Unmatched paths are forwarded but metered zero"
              >
                allow unmatched
              </span>
            )}
          </div>

          <span className={styles.sectionTitle}>API key</span>
          <div className={styles.creds}>
            {provider.masked_key === '' ? (
              <span className="muted" style={{ fontSize: 12 }}>
                No key — edit the provider and paste one to start routing.
              </span>
            ) : (
              <span className={styles.cred}>
                <KeyRound size={12} />
                {provider.masked_key}
              </span>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionTitle}>Models &amp; prices</span>
          {provider.models.length === 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>
              No models configured.
            </span>
          ) : (
            <table className={styles.priceTable}>
              <thead>
                <tr>
                  <th>Model</th>
                  <th style={{ textAlign: 'right' }}>Input</th>
                  <th style={{ textAlign: 'right' }}>Output</th>
                  <th style={{ textAlign: 'right' }}>Cached</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {provider.models.map((m) => (
                  <tr key={m.model}>
                    <td className="mono">{m.model}</td>
                    <td className="n">{m.input}</td>
                    <td className="n">{m.output}</td>
                    <td className="n">{m.cached_input || '—'}</td>
                    <td className="mono">{m.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
