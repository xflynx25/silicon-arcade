import type { Vec } from "./vec";

// The one genuinely new render technique in RELAY: a single cached offscreen
// radial-gradient alpha mask (opaque center -> transparent edge), rebuilt only
// when the fog radius knob changes — never per frame. Per frame we draw the
// Pilot's bright, "true vision" world geometry onto a scratch canvas, then
// composite the cached mask onto it with "destination-in" so only what falls
// inside the bubble around the Pilot survives. That result is blitted over the
// dim, fog-free Navigator layer already on the main canvas. No shadowBlur, no
// per-frame gradient rebuilds — see CHANGELOG for the perf regressions that
// pattern caused elsewhere (POLARITY / ECHO / RICOCHET / SALVO).
export class FogMask {
  private readonly maskCanvas = document.createElement("canvas");
  private readonly maskCtx: CanvasRenderingContext2D;
  private readonly scratch = document.createElement("canvas");
  private readonly scratchCtx: CanvasRenderingContext2D;
  private cachedRadius = -1;

  constructor() {
    const maskCtx = this.maskCanvas.getContext("2d");
    const scratchCtx = this.scratch.getContext("2d");
    if (!maskCtx || !scratchCtx) {
      throw new Error("Expected 2D rendering context to exist.");
    }
    this.maskCtx = maskCtx;
    this.scratchCtx = scratchCtx;
  }

  private rebuild(radius: number): void {
    if (radius === this.cachedRadius) {
      return;
    }
    this.cachedRadius = radius;
    const size = Math.ceil(radius * 2);
    this.maskCanvas.width = size;
    this.maskCanvas.height = size;
    const ctx = this.maskCtx;
    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
    // Soft fade in the outer ~30%: hazards straddling the edge render as vague
    // silhouettes for a beat of warning instead of popping in with a hard cut.
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.68, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(radius, radius, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // draw(radius, center, width, height, drawWorld) paints `drawWorld` onto a
  // scratch layer sized to the viewport, clips it to a circle of `radius`
  // centered on `center`, and returns the scratch canvas ready to blit.
  render(
    width: number,
    height: number,
    radius: number,
    center: Vec,
    drawWorld: (ctx: CanvasRenderingContext2D) => void
  ): HTMLCanvasElement {
    this.rebuild(radius);
    this.scratch.width = width;
    this.scratch.height = height;
    const ctx = this.scratchCtx;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    drawWorld(ctx);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(
      this.maskCanvas,
      center.x - radius,
      center.y - radius,
      radius * 2,
      radius * 2
    );
    ctx.restore();

    return this.scratch;
  }
}
