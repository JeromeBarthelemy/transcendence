// The screens open a WebSocket to hear about others' changes; jsdom would
// try a real connection. Tests that care about it install their own.
class SilentWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = SilentWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close() {}
}

globalThis.WebSocket = SilentWebSocket as unknown as typeof WebSocket;
// Existing screen fixtures are French. Language detection tests override
// these browser preferences explicitly.
Object.defineProperty(navigator, "languages", {
  configurable: true,
  get: () => ["fr-FR"],
});
