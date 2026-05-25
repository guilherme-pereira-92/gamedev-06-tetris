import Phaser from "phaser";
import { COLORS, COLOR_HEX, TEXT_PRESETS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel } from "../ui";
import { takeScreenshot } from "../screenshot";
import { unlockAudio } from "../audio";
import { isTouchDevice } from "../input";

const HIGHSCORE_KEY = "gamedev-06-tetris-highscore";

export class MenuScene extends Phaser.Scene {
  private keys!: Record<"SPACE" | "ENTER" | "K", Phaser.Input.Keyboard.Key>;
  private bg!: Phaser.GameObjects.Rectangle;
  private scanlines!: Phaser.GameObjects.Graphics;
  private titleEyebrow!: Phaser.GameObjects.Text;
  private titleHero!: Phaser.GameObjects.Text;
  private titleSub!: Phaser.GameObjects.Text;
  private decoT: Phaser.GameObjects.Rectangle[] = [];
  private instructions: Phaser.GameObjects.Text[] = [];
  private bottomHint!: Phaser.GameObjects.Text;
  private cornerTopRight!: Phaser.GameObjects.Text;
  private cornerBottomLeft!: Phaser.GameObjects.Text;
  private cornerBottomRight!: Phaser.GameObjects.Text;
  private dot!: { dot: Phaser.GameObjects.Arc; glow: Phaser.GameObjects.Arc };

  constructor() { super("menu"); }

  create() {
    const high = this.loadHigh();
    const W = this.scale.width;
    const H = this.scale.height;

    this.bg = this.add.rectangle(0, 0, W, H, COLOR_HEX.bg).setOrigin(0, 0);
    this.scanlines = drawDiagonalScanlines(this, W, H, 15, 0.045);

    addCornerLabel(this, 22, 22, "/ 06", "TETRIS", false);
    this.dot = createPulsingDot(this, W - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);
    this.cornerTopRight = this.add.text(W - 38, 22, `MELHOR  ${String(high).padStart(6, "0")}`, TEXT_PRESETS.monoLabel).setOrigin(1, 0);
    this.cornerBottomLeft = this.add.text(22, H - 22, "GAMEDEV.06", TEXT_PRESETS.hint).setOrigin(0, 1);
    this.cornerBottomRight = this.add.text(W - 22, H - 22, "BRICOLAGE · GEIST", TEXT_PRESETS.hint).setOrigin(1, 1);

    this.titleEyebrow = this.add.text(W / 2, H * 0.18, "/ JORNADA GAMEDEV", { ...TEXT_PRESETS.monoLabel, color: COLORS.muted }).setOrigin(0.5);
    this.titleHero = this.add.text(W / 2, H * 0.32, "TETRIS", TEXT_PRESETS.heroOutline).setOrigin(0.5).setFontSize(this.heroSize());
    this.titleSub = this.add.text(W / 2, H * 0.44, "encaixe peças · limpe linhas · 4 = tetris", TEXT_PRESETS.body).setOrigin(0.5);

    this.drawDecoT();
    this.drawInstructions();
    this.drawBottomHint();

    const kb = this.input.keyboard!;
    this.keys = {
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      ENTER: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      K: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
    };
    kb.on("keydown", unlockAudio);
    this.input.on("pointerdown", () => { unlockAudio(); this.scene.start("game"); });

    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.onResize, this));
  }

  private heroSize(): string {
    const base = Math.min(this.scale.width, this.scale.height);
    return `${Math.max(56, Math.min(110, Math.floor(base * 0.14)))}px`;
  }

  private drawDecoT() {
    for (const r of this.decoT) r.destroy();
    this.decoT = [];
    const W = this.scale.width;
    const H = this.scale.height;
    const cell = Math.max(12, Math.min(22, Math.floor(this.scale.width * 0.025)));
    const tColor = COLOR_HEX.accent;
    const tOffsets = [[0, 0], [1, 0], [2, 0], [1, 1]];
    for (const [dx, dy] of tOffsets) {
      const x = W / 2 + (dx - 1) * cell;
      const y = H * 0.55 + dy * cell;
      const r = this.add.rectangle(x, y, cell - 2, cell - 2, tColor, 1);
      r.setStrokeStyle(1, COLOR_HEX.fg, 0.4);
      this.decoT.push(r);
    }
  }

  private drawInstructions() {
    for (const t of this.instructions) t.destroy();
    this.instructions = [];
    const lines = isTouchDevice()
      ? ["arraste ↔ mover · ↓ soft drop", "tap rotacionar · swipe ↓ rápido = hard drop · swipe ↑ hold"]
      : ["← → mover · ↓ soft drop · ↑ rotacionar", "ESPAÇO hard drop · SHIFT/C hold · P pausar"];
    const W = this.scale.width;
    const H = this.scale.height;
    lines.forEach((line, i) => {
      const t = this.add.text(W / 2, H * 0.72 + i * 22, line, { ...TEXT_PRESETS.body, fontSize: "13px" }).setOrigin(0.5);
      this.instructions.push(t);
    });
  }

  private drawBottomHint() {
    if (this.bottomHint) this.bottomHint.destroy();
    const W = this.scale.width;
    const H = this.scale.height;
    this.bottomHint = this.add.text(W / 2, H - 56,
      isTouchDevice() ? "TOQUE A TELA PRA COMEÇAR" : "ESPAÇO OU ENTER PRA COMEÇAR  ·  K SCREENSHOT",
      TEXT_PRESETS.hint).setOrigin(0.5);
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    const W = gameSize.width;
    const H = gameSize.height;
    this.bg.setSize(W, H);
    this.scanlines.destroy();
    this.scanlines = drawDiagonalScanlines(this, W, H, 15, 0.045);
    this.dot.dot.setPosition(W - 22 - 4, 22 + 6);
    this.dot.glow.setPosition(W - 22 - 4, 22 + 6);
    this.cornerTopRight.setPosition(W - 38, 22);
    this.cornerBottomLeft.setPosition(22, H - 22);
    this.cornerBottomRight.setPosition(W - 22, H - 22);
    this.titleEyebrow.setPosition(W / 2, H * 0.18);
    this.titleHero.setPosition(W / 2, H * 0.32).setFontSize(this.heroSize());
    this.titleSub.setPosition(W / 2, H * 0.44);
    this.drawDecoT();
    this.drawInstructions();
    this.drawBottomHint();
  }

  update() {
    const justDown = Phaser.Input.Keyboard.JustDown;
    if (justDown(this.keys.K)) takeScreenshot(this.game, "gamedev-06-tetris-menu");
    if (justDown(this.keys.SPACE) || justDown(this.keys.ENTER)) this.scene.start("game");
  }

  private loadHigh(): number {
    try {
      const raw = localStorage.getItem(HIGHSCORE_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }
}

export { HIGHSCORE_KEY };
