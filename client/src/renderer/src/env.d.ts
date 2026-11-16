import type { EchoApi } from '../../preload';

declare global {
  interface Window {
    echo: EchoApi;
  }
}

export {};
