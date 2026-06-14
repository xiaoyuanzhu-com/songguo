import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import type { Provider } from '../api/types';
import {
  buildTestRequest,
  getTestKey,
  runAsr,
  runTest,
  setTestKey,
  wireTests,
  type AsrResult,
  type TestResult,
  type WireTest,
} from '../lib/playground';
import { int, ms } from '../lib/format';
import { CopyButton } from './CopyButton';
import styles from './Playground.module.css';

interface PlaygroundProps {
  model: string;
  /** Union of wires enabled on the providers serving this model. */
  wires: string[];
  /** Provider objects serving this model (for /x media wire mounts). */
  providers: Provider[];
}

/**
 * Interactive test UI for one service. The panel is wire-aware: each
 * model-serving wire gets a test profile, and the active wire decides which
 * panel renders (chat, embeddings, ASR, …) — not every wire is OpenAI chat.
 * Requests go through the real proxy with a consumer user key, so a test is
 * routed and metered like any SDK call and shows up in the call log.
 */
export function Playground({ model, wires, providers }: PlaygroundProps) {
  const tests = useMemo(() => wireTests(wires), [wires]);
  const [key, setKey] = useState(getTestKey);
  const [active, setActive] = useState(0);

  if (tests.length === 0) {
    return (
      <div className={`card ${styles.section}`}>
        <div className={styles.head}>
          <h3 className={styles.title}>Test</h3>
        </div>
        <p className={styles.hint}>
          This service exposes no model-serving wire to test interactively.
        </p>
      </div>
    );
  }

  const test = tests[Math.min(active, tests.length - 1)];

  return (
    <div className={`card ${styles.section}`}>
      <div className={styles.head}>
        <h3 className={styles.title}>Test</h3>
        {test.endpoint && <code className={styles.endpoint}>{test.endpoint}</code>}
      </div>

      {tests.length > 1 && (
        <div className={styles.wirePicker} role="tablist" aria-label="Wire to test">
          {tests.map((t, i) => (
            <button
              key={t.wire}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`${styles.wireTab} ${i === active ? styles.wireTabActive : ''}`}
              onClick={() => setActive(i)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <KeyInput value={key} onChange={setKey} />

      <Panel test={test} model={model} apiKey={key} providers={providers} />
    </div>
  );
}

function KeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <p className={styles.hint}>
        Sends a real request through the gateway with a user key (created on the{' '}
        <Link to="/users">Users</Link> page), so it is routed and metered like any SDK call.
      </p>
      <div className={styles.keyRow}>
        <input
          className={`input ${styles.keyInput}`}
          type="password"
          placeholder="User key (sk-…)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      </div>
    </>
  );
}

/** Dispatch to the panel for the active wire's kind. */
function Panel({
  test,
  model,
  apiKey,
  providers,
}: {
  test: WireTest;
  model: string;
  apiKey: string;
  providers: Provider[];
}) {
  switch (test.kind) {
    case 'chat':
    case 'embedding':
      return <PromptPanel test={test} model={model} apiKey={apiKey} />;
    case 'asr':
      return <AsrPanel model={model} apiKey={apiKey} providers={providers} />;
    default:
      return <UnsupportedPanel test={test} model={model} />;
  }
}

// --- Chat / embedding panel ------------------------------------------------

function PromptPanel({ test, model, apiKey }: { test: WireTest; model: string; apiKey: string }) {
  const isEmbedding = test.kind === 'embedding';
  const [prompt, setPrompt] = useState(
    isEmbedding
      ? 'The quick brown fox jumps over the lazy dog'
      : 'Hello! Reply in one short sentence.',
  );
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const canSend = apiKey.trim() !== '' && prompt.trim() !== '' && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setShowRaw(false);
    setTestKey(apiKey.trim());
    const req = buildTestRequest(model, test.wire, prompt);
    const res = await runTest(apiKey.trim(), req);
    setResult(res);
    setSending(false);
  };

  return (
    <>
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
            <pre className={`${styles.resultText} ${styles.resultError}`}>{result.errorMessage}</pre>
          )}
          <RawToggle raw={result.raw} show={showRaw} onToggle={() => setShowRaw((v) => !v)} />
        </div>
      )}
    </>
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

// --- ASR panel (Volcengine bigmodel file recognition) ----------------------

const ASR_FORMATS = ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'pcm'];

function AsrPanel({
  model,
  apiKey,
  providers,
}: {
  model: string;
  apiKey: string;
  providers: Provider[];
}) {
  // Only providers that actually expose the ASR wire can serve this test.
  const asrProviders = useMemo(
    () => providers.filter((p) => p.endpoints.some((e) => e.wire === 'volc/asr')),
    [providers],
  );
  const [providerName, setProviderName] = useState(asrProviders[0]?.name ?? '');
  const [audioUrl, setAudioUrl] = useState('');
  const [format, setFormat] = useState('wav');
  const [resourceId, setResourceId] = useState('volc.seedasr.auc');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AsrResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const provider = providerName || asrProviders[0]?.name || '';
  const canSend =
    apiKey.trim() !== '' && audioUrl.trim() !== '' && provider !== '' && !running;

  const send = async () => {
    if (!canSend) return;
    setRunning(true);
    setShowRaw(false);
    setTestKey(apiKey.trim());
    const res = await runAsr({
      key: apiKey.trim(),
      providerName: provider,
      resourceId: resourceId.trim() || 'volc.seedasr.auc',
      audioUrl: audioUrl.trim(),
      format,
    });
    setResult(res);
    setRunning(false);
  };

  if (asrProviders.length === 0) {
    return (
      <p className={styles.hint}>
        No provider serving <code>{model}</code> has the <code>volc/asr</code> wire enabled. Add an
        endpoint with wire <code>volc/asr</code> and URL{' '}
        <code>https://openspeech.bytedance.com</code> on the{' '}
        <Link to="/providers">provider</Link> to test file recognition.
      </p>
    );
  }

  return (
    <>
      <p className={styles.hint}>
        Transcribe a recording with ByteDance bigmodel file recognition. The audio must be at a
        publicly fetchable URL — the API pulls it by URL, then this polls until the transcript is
        ready.
      </p>

      <div className={styles.fieldGrid}>
        {asrProviders.length > 1 && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Provider</span>
            <select
              className="select"
              value={provider}
              onChange={(e) => setProviderName(e.target.value)}
            >
              {asrProviders.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Format</span>
          <select className="select" value={format} onChange={(e) => setFormat(e.target.value)}>
            {ASR_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Resource id</span>
          <input
            className="input mono"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            placeholder="volc.seedasr.auc"
          />
        </label>
      </div>

      <input
        className={`input mono ${styles.urlInput}`}
        value={audioUrl}
        placeholder="https://…/recording.wav"
        onChange={(e) => setAudioUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />

      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={send} disabled={!canSend}>
          {running ? <span className="spinner" /> : <Send size={14} />}
          {running ? 'Transcribing…' : 'Transcribe'}
        </button>
        {result && !running && <AsrMeta result={result} />}
      </div>

      {result && !running && (
        <div className={styles.result}>
          {result.ok ? (
            <>
              <pre className={styles.resultText}>{result.text || '(empty transcript)'}</pre>
              {result.utterances && result.utterances.length > 0 && (
                <Utterances utterances={result.utterances} />
              )}
            </>
          ) : (
            <pre className={`${styles.resultText} ${styles.resultError}`}>{result.errorMessage}</pre>
          )}
          <RawToggle raw={result.raw} show={showRaw} onToggle={() => setShowRaw((v) => !v)} />
        </div>
      )}
    </>
  );
}

function AsrMeta({ result }: { result: AsrResult }) {
  return (
    <span className={styles.meta}>
      <span className={`pill ${result.ok ? 'pill-ok' : 'pill-err'}`}>
        <span className="dot" />
        {result.apiStatus || result.status || 'network error'}
      </span>
      <span className={styles.metaItem}>{ms(result.latencyMs)}</span>
      {result.durationMs !== undefined && (
        <span className={styles.metaItem}>{(result.durationMs / 1000).toFixed(1)}s audio</span>
      )}
    </span>
  );
}

function Utterances({ utterances }: { utterances: AsrResult['utterances'] }) {
  if (!utterances) return null;
  return (
    <div className={styles.utterances}>
      {utterances.map((u, i) => (
        <div key={i} className={styles.utterance}>
          {(u.start_time !== undefined || u.speaker) && (
            <span className={styles.utteranceMeta}>
              {u.speaker ? `${u.speaker} ` : ''}
              {u.start_time !== undefined ? `${(u.start_time / 1000).toFixed(1)}s` : ''}
            </span>
          )}
          <span>{u.text}</span>
        </div>
      ))}
    </div>
  );
}

// --- Fallback panel for wires without an interactive test ------------------

function UnsupportedPanel({ test, model }: { test: WireTest; model: string }) {
  const snippet = curlFor(test.wire, model);
  return (
    <div className={styles.unsupported}>
      <p className={styles.hint}>
        Interactive testing for the <strong>{test.label}</strong> wire (<code>{test.wire}</code>)
        isn’t available in the dashboard yet. Call it directly through the gateway:
      </p>
      {snippet && (
        <div className={styles.snippetBlock}>
          <div className={styles.snippetHead}>
            <CopyButton value={snippet} label="Copy" />
          </div>
          <pre className={styles.raw}>{snippet}</pre>
        </div>
      )}
    </div>
  );
}

function curlFor(wire: string, model: string): string {
  const origin = window.location.origin;
  if (wire === 'volc/tts') {
    return `curl ${origin}/x/<provider>/api/v3/tts/unidirectional \\
  -H "Authorization: Bearer $SONGGUO_TOKEN" \\
  -H "X-Api-Resource-Id: volc.service_type.10029" \\
  -H "Content-Type: application/json" \\
  -d '{ "req_params": { "text": "你好，世界" } }'`;
  }
  return `curl ${origin}/x/<provider>/<vendor-path> \\
  -H "Authorization: Bearer $SONGGUO_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "model": "${model}", "…": "…" }'`;
}

// --- shared ----------------------------------------------------------------

function RawToggle({ raw, show, onToggle }: { raw: string; show: boolean; onToggle: () => void }) {
  if (raw === '') return null;
  return (
    <>
      <button type="button" className={styles.rawToggle} onClick={onToggle}>
        {show ? 'Hide raw response' : 'Show raw response'}
      </button>
      {show && <pre className={styles.raw}>{raw}</pre>}
    </>
  );
}
