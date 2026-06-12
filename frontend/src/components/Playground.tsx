import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import {
  buildTestRequest,
  getTestKey,
  runTest,
  setTestKey,
  type TestResult,
} from '../lib/playground';
import { int, ms } from '../lib/format';
import styles from './Playground.module.css';

interface PlaygroundProps {
  model: string;
  /** Catalog kind, e.g. "chat" | "embedding". */
  kind: string;
  /** Union of wires enabled on the providers serving this model. */
  wires: string[];
}

/**
 * Interactive test UI for one service: sends a real request through the /v1
 * proxy with a consumer user key, so the test goes through routing and
 * metering like any SDK call and shows up in the call log.
 */
export function Playground({ model, kind, wires }: PlaygroundProps) {
  const isEmbedding = kind === 'embedding';
  const [key, setKey] = useState(getTestKey);
  const [prompt, setPrompt] = useState(
    isEmbedding ? 'The quick brown fox jumps over the lazy dog' : 'Hello! Reply in one short sentence.',
  );
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const request = buildTestRequest(model, kind, wires, prompt);
  const canSend = key.trim() !== '' && prompt.trim() !== '' && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setShowRaw(false);
    setTestKey(key.trim());
    const res = await runTest(key.trim(), request);
    setResult(res);
    setSending(false);
  };

  return (
    <div className={`card ${styles.section}`}>
      <div className={styles.head}>
        <h3 className={styles.title}>Test</h3>
        <code className={styles.endpoint}>POST {request.path}</code>
      </div>
      <p className={styles.hint}>
        Sends a real request through the gateway with a user key (created on the{' '}
        <Link to="/users">Users</Link> page), so it is routed and metered like any SDK call.
      </p>

      <div className={styles.keyRow}>
        <input
          className={`input ${styles.keyInput}`}
          type="password"
          placeholder="User key (sk-…)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
        />
      </div>

      <textarea
        className={styles.prompt}
        rows={3}
        placeholder={isEmbedding ? 'Text to embed' : 'Message to send'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />

      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={send} disabled={!canSend}>
          {sending ? <span className="spinner" /> : <Send size={14} />}
          {sending ? 'Sending…' : 'Send'}
        </button>
        {result && !sending && <ResultMeta result={result} />}
      </div>

      {result && !sending && (
        <div className={styles.result}>
          {result.ok ? (
            <pre className={styles.resultText}>{result.text || '(empty response)'}</pre>
          ) : (
            <pre className={`${styles.resultText} ${styles.resultError}`}>
              {result.errorMessage}
            </pre>
          )}
          {result.raw !== '' && (
            <>
              <button
                type="button"
                className={styles.rawToggle}
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? 'Hide raw response' : 'Show raw response'}
              </button>
              {showRaw && <pre className={styles.raw}>{result.raw}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultMeta({ result }: { result: TestResult }) {
  return (
    <span className={styles.meta}>
      <span className={`pill ${result.ok ? 'pill-ok' : 'pill-err'}`}>
        <span className="dot" />
        {result.status || 'network error'}
      </span>
      <span className={styles.metaItem}>{ms(result.latencyMs)}</span>
      {result.usage && (
        <span className={styles.metaItem}>
          {result.usage.input !== undefined && `${int(result.usage.input)} in`}
          {result.usage.input !== undefined && result.usage.output !== undefined && ' · '}
          {result.usage.output !== undefined && `${int(result.usage.output)} out`}
        </span>
      )}
    </span>
  );
}
