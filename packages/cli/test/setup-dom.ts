import { JSDOM } from 'jsdom';

if (typeof globalThis.document === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const { window } = dom;

  Object.defineProperties(globalThis, {
    window: {
      value: window,
      configurable: true,
    },
    document: {
      value: window.document,
      configurable: true,
    },
    navigator: {
      value: window.navigator,
      configurable: true,
    },
    HTMLElement: {
      value: window.HTMLElement,
      configurable: true,
    },
    Node: {
      value: window.Node,
      configurable: true,
    },
    getComputedStyle: {
      value: window.getComputedStyle.bind(window),
      configurable: true,
    },
    requestAnimationFrame: {
      value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
      configurable: true,
    },
    cancelAnimationFrame: {
      value: (handle: number) => clearTimeout(handle),
      configurable: true,
    },
    IS_REACT_ACT_ENVIRONMENT: {
      value: true,
      configurable: true,
      writable: true,
    },
  });
}
