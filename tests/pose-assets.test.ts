import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { POSE_ASSET_BASE } from '../src/lib/pose-assets';
import * as assets from '../scripts/pose-assets.mjs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const mediapipeVersion: string = JSON.parse(
  read('node_modules/@mediapipe/tasks-vision/package.json'),
).version;

describe('versioned pose asset URLs', () => {
  it('the app, pose worker and service worker request the installed asset version', () => {
    const base = assets.poseAssetBase(mediapipeVersion);
    expect(POSE_ASSET_BASE).toBe(base);
    expect(read('public/pose-worker.js')).toContain(`'${base}'`);
    expect(read('public/sw.js')).toContain(`'${base}'`);
  });

  it('changes the version when MediaPipe or any pinned model changes', () => {
    const current = assets.poseAssetVersion('0.10.32');
    expect(assets.poseAssetVersion('0.10.33')).not.toBe(current);
    expect(
      assets.poseAssetVersion('0.10.32', { ...assets.POSE_MODELS, full: 'f'.repeat(64) }),
    ).not.toBe(current);
    expect(() => assets.poseAssetVersion('latest')).toThrow();
  });

  it('tries an https mirror before Google storage and rejects insecure mirrors', () => {
    expect(assets.poseModelUrls('full')).toEqual([
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    ]);
    expect(assets.poseModelUrls('lite', 'https://mirror.example.test/pose')[0]).toBe(
      'https://mirror.example.test/pose/pose_landmarker_lite.task',
    );
    expect(assets.poseModelUrls('lite', 'http://127.0.0.1:8080/m/')[0]).toBe(
      'http://127.0.0.1:8080/m/pose_landmarker_lite.task',
    );
    expect(() => assets.poseModelUrls('lite', 'http://mirror.example.test/pose')).toThrow(/https/);
  });

  it('backs off exponentially with a cap', () => {
    expect([0, 1, 2, 3, 10].map((n) => assets.retryDelayMs(n))).toEqual([
      1000, 2000, 4000, 8000, 15000,
    ]);
  });
});

describe('service worker pose cache', () => {
  function loadWorker() {
    const stores = new Map<string, Map<string, Response>>();
    const listeners: Record<string, (event: unknown) => void> = {};
    const fetches: string[] = [];
    const open = async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        match: async (request: Request) => store.get(request.url)?.clone(),
        put: async (request: Request, response: Response) => void store.set(request.url, response),
        addAll: async () => {},
      };
    };
    const context = {
      self: {
        location: { origin: 'https://app.example.test' },
        addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[type] = fn),
      },
      caches: {
        open,
        keys: async () => [...stores.keys()],
        delete: async (name: string) => stores.delete(name),
        match: async () => undefined,
      },
      fetch: async (request: Request) => {
        fetches.push(request.url);
        return Object.defineProperty(new Response('model', { status: 200 }), 'type', {
          value: 'basic',
        });
      },
      URL,
      Promise,
    };
    vm.runInNewContext(read('public/sw.js'), context);
    async function request(path: string, init?: RequestInit) {
      let responded: Promise<Response> | undefined;
      listeners.fetch({
        // Node's Request defaults to mode 'cors', like a worker subresource fetch.
        request: new Request(`https://app.example.test${path}`, init),
        respondWith: (value: Promise<Response>) => (responded = value),
      });
      return responded;
    }
    return { stores, listeners, fetches, request };
  }

  it('serves versioned pose assets cache-first and deletes older pose caches', async () => {
    const worker = loadWorker();
    worker.stores.set('geez-pose-assets-mp0.10.31-old', new Map());
    worker.stores.set('unrelated-cache', new Map());
    let activated: Promise<unknown> | undefined;
    worker.listeners.activate({ waitUntil: (value: Promise<unknown>) => (activated = value) });
    await activated;
    expect([...worker.stores.keys()]).toEqual(['unrelated-cache']);

    const path = `${POSE_ASSET_BASE}/models/pose_landmarker_full.task`;
    expect(await (await worker.request(path))!.text()).toBe('model');
    expect(await (await worker.request(path))!.text()).toBe('model');
    expect(worker.fetches).toHaveLength(1);
    expect([...worker.stores.keys()]).toContain(
      `geez-pose-assets-${POSE_ASSET_BASE.split('/').pop()}`,
    );
  });

  it('leaves unversioned, query and range requests to the network', async () => {
    const worker = loadWorker();
    expect(await worker.request('/models/pose_landmarker_full.task')).toBeUndefined();
    expect(await worker.request(`${POSE_ASSET_BASE}/wasm/x.wasm?v=1`)).toBeUndefined();
    expect(
      await worker.request(`${POSE_ASSET_BASE}/wasm/x.wasm`, { headers: { range: 'bytes=0-1' } }),
    ).toBeUndefined();
  });
});
