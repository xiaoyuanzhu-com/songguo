import { useState } from 'react';
import { CheckCircle2, KeyRound, Pencil, Plus, Server, Trash2, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Service, VendorTestResult } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Page } from '../components/Layout';
import { Modal } from '../components/Modal';
import { ServiceForm } from '../components/ServiceForm';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useFetch } from '../lib/useFetch';
import { ms, percent } from '../lib/format';
import styles from './Services.module.css';

type ModalState =
  | { kind: 'none' }
  | { kind: 'edit'; service: Service }
  | { kind: 'delete'; service: Service };

export function ServicesPage() {
  const { data, error, initialLoading, refetch } = useFetch(() => api.services(), []);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const toast = useToast();

  const close = () => setModal({ kind: 'none' });

  const onDelete = async (service: Service) => {
    try {
      await api.deleteService(service.id);
      refetch();
      close();
      toast.success(`Removed “${service.name}”.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  return (
    <Page
      title="Services"
      actions={
        <Link to="/services/new" className="btn btn-primary">
          <Plus size={15} /> Add service
        </Link>
      }
    >
      {error ? (
        <ErrorBanner message={error} onRetry={refetch} />
      ) : initialLoading ? (
        <div className={styles.list}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className={`card ${styles.service}`} style={{ padding: 16 }}>
              <Skeleton height={20} width={180} />
              <Skeleton height={14} width="60%" style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No services yet"
          hint={
            <>
              <Link to="/services/new">Add a service</Link> — pick a known provider preset or
              configure a custom endpoint.
            </>
          }
        />
      ) : (
        <div className={styles.list}>
          {data.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              onChanged={refetch}
              onEdit={() => setModal({ kind: 'edit', service: s })}
              onDelete={() => setModal({ kind: 'delete', service: s })}
            />
          ))}
        </div>
      )}

      {modal.kind === 'edit' && (
        <ServiceForm
          editing={modal.service}
          onClose={close}
          onSaved={() => {
            refetch();
            close();
            toast.success('Service updated.');
          }}
        />
      )}

      {modal.kind === 'delete' && (
        <Modal
          title="Remove service"
          onClose={close}
          footer={
            <>
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => onDelete(modal.service)}>
                Remove service
              </button>
            </>
          }
        >
          <p className={styles.confirmText}>
            Remove <strong>{modal.service.name}</strong>? Its key and prices are deleted and it
            will stop routing immediately. This cannot be undone.
          </p>
        </Modal>
      )}
    </Page>
  );
}

interface ServiceCardProps {
  service: Service;
  onChanged: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ServiceCard({ service, onChanged, onEdit, onDelete }: ServiceCardProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<VendorTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const { stats } = service;
  const complete = service.masked_key !== '' && service.models.length > 0;

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testService(service.id));
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
      await api.patchService(service.id, { enabled: !service.enabled });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card ${styles.service} ${service.enabled ? '' : styles.disabled}`}>
      <div className={styles.head}>
        <div className={styles.headLeft}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{service.name}</span>
            <span className="chip">{service.adapter}</span>
            {service.vendor && <span className={styles.vendorTag}>{service.vendor}</span>}
            {!service.enabled ? (
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
          <div className={styles.baseUrl}>{service.base_url}</div>
        </div>
        <div className={styles.headRight}>
          <button className="btn btn-sm" onClick={runTest} disabled={testing}>
            {testing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null}
            {testing ? 'Testing…' : 'Test'}
          </button>
          <button className="btn btn-sm" onClick={toggleEnabled} disabled={busy}>
            {service.enabled ? 'Disable' : 'Enable'}
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
              <span className={styles.metaValue}>{service.priority}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Weight</span>
              <span className={styles.metaValue}>{service.weight}</span>
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
            {service.wires.length === 0 ? (
              <span className="muted" style={{ fontSize: 12 }}>
                No wires enabled — all paths are denied.
              </span>
            ) : (
              service.wires.map((w) => (
                <span key={w} className="chip chip-mono" style={{ fontSize: 11 }}>
                  {w}
                </span>
              ))
            )}
            {service.allow_unmatched && (
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
            {service.masked_key === '' ? (
              <span className="muted" style={{ fontSize: 12 }}>
                No key — edit the service and paste one to start routing.
              </span>
            ) : (
              <span className={styles.cred}>
                <KeyRound size={12} />
                {service.masked_key}
              </span>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <span className={styles.sectionTitle}>Models &amp; prices</span>
          {service.models.length === 0 ? (
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
                {service.models.map((m) => (
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
