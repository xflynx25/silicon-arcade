type LoopCallbacks = {
  update: (dt: number) => void;
  render: (alpha: number) => void;
};

export const createFixedLoop = (
  callbacks: LoopCallbacks,
  fixedStep = 1 / 120
): { start: () => void; stop: () => void } => {
  let running = false;
  let rafId = 0;
  let last = 0;
  let accumulator = 0;
  const maxFrameTime = 0.1;

  const frame = (nowMs: number): void => {
    if (!running) {
      return;
    }
    const now = nowMs / 1000;
    const elapsed = Math.min(now - last, maxFrameTime);
    last = now;
    accumulator += elapsed;

    while (accumulator >= fixedStep) {
      callbacks.update(fixedStep);
      accumulator -= fixedStep;
    }

    callbacks.render(accumulator / fixedStep);
    rafId = window.requestAnimationFrame(frame);
  };

  return {
    start: () => {
      if (running) {
        return;
      }
      running = true;
      last = performance.now() / 1000;
      accumulator = 0;
      rafId = window.requestAnimationFrame(frame);
    },
    stop: () => {
      running = false;
      window.cancelAnimationFrame(rafId);
    }
  };
};
