import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { api } from '../api/client';
import type { Service } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { Page } from '../components/Layout';
import { Skeleton } from '../components/Skeleton';
import { useFetch } from '../lib/useFetch';
import { ms, percent } from '../lib/format';
import styles from './Services.module.css';

export function ServicesPage() {
  const { data, error, initialLoading, refetch } = useFetch(() => api.services(), []);

  return (
    <Page title="Services">
      {error ? (
        <ErrorBanner message={error} onRetry={refetch} />
      ) : initialLoading ? (
        <div className={styles.skeletons}>
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No services yet"
          hint={
            <>
              <Link to="/providers/new">Add a provider</Link> to start routing models.
            </>
          }
        />
      ) : (
        <div className={styles.list}>
          {data.map((s) => (
            <ServiceCard key={s.model} service={s} />
          ))}
        </div>
      )}
    </Page>
  );
}

function ServiceCard({ service }: { service: Service }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`card ${styles.service}`}>
      <div className={styles.head} onClick={() => setExpanded(!expanded)}>
        <div className={styles.headLeft}>
          <span className={styles.modelName}>{service.model}</span>
          <span className="chip">
            {service.providers.length} provider{service.providers.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className={styles.headRight}>
          <div className={styles.stats}>
            <span>{service.stats.requests} req</span>
            {service.stats.requests > 0 && (
              <>
                <span>{percent(service.stats.errors / service.stats.requests)} err</span>
                <span>{ms(service.stats.avg_latency_ms)}</span>
              </>
            )}
          </div>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </div>
      {expanded && (
        <div className={styles.providers}>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Priority</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {service.providers.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.name}</td>
                  <td>{p.priority}</td>
                  <td>{p.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
