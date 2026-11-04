// Chat: respostas reais gravadas (2026-11-04), passando pela porta pública com um fetch falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '../src/index.js';

const read = (api, name) => readFileSync(new URL(`./fixtures/${api}/${name}`, import.meta.url), 'utf8');

async function play(api, name) {
  const body = read(api, name);
  const fetch = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const account = { id: 'a', provider: 'p', api, baseUrl: 'https://x/v1', apiKey: 'k' };
  const model = { id: 'm', operations: ['chat'], input: ['text'], output: ['text'] };
  const run = createClient({ account, model, fetch }).chat({ messages: [{ role: 'user', content: 'oi' }] });
  const events = [];
  for await (const ev of run) events.push(ev);
  return { events, result: await run.result };
}

const text = (events) => events.filter((e) => e.type === 'text').map((e) => e.text).join('');

for (const api of ['openai-completions', 'anthropic-messages']) {
  test(`${api}: texto real, com uso`, async () => {
    const { events, result } = await play(api, 'real-text.sse');
    assert.match(text(events), /pong/i);
    assert.equal(result.finishReason === 'stop' || result.finishReason === 'end_turn', true);
    assert.ok(result.usage.input > 0);
    assert.ok(result.usage.output > 0);
  });

  test(`${api}: tool call real`, async () => {
    const { events, result } = await play(api, 'real-tool.sse');
    const call = events.find((e) => e.type === 'tool_call');
    assert.equal(call.name, 'horas_em');
    assert.match(JSON.parse(call.arguments).cidade, /Dourados/);
    assert.ok(call.id);
    assert.equal(result.finishReason === 'tool_calls' || result.finishReason === 'tool_use', true);
  });
}
