/**
 * Motion, observed in jsdom, for tests only.
 *
 * jsdom has no layout and no Web Animations, so a confirm could never be
 * lifted (it has no box) and nothing could be seen to fade. This gives every
 * element a box and makes `animate` record what it was asked to play. Nothing
 * it plays ever finishes, so a held copy stays over the page to be read until
 * `restore`, which also takes every copy away.
 */
export interface PlayedMotion {
  el: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
}

const LAYERS = ':scope > [aria-hidden="true"][data-motion]';

export function watchMotion(): {
  played: PlayedMotion[];
  /** What faded `el` in, opacity 0 to 1, if anything did. */
  fadeOf: (el: Element | null | undefined) => PlayedMotion | undefined;
  /** The held copies drawn over the page, oldest first. */
  copies: () => HTMLElement[];
  /** What faded `copy` out, opacity to 0, if anything did. */
  exitOf: (copy: Element | null | undefined) => PlayedMotion | undefined;
  restore: () => void;
} {
  const played: PlayedMotion[] = [];
  const saved = {
    animate: Object.getOwnPropertyDescriptor(Element.prototype, "animate"),
    getBoundingClientRect: Object.getOwnPropertyDescriptor(
      Element.prototype,
      "getBoundingClientRect",
    ),
  };
  Object.defineProperties(Element.prototype, {
    animate: {
      configurable: true,
      writable: true,
      value(
        this: Element,
        frames: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        played.push({ el: this, frames, options });
        return {
          finished: new Promise(() => {}),
          cancel() {},
        } as unknown as Animation;
      },
    },
    getBoundingClientRect: {
      configurable: true,
      writable: true,
      value: () =>
        ({
          top: 300,
          left: 16,
          width: 340,
          height: 120,
          right: 356,
          bottom: 420,
          x: 16,
          y: 300,
        }) as DOMRect,
    },
  });

  return {
    played,
    fadeOf: (el) =>
      played.find(
        (p) =>
          el != null &&
          p.el === el &&
          p.frames[0]?.opacity === 0 &&
          p.frames.at(-1)?.opacity === 1,
      ),
    copies: () =>
      [...document.body.querySelectorAll<HTMLElement>(LAYERS)].map(
        (layer) => layer.firstElementChild as HTMLElement,
      ),
    exitOf: (copy) =>
      played.find(
        (p) => copy != null && p.el === copy && p.frames.at(-1)?.opacity === 0,
      ),
    restore() {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor)
          Object.defineProperty(Element.prototype, key, descriptor);
        else
          delete (Element.prototype as unknown as Record<string, unknown>)[key];
      }
      for (const layer of document.body.querySelectorAll(LAYERS))
        layer.remove();
    },
  };
}
