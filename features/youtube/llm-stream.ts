const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const SONNET_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b';

// Token budget for the local model before routing to Anthropic instead —
// small local models lose coherence on large prompts. Estimated as chars / 4,
// which is close enough for a routing decision.
export const LOCAL_TOKEN_BUDGET = Number(process.env.LOCAL_TOKEN_BUDGET) || 6000;

export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export interface StreamResult {
  stream: ReadableStream<Uint8Array>;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  /** Optional system prompt. Stable/repeated content — put it here rather than in messages. */
  system?: string;
  /** Mark the system block cacheable (Anthropic prompt caching). Ignored by Ollama. */
  cacheSystem?: boolean;
  messages: ChatMessage[];
}

export function ollamaStream(req: ChatRequest): StreamResult {
  const messages = req.system
    ? [{ role: 'system', content: req.system }, ...req.messages]
    : req.messages;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const emit = (s: string) => controller.enqueue(encoder.encode(s));

      let upstream: Response;
      try {
        upstream = await fetch(`${OLLAMA_HOST}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: true,
            options: {
              temperature: 0.4,
              num_ctx: 8192,
              num_predict: 2048,
            },
            messages,
          }),
        });
      } catch (e) {
        emit(`\n[error: Ollama fetch failed — ${e instanceof Error ? e.message : 'unknown'}]\n`);
        controller.close();
        return;
      }

      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '');
        emit(`\n[error: Ollama ${upstream.status}: ${detail.slice(0, 200)}]\n`);
        controller.close();
        return;
      }

      const reader = upstream.body.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Ollama streams NDJSON — one JSON object per line.
          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
              const evt = JSON.parse(line);
              const chunk = evt?.message?.content;
              if (typeof chunk === 'string' && chunk.length > 0) {
                emit(chunk);
              }
              if (evt?.error) {
                emit(`\n[error: ${evt.error}]\n`);
              }
            } catch {
              // partial / malformed line — wait for more bytes
            }
          }
        }
      } catch (e) {
        emit(`\n[error: stream interrupted — ${e instanceof Error ? e.message : 'unknown'}]\n`);
      } finally {
        controller.close();
      }
    },
  });

  return { stream, model: `ollama:${OLLAMA_MODEL}` };
}

export function sonnetStream(req: ChatRequest): StreamResult | { error: Response } {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      error: new Response('[error: ANTHROPIC_API_KEY not configured]\n', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    };
  }

  const body: Record<string, unknown> = {
    model: SONNET_MODEL,
    max_tokens: 2048,
    stream: true,
    messages: req.messages,
  };
  if (req.system) {
    // cache_control on the system block lets repeated requests in the same
    // conversation skip re-charging for the (potentially huge) static
    // context — only the bytes before the breakpoint need to match exactly.
    body.system = req.cacheSystem
      ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }]
      : req.system;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const emit = (s: string) => controller.enqueue(encoder.encode(s));

      let upstream: Response;
      try {
        upstream = await fetch(ANTHROPIC_API, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        emit(`\n[error: ${e instanceof Error ? e.message : 'fetch failed'}]\n`);
        controller.close();
        return;
      }

      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '');
        emit(`\n[error: Anthropic ${upstream.status}: ${detail.slice(0, 200)}]\n`);
        controller.close();
        return;
      }

      const reader = upstream.body.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            for (const line of rawEvent.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const evt = JSON.parse(payload);
                if (evt.type === 'content_block_delta') {
                  const delta = evt.delta;
                  if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                    emit(delta.text);
                  }
                } else if (evt.type === 'error') {
                  emit(`\n[error: ${evt.error?.message || 'stream error'}]\n`);
                }
              } catch {
                // ignore malformed event
              }
            }
          }
        }
      } catch (e) {
        emit(`\n[error: stream interrupted — ${e instanceof Error ? e.message : 'unknown'}]\n`);
      } finally {
        controller.close();
      }
    },
  });

  return { stream, model: `anthropic:${SONNET_MODEL}` };
}

/**
 * Non-streaming helper for backend jobs that need a complete string (the
 * channel-research pipeline's per-video summarise/synthesise steps) rather
 * than a Response to pipe to a browser. Reuses the same routing/model logic
 * as the interactive streaming paths by draining whichever stream they
 * return.
 */
export async function generateText(req: ChatRequest): Promise<{ text: string; model: string }> {
  const promptTokens = estimateTokens(req.system ?? '') + req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  const useLocal = promptTokens <= LOCAL_TOKEN_BUDGET;
  const result = useLocal ? ollamaStream(req) : sonnetStream(req);

  if ('error' in result) {
    const detail = await result.error.text().catch(() => 'LLM unavailable');
    throw new Error(detail.trim() || 'LLM unavailable');
  }

  const reader = result.stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  if (text.trimStart().startsWith('[error:')) {
    throw new Error(text.trim());
  }
  return { text, model: result.model };
}
