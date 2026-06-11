import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Plus, Search, Wrench } from 'lucide-react';
import { api } from '../api/client';
import type { CatalogService, CatalogVendor } from '../api/types';
import { ErrorBanner } from '../components/ErrorBanner';
import { EmptyState } from '../components/EmptyState';
import { Page } from '../components/Layout';
import { ProviderForm, type ProviderPrefill } from '../components/ProviderForm';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { useFetch } from '../lib/useFetch';
import styles from './ProviderNew.module.css';

interface FlatEntry {
  vendor: CatalogVendor;
  service: CatalogService;
}

/** Marker for "open the form without a preset". */
const CUSTOM: ProviderPrefill = {};

export function ProviderNewPage() {
  const catalog = useFetch(() => api.catalog(), []);
  const providers = useFetch(() => api.providers(), []);
  const [query, setQuery] = useState('');
  const [vendorFilter, setVendorFilter] = useState<string>('all');
  const [prefill, setPrefill] = useState<ProviderPrefill | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const addedCatalogIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of providers.data ?? []) if (s.catalog_id) set.add(s.catalog_id);
    return set;
  }, [providers.data]);

  const entries = useMemo<FlatEntry[]>(() => {
    const out: FlatEntry[] = [];
    for (const v of catalog.data?.vendors ?? []) {
      for (const s of v.services) out.push({ vendor: v, service: s });
    }
    return out;
  }, [catalog.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(({ vendor, service }) => {
      if (vendorFilter !== 'all' && vendor.id !== vendorFilter) return false;
      if (!q) return true;
      if (vendor.name.toLowerCase().includes(q)) return true;
      if (service.name.toLowerCase().includes(q)) return true;
      if (service.kind.toLowerCase().includes(q)) return true;
      return service.models.some((m) => m.model.toLowerCase().includes(q));
    });
  }, [entries, query, vendorFilter]);

  const openAdd = (vendor: CatalogVendor, service: CatalogService) => {
    setPrefill({
      name: service.id,
      vendor: vendor.name,
      adapter: service.adapter,
      base_url: service.base_url,
      catalog_id: service.id,
      wires: service.wires,
      quirks: service.quirks,
      models: service.models.map((m) => ({
        model: m.model,
        input: m.input,
        output: m.output,
        cached_input: m.cached_input ?? 0,
        unit: m.unit,
      })),
    });
  };

  return (
    <Page
      title="New provider"
      actions={
        <Link to="/providers" className="btn">
          <ArrowLeft size={15} /> Back to providers
        </Link>
      }
    >
      <div className={styles.intro}>
        Pick a preset — endpoint, wires, models, and prices come pre-filled, you just paste your
        API key — or configure a custom provider from scratch.
      </div>

      {catalog.error ? (
        <ErrorBanner message={catalog.error} onRetry={catalog.refetch} />
      ) : catalog.initialLoading ? (
        <div className={styles.grid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`card ${styles.entry}`} style={{ padding: 16 }}>
              <Skeleton height={18} width={160} />
              <Skeleton height={13} width="70%" style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className={styles.controls}>
            <div className={styles.searchBox}>
              <Search size={15} />
              <input
                className={styles.searchInput}
                value={query}
                placeholder="Search presets, models, providers…"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className={styles.facets}>
              <button
                className={`${styles.facet} ${vendorFilter === 'all' ? styles.facetActive : ''}`}
                onClick={() => setVendorFilter('all')}
              >
                All
              </button>
              {(catalog.data?.vendors ?? []).map((v) => (
                <button
                  key={v.id}
                  className={`${styles.facet} ${vendorFilter === v.id ? styles.facetActive : ''}`}
                  onClick={() => setVendorFilter(v.id)}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 && query.trim() !== '' ? (
            <EmptyState icon={Search} title="No matches" hint="Try a different search or facet." />
          ) : (
            <div className={styles.grid}>
              <button className={`card ${styles.entry} ${styles.custom}`} onClick={() => setPrefill(CUSTOM)}>
                <div className={styles.customIcon}>
                  <Wrench size={18} />
                </div>
                <span className={styles.serviceName}>Custom provider</span>
                <span className={styles.note}>
                  Any OpenAI- or Anthropic-compatible endpoint: set the base URL, key, wires, and
                  per-model prices yourself.
                </span>
              </button>
              {filtered.map(({ vendor, service }) => (
                <PresetCard
                  key={`${vendor.id}/${service.id}`}
                  vendor={vendor}
                  service={service}
                  added={addedCatalogIds.has(service.id)}
                  onAdd={() => openAdd(vendor, service)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {prefill && (
        <ProviderForm
          prefill={prefill}
          onClose={() => setPrefill(null)}
          onSaved={() => {
            setPrefill(null);
            toast.success('Provider added.');
            navigate('/providers');
          }}
        />
      )}
    </Page>
  );
}

interface PresetCardProps {
  vendor: CatalogVendor;
  service: CatalogService;
  added: boolean;
  onAdd: () => void;
}

function PresetCard({ vendor, service, added, onAdd }: PresetCardProps) {
  const shown = service.models.slice(0, 4);
  return (
    <div className={`card ${styles.entry}`}>
      <div className={styles.entryHead}>
        <div className={styles.entryTitle}>
          <span className={styles.vendorName}>{vendor.name}</span>
          <span className={styles.serviceName}>{service.name}</span>
        </div>
        {added && (
          <span className={styles.addedChip}>
            <Check size={12} /> Added
          </span>
        )}
      </div>

      <div className={styles.tags}>
        <span className="chip">{service.kind}</span>
        <span className="chip">{service.adapter}</span>
      </div>

      <div className={styles.baseUrl}>{service.base_url}</div>
      {service.note && <div className={styles.note}>{service.note}</div>}

      <div className={styles.models}>
        {shown.map((m) => (
          <span key={m.model} className="chip chip-mono">
            {m.model}
          </span>
        ))}
        {service.models.length > shown.length && (
          <span className="chip">+{service.models.length - shown.length}</span>
        )}
      </div>

      <div className={styles.entryFoot}>
        {service.docs ? (
          <a className={styles.docs} href={service.docs} target="_blank" rel="noreferrer">
            Docs
          </a>
        ) : (
          <span />
        )}
        <button className="btn btn-sm btn-primary" onClick={onAdd}>
          <Plus size={13} /> Add provider
        </button>
      </div>
    </div>
  );
}
