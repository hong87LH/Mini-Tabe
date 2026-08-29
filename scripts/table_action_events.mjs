#!/usr/bin/env node

const args = process.argv.slice(2);
const tokenArg = args.find(arg => arg.startsWith('--token='));
const portArg = args.find(arg => arg.startsWith('--port='));
const token = tokenArg?.slice('--token='.length) || process.env.HONGS_TABLE_ACTION_TOKEN || '';
const port = Number(portArg?.slice('--port='.length) || process.env.HONGS_TABLE_ACTION_PORT || 17321);

if (!token) {
  console.error('Missing token. Use --token=... or HONGS_TABLE_ACTION_TOKEN.');
  process.exit(2);
}

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

const response = await fetch(`http://127.0.0.1:${port}/v0.1/events`, {
  headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
  signal: controller.signal
});
if (!response.ok || !response.body) {
  console.error(`Unable to subscribe: HTTP ${response.status}`);
  process.exit(1);
}

console.log(`Subscribed to AI Table events on 127.0.0.1:${port}. Press Ctrl+C to stop.`);
const decoder = new TextDecoder();
let buffer = '';
try {
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (!block || block.startsWith(':')) continue;
      const event = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      let parsed = data;
      try { parsed = JSON.parse(data); } catch (_) {}
      console.log(JSON.stringify({ event, data: parsed }, null, 2));
    }
  }
} catch (error) {
  if (error?.name !== 'AbortError') throw error;
}
