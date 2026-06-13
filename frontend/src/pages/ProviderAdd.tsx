import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Plus, Search, Wrench } from 'lucide-react';
import { api } from '../api/client';
import type { CatalogService, CatalogVendor } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Page } from '../components/Layout';
import { Skeleton } from '../components/Skeleton';
import { useFetch } from '../lib/useFetch';
import { BrandIcon, providerBrand } from '../lib/modelBrand';
import styles from './ProviderAdd.module.css';

// Friendly labels for wire IDs ("openai/chat" → "Chat Completions").
const WIRE_NAMES: Record<string, string> = {
  'openai/chat': 'Chat Completions',
  'openai/completions': 'Completions',
  'openai/responses': 'Responses',
  'openai/embeddings': 'Embeddings',
  'openai/models': 'Models',
  'anthropic/messages': 'Messages',
  'anthropic/models': 'Models',
  'volc/tts': 'TTS',
};

const wireName = (wire: string) => WIRE_NAMES[wire] ?? wire;

interface VendorSection {
  vendor: CatalogVendor;
  services: CatalogService[];
}

export function ProviderAddPage() {
  const catalog = useFetch(() => api.catalog(), []);
  // Only used to mark presets that are already configured.
  const providers = useFetch(() => api.providers(), []);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const addedCatalogIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of providers.data ?? []) if (s.catalog_id) set.add(s.catalog_id);
    return set;
  }, [providers.data]);

  const sections = useMemo<VendorSection[]>(() => {
    const q = query.trim().toLowerCase();
    const out: VendorSection[] = [];
    for (const vendor of catalog.data?.vendors ?? []) {
      const services = vendor.services.filter((service) => {
        if (!q) return true;
        if (vendor.name.toLowerCase().includes(q)) return true;
        if (service.name.toLowerCase().includes(q)) return true;
        if (service.kind.toLowerCase().includes(q)) return true;
        if ((service.wires ?? []).some((w) => wireName(w).toLowerCase().includes(q))) return true;
        return service.models.some((m) => m.model.toLowerCase().includes(q));
      });
      if (services.length > 0) out.push({ vendor, services });
    }
    return out;
  }, [catalog.data, query]);

  const openAdd = (service: CatalogService) => {
    navigate(`/providers/new?preset=${encodeURIComponent(service.id)}`);
  };

  return (
    <Page
      title="Add provider"
      actions={
        <Link to="/providers" className="btn">
          <ArrowLeft size={15} /> Back to providers
        </Link>
      }
    >
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
          <div className={styles.searchBox}>
            <Search size={15} />
            <input
              className={styles.searchInput}
              value={query}
              placeholder="Search presets, models, providers…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {sections.length === 0 && query.trim() !== '' ? (
            <EmptyState icon={Search} title="No matches" hint="Try a different search." />
          ) : (
            sections.map(({ vendor, services }) => (
              <section key={vendor.id} className={styles.vendorSection}>
                <h2 className={styles.vendorHead}>
                  <BrandIcon
                    brand={providerBrand(
                      vendor.name,
                      services.flatMap((s) => s.models.map((m) => m.model)),
                    )}
                    label={vendor.name}
                    size={20}
                  />
                  {vendor.name}
                </h2>
                <div className={styles.grid}>
                  {services.map((service) => (
                    <PresetCard
                      key={service.id}
                      service={service}
                      added={addedCatalogIds.has(service.id)}
                      onAdd={() => openAdd(service)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          <section className={styles.vendorSection}>
            <div className={styles.grid}>
              <button
                className={`card ${styles.entry} ${styles.custom}`}
                onClick={() => navigate('/providers/new')}
              >
                <div className={styles.customIcon}>
                  <Wrench size={18} />
                </div>
                <span className={styles.serviceName}>Custom provider</span>
                <span className={styles.note}>
                  Any OpenAI- or Anthropic-compatible endpoint: set the base URL, key, wires, and
                  per-model prices yourself.
                </span>
              </button>
            </div>
          </section>
        </>
      )}
    </Page>
  );
}

interface PresetCardProps {
  service: CatalogService;
  added: boolean;
  onAdd: () => void;
}

function PresetCard({ service, added, onAdd }: PresetCardProps) {
  const shown = service.models.slice(0, 4);
  return (
    <div className={`card ${styles.entry}`}>
      <div className={styles.entryHead}>
        <span className={styles.serviceName}>{service.name}</span>
        {added && (
          <span className={styles.addedChip}>
            <Check size={12} /> Added
          </span>
        )}
      </div>

      <div className={styles.tags}>
        <span className="chip">{service.adapter}</span>
        {(service.wires ?? []).map((w) => (
          <span key={w} className="chip">
            {wireName(w)}
          </span>
        ))}
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
