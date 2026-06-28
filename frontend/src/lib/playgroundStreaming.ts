// Browser transports for the WebSocket streaming speech wires. Each opens a real
// WS through the gateway (auth + provider pin smuggled as subprotocol tokens, see
// volcWsProtocol.wsAuthProtocols), speaks Volcengine's binary frame protocol, and
// summarizes the outcome — so a streaming test is routed and metered like SDK
// traffic, just over WS instead of HTTP.
//
// Two audio sources share one session core: an uploaded file (sent in paced
// chunks) and the live microphone (16 kHz mono PCM, streamed frame-by-frame as
// it's captured, for real-time transcription).

import {
  decodeFrame,
  encodeAudioOnlyRequest,
  encodeFullClientRequest,
  isFinalFrame,
  MessageType,
  wsAuthProtocols,
  wsUrl,
  type Frame,
} from './volcWsProtocol';
import type { AsrUtterance } from './playground';

const WS_TIMEOUT_MS = 60_000;
const MIC_RATE = 16000;

// Fixed session defaults — surfaced in the code samples, not the test UI.
const DEFAULT_ASR_RESOURCE = 'volc.seedasr.sauc.duration';
const DEFAULT_ASR_MODEL = 'bigmodel';

export interface AsrStreamResult {
  ok: boolean;
  text: string;
  utterances?: AsrUtterance[];
  errorMessage?: string;
  /** Pretty-printed server JSON frames, for the raw view. */
  raw: string;
  latencyMs: number;
  /** Audio bytes streamed up. */
  bytesUp: number;
}

interface SessionOpts {
  key: string;
  providerId: string;
  /** Gateway WS path, e.g. "/api/v3/sauc/bigmodel_async". */
  path: string;
  /** Audio container declared in the config, e.g. "wav" | "pcm". */
  format: string;
  rate: number;
  onPartial?: (text: string) => void;
}

/** A live streaming session: feed audio, then end(); await done for the result. */
interface AsrSession {
  pushAudio(bytes: Uint8Array): void;
  end(): void;
  done: Promise<AsrStreamResult>;
}

/**
 * Open a streaming-ASR WebSocket session. Sends the JSON config on connect, then
 * drains pushed audio frames in order (one frame per push), flagging the final
 * frame once end() is called and the queue drains. Resolves done with the
 * collected transcript when the server signals completion, errors, or closes.
 */
function openAsrSession(o: SessionOpts): AsrSession {
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  const config = {
    user: { uid: 'songguo-playground' },
    audio: { format: o.format, rate: o.rate, bits: 16, channel: 1 },
    request: {
      model_name: DEFAULT_ASR_MODEL,
      enable_punc: true,
      enable_itn: true,
      show_utterances: true,
    },
  };

  const queue: Uint8Array[] = [];
  let ended = false;
  let settled = false;
  let bytesUp = 0;
  const frames: unknown[] = [];
  let lastText = '';
  let utterances: AsrUtterance[] | undefined;

  let resolveDone!: (r: AsrStreamResult) => void;
  const done = new Promise<AsrStreamResult>((res) => (resolveDone = res));

  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(o.path), wsAuthProtocols(o.key, o.providerId, DEFAULT_ASR_RESOURCE));
  } catch (e) {
    resolveDone(errResult(elapsed(), e instanceof Error ? e.message : 'Failed to open WebSocket'));
    return { pushAudio: () => {}, end: () => {}, done };
  }
  ws.binaryType = 'arraybuffer';

  const finish = (r: { ok: boolean; errorMessage?: string }) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      ws.close();
    } catch {
      /* already closing */
    }
    resolveDone({
      ok: r.ok,
      text: lastText,
      utterances,
      errorMessage: r.errorMessage,
      raw: frames.length ? JSON.stringify(frames, null, 2) : '',
      latencyMs: elapsed(),
      bytesUp,
    });
  };

  const timer = setTimeout(
    () => finish({ ok: false, errorMessage: 'Timed out waiting for the transcript (60s).' }),
    WS_TIMEOUT_MS,
  );

  // Serial pump: config first, then one frame per queued chunk, last flag when
  // the producer has ended and the queue is empty.
  const pump = async () => {
    try {
      ws.send(await encodeFullClientRequest(config));
      while (!settled) {
        if (queue.length === 0) {
          if (ended) {
            ws.send(await encodeAudioOnlyRequest(new Uint8Array(0), true));
            return;
          }
          await sleep(20);
          continue;
        }
        const chunk = queue.shift()!;
        bytesUp += chunk.length;
        const last = ended && queue.length === 0;
        ws.send(await encodeAudioOnlyRequest(chunk, last));
        if (last) return;
      }
    } catch (e) {
      finish({ ok: false, errorMessage: e instanceof Error ? e.message : 'Failed to send audio' });
    }
  };

  ws.onopen = () => {
    void pump();
  };

  ws.onmessage = async (ev) => {
    let frame: Frame;
    try {
      frame = await decodeFrame(new Uint8Array(ev.data as ArrayBuffer));
    } catch (e) {
      finish({ ok: false, errorMessage: e instanceof Error ? e.message : 'Failed to decode frame' });
      return;
    }
    if (frame.json !== undefined) frames.push(frame.json);

    if (frame.messageType === MessageType.ErrorResponse) {
      finish({ ok: false, errorMessage: asrError(frame) });
      return;
    }
    const parsed = asrResultOf(frame.json);
    if (parsed.text) {
      lastText = parsed.text;
      o.onPartial?.(lastText);
    }
    if (parsed.utterances) utterances = parsed.utterances;

    if (isFinalFrame(frame)) finish({ ok: true });
  };

  ws.onerror = () => finish({ ok: false, errorMessage: 'WebSocket error (handshake or transport failed).' });
  ws.onclose = (ev) => {
    if (settled) return;
    if (lastText) finish({ ok: true });
    else finish({ ok: false, errorMessage: `Connection closed (code ${ev.code}) before a transcript.` });
  };

  return {
    pushAudio: (bytes) => {
      if (!settled) queue.push(bytes);
    },
    end: () => {
      ended = true;
    },
    done,
  };
}

// --- file source -----------------------------------------------------------

export interface AsrStreamFileParams {
  key: string;
  providerId: string;
  path: string;
  audio: Uint8Array;
  /** Audio container, e.g. "wav" | "mp3" | "pcm". */
  format: string;
  rate: number;
  onPartial?: (text: string) => void;
}

/** Stream an uploaded recording: chunked, lightly paced so the server sees a stream. */
export async function runAsrStreamFile(p: AsrStreamFileParams): Promise<AsrStreamResult> {
  const session = openAsrSession({
    key: p.key,
    providerId: p.providerId,
    path: p.path,
    format: p.format,
    rate: p.rate,
    onPartial: p.onPartial,
  });
  const chunkSize = Math.max(p.rate, 8000); // ~1s of 16-bit mono audio
  for (let off = 0; off < p.audio.length; off += chunkSize) {
    session.pushAudio(p.audio.subarray(off, off + chunkSize));
    await sleep(40);
  }
  session.end();
  return session.done;
}

// --- microphone source -----------------------------------------------------

export interface AsrMicController {
  /** Stop capturing and finish the stream; awaitable via done. */
  stop(): void;
  done: Promise<AsrStreamResult>;
}

/**
 * Capture the microphone as 16 kHz mono PCM and stream it live, so the transcript
 * appears as you speak. Returns a controller: call stop() to end the utterance.
 * Throws if mic permission is denied before the session opens.
 */
export async function startAsrMicStream(p: {
  key: string;
  providerId: string;
  path: string;
  onPartial?: (text: string) => void;
}): Promise<AsrMicController> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext({ sampleRate: MIC_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0; // route to destination silently so onaudioprocess fires

  const session = openAsrSession({
    key: p.key,
    providerId: p.providerId,
    path: p.path,
    format: 'pcm',
    rate: MIC_RATE,
    onPartial: p.onPartial,
  });

  node.onaudioprocess = (e) => session.pushAudio(floatToPCM16(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    node.onaudioprocess = null;
    node.disconnect();
    source.disconnect();
    sink.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    session.end();
  };

  return { stop, done: session.done };
}

/** Convert Float32 [-1,1] samples to little-endian 16-bit PCM bytes. */
function floatToPCM16(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

// --- audio metadata --------------------------------------------------------

const ASR_FORMATS = ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'pcm'];

/**
 * Best-effort container + sample rate for an uploaded recording, so the test UI
 * needs no format/rate fields: the container comes from the extension, and the
 * rate from the WAV header when present (else a 16 kHz default that the server
 * tolerates for compressed containers it decodes itself).
 */
export function guessAudioMeta(bytes: Uint8Array, fileName: string): { format: string; rate: number } {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const format = ASR_FORMATS.includes(ext) ? ext : 'wav';
  return { format, rate: wavSampleRate(bytes) ?? MIC_RATE };
}

/** Read the sample rate from a canonical WAV header, if this is one. */
function wavSampleRate(b: Uint8Array): number | undefined {
  if (b.length < 28) return undefined;
  const tag = (off: number, s: string) =>
    s.split('').every((c, i) => b[off + i] === c.charCodeAt(0));
  if (!tag(0, 'RIFF') || !tag(8, 'WAVE')) return undefined;
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(24, true);
}

// --- shared helpers --------------------------------------------------------

function errResult(latencyMs: number, errorMessage: string): AsrStreamResult {
  return { ok: false, text: '', errorMessage, raw: '', latencyMs, bytesUp: 0 };
}

/** Pull text + utterances from a bigmodel response frame (result may nest under data). */
function asrResultOf(json: unknown): { text: string; utterances?: AsrUtterance[] } {
  if (typeof json !== 'object' || json === null) return { text: '' };
  const obj = json as Record<string, unknown>;
  const result = (obj.result ?? (obj.data as { result?: unknown } | undefined)?.result) as
    | Record<string, unknown>
    | undefined;
  const src = result ?? obj;
  const text = typeof src.text === 'string' ? src.text : '';
  const utterances = Array.isArray(src.utterances) ? (src.utterances as AsrUtterance[]) : undefined;
  return { text, utterances };
}

/** The message from an ERROR_RESPONSE frame. */
function asrError(frame: Frame): string {
  if (frame.json && typeof frame.json === 'object') {
    const m = (frame.json as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  const text = new TextDecoder().decode(frame.payload).trim();
  if (text) return text;
  return frame.errorCode ? `Upstream error (code ${frame.errorCode})` : 'Upstream error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
