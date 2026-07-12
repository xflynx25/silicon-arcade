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
  }

  setHud(data: HudData): void {
    this.topLeft.textContent = data.left;
    this.topCenter.textContent = data.center;
    this.topRight.textContent = data.right;
  }

  setOverlay(data: OverlayData): void {
    this.overlay.style.display = data.visible ? "block" : "none";
    this.overlayTitle.textContent = data.title;
    this.overlayBody.textContent = data.body;
  }
}
