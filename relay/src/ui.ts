type HudData = {
  left: string;
  center: string;
  right: string;
};

type OverlayData = {
  title: string;
  body: string;
  visible: boolean;
};

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly topLeft: HTMLDivElement;
  private readonly topCenter: HTMLDivElement;
  private readonly topRight: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly overlayTitle: HTMLHeadingElement;
  private readonly overlayBody: HTMLParagraphElement;

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";

    const topRow = document.createElement("div");
    topRow.className = "top-row";
    this.topLeft = document.createElement("div");
    this.topCenter = document.createElement("div");
    this.topRight = document.createElement("div");
    topRow.append(this.topLeft, this.topCenter, this.topRight);

    this.overlay = document.createElement("div");
    this.overlay.className = "center-overlay";
    this.overlayTitle = document.createElement("h1");
    this.overlayTitle.style.margin = "0 0 12px";
    this.overlayBody = document.createElement("p");
    this.overlayBody.style.margin = "0";
    this.overlayBody.style.whiteSpace = "pre-line";
    this.overlayBody.style.lineHeight = "1.5";
    this.overlay.append(this.overlayTitle, this.overlayBody);

    this.root.append(topRow, this.overlay);
    host.append(this.root);

    const style = document.createElement("style");
    style.textContent = `
      .hud { position: absolute; inset: 0; pointer-events: none; font-family: inherit; }
      .top-row { position: absolute; top: 0; left: 0; right: 0; display: flex; justify-content: space-between;
        padding: 14px 20px; font-size: 15px; letter-spacing: 0.04em; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
      .top-row > div:first-child { color: #ffb37a; }
      .top-row > div:last-child { color: #7ad6ff; text-align: right; }
      .top-row > div:nth-child(2) { color: #e6ecff; text-align: center; flex: 1; }
      .center-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
        justify-content: center; text-align: center; background: rgba(4,5,14,0.72); padding: 24px; }
      .center-overlay h1 { font-size: 28px; letter-spacing: 0.06em; }
      .center-overlay p { font-size: 15px; max-width: 620px; }
    `;
    host.append(style);
  }

  setHud(data: HudData): void {
    this.topLeft.textContent = data.left;
    this.topCenter.textContent = data.center;
    this.topRight.textContent = data.right;
  }

  setOverlay(data: OverlayData): void {
    this.overlay.style.display = data.visible ? "flex" : "none";
    this.overlayTitle.textContent = data.title;
    this.overlayBody.textContent = data.body;
  }
}
