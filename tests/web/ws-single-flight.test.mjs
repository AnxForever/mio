import assert from 'node:assert';

const storage = new Map();
global.window = {
  location: { origin: 'http://127.0.0.1:3000', hash: '' },
};
global.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};

const sockets = [];
class FakeWebSocket {
  static OPEN = 1;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    sockets.push(this);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = 3;
  }
}

global.WebSocket = FakeWebSocket;

const { Store } = await import('../../web/js/store.js');
const { wsManager } = await import('../../web/js/ws.js');

Store.set('serverUrl', 'http://127.0.0.1:3000');
wsManager.connect();

const socket = sockets[0];
assert.ok(socket, 'WebSocket should be constructed');
socket.onopen?.();

const tokens = [];
const dones = [];
const errors = [];
await wsManager.sendChat('第一条', {
  onToken(chunk) { tokens.push(chunk); },
  onDone() { dones.push('done'); },
  onError(error) { errors.push(error); },
});
await wsManager.sendChat('第二条', {
  onToken() {},
  onDone() {},
  onError(error) { errors.push(error); },
});

const chatPayloads = socket.sent.filter((payload) => payload.type === 'chat');
assert.equal(chatPayloads.length, 1, 'should not send a second WS chat while the first stream is active');
assert.equal(errors.length, 1, 'second send should surface an error to the caller');
assert.match(errors[0], /上一条|处理中|结束/);
assert.ok(chatPayloads[0].requestId, 'WS chat payload should include a requestId');

socket.onmessage?.({ data: JSON.stringify({ type: 'token', requestId: 'stale-request', chunk: '旧' }) });
assert.deepEqual(tokens, [], 'stale requestId token should be ignored');

socket.onmessage?.({ data: JSON.stringify({ type: 'token', requestId: chatPayloads[0].requestId, chunk: '新' }) });
assert.deepEqual(tokens, ['新'], 'matching requestId token should be delivered');

socket.onmessage?.({ data: JSON.stringify({ type: 'done', requestId: chatPayloads[0].requestId, sessionId: 's1' }) });
assert.deepEqual(dones, ['done'], 'matching requestId done should finish the stream');

await wsManager.sendChat('第三条', {
  onToken() {},
  onDone() {},
  onError(error) { errors.push(error); },
});
assert.equal(
  socket.sent.filter((payload) => payload.type === 'chat').length,
  2,
  'a new WS chat should be allowed after the previous stream is done',
);

wsManager.disconnect();

console.log('✓ ws single-flight chat guard');
