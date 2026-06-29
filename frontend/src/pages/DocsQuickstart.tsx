import { Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CopyButton } from '../components/CopyButton';
import { Page } from '../components/Layout';
import styles from './DocsQuickstart.module.css';

// Consumer-facing guide for calling the gateway. The data plane is a transparent
// passthrough at /v1 (OpenAI- and Anthropic-shaped wires); consumers authenticate
// with a Songguo user key sent as a bearer token (proxy reads Authorization).
export function DocsQuickstartPage() {
  const base = `${window.location.origin}/v1`;

  const pySdk = `from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key="<your-songguo-key>",
)

resp = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`;

  const curlOpenai = `curl ${base}/chat/completions \\
  -H "Authorization: Bearer <your-songguo-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

  const curlAnthropic = `curl ${base}/messages \\
  -H "Authorization: Bearer <your-songguo-key>" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

  return (
    <Page title="Quickstart">
      <div className={styles.sections}>
        <div className={`card ${styles.panel}`}>
          <div className={styles.panelTitle}>Point your SDK at the gateway</div>
          <div className={styles.panelDesc}>
            Songguo is a transparent proxy: keep using your existing OpenAI- or
            Anthropic-shaped SDK, just change two things — the base URL, and the
            API key.
          </div>

          <div className={styles.kv}>
            <span className={styles.kvKey}>Base URL</span>
            <div className={styles.endpoint}>
              <code className={styles.endpointUrl}>{base}</code>
              <CopyButton value={base} label="Copy" />
            </div>

            <span className={styles.kvKey}>API key</span>
            <span className={styles.kvVal}>
              A Songguo <strong>user key</strong>, sent as{' '}
              <code>Authorization: Bearer &lt;key&gt;</code>
            </span>
          </div>

          <div className={styles.hint}>
            <Info size={14} />
            Mint and manage user keys on the <Link to="/users">Users</Link> page.
            Songguo swaps in the real upstream credential — consumers never see it.
          </div>
        </div>

        <div className={`card ${styles.panel}`}>
          <div className={styles.panelTitle}>OpenAI SDK (Python)</div>
          <CodeBlock code={pySdk} />
        </div>

        <div className={`card ${styles.panel}`}>
          <div className={styles.panelTitle}>curl — OpenAI wire</div>
          <CodeBlock code={curlOpenai} />
          <div className={styles.panelTitle} style={{ marginTop: 18 }}>
            curl — Anthropic wire
          </div>
          <CodeBlock code={curlAnthropic} />
        </div>

        <div className={`card ${styles.panel}`}>
          <div className={styles.panelTitle}>Routing</div>
          <div className={styles.panelDesc}>
            The <code>model</code> string in your request selects which provider
            serves it — an exact match, with no aliasing or rewriting. Browse the
            models on offer on the <Link to="/services">Services</Link> page.
          </div>
          <div className={styles.kv}>
            <span className={styles.kvKey}>Pin a provider</span>
            <span className={styles.kvVal}>
              Send <code>X-Songguo-Provider: &lt;provider-id&gt;</code> to bypass
              model routing and target one provider directly.
            </span>
          </div>
        </div>

        <div className={`card ${styles.panel}`}>
          <div className={styles.panelTitle}>Limits</div>
          <div className={styles.panelDesc}>
            A user key can carry a per-minute rate limit and a spend budget, both
            set when you create or edit the key.
          </div>
          <div className={styles.kv}>
            <span className={styles.kvKey}>Rate limit</span>
            <span className={styles.kvVal}>
              Requests past the per-minute cap return <code>429 rate_limited</code>.
            </span>
            <span className={styles.kvKey}>Budget</span>
            <span className={styles.kvVal}>
              Once the USD budget is spent, requests return{' '}
              <code>402 budget_exceeded</code>.
            </span>
          </div>
        </div>

        <div className={styles.hint}>
          <Info size={14} />
          Managing the gateway instead of calling it? See the{' '}
          <Link to="/docs/api">API Reference</Link> and{' '}
          <Link to="/docs/mcp">MCP</Link> docs.
        </div>
      </div>
    </Page>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className={styles.codeBlock}>
      <CopyButton value={code} label="Copy" className={styles.codeCopy} />
      <pre className={styles.code}>{code}</pre>
    </div>
  );
}
