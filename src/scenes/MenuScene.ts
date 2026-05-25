import Phaser from "phaser";
import { COLORS, COLOR_HEX, TEXT_PRESETS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel } from "../ui";
import { takeScreenshot } from "../screenshot";
import { unlockAudio } from "../audio";
import { isTouchDevice } from "../input";

const WIDTH = 800;
const HEIGHT = 600;
const HIGHSCORE_KEY = "gamedev-06-tetris-highscore";

export class MenuScene extends Phaser.Scene {
  private keys!: Record<"SPACE" | "ENTER" | "K", Phaser.Input.Keyboard.Key>;

  constructor() {
    super("menu");
  }

  create() {
    const high = this.loadHigh();

    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, COLOR_HEX.bg);
    drawDiagonalScanlines(this, WIDTH, HEIGHT, 15, 0.045);

    addCornerLabel(this, 22, 22, "/ 06", "TETRIS", false);
    createPulsingDot(this, WIDTH - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);
    this.add.text(WIDTH - 38, 22, `MELHOR  ${String(high).padStart(6, "0")}`, TEXT_PRESETS.monoLabel).setOrigin(1, 0);

    this.add.text(22, HEIGHT - 22, "GAMEDEV.06", TEXT_PRESETS.hint).setOrigin(0, 1);
    this.add.text(WIDTH - 22, HEIGHT - 22, "BRICOLAGE · GEIST", TEXT_PRESETS.hint).setOrigin(1, 1);

    this.add
      .text(WIDTH / 2, 110, "/ JORNADA GAMEDEV", { ...TEXT_PRESETS.monoLabel, color: COLORS.muted })
      .setOrigin(0.5);

    this.add
      .text(WIDTH / 2, 175, "TETRIS", TEXT_PRESETS.heroOutline)
      .setOrigin(0.5)
      .setFontSize("96px");

    this.add
      .text(WIDTH / 2, 245, "encaixe peças · limpe linhas · 4 de uma vez = tetris", TEXT_PRESETS.body)
      .setOrigin(0.5);

    // Decorative T piece
    const cell = 18;
    const tColor = COLOR_HEX.accent;
    const tOffsets = [[0, 0], [1, 0], [2, 0], [1, 1]];
    for (const [dx, dy] of tOffsets) {
      const x = WIDTH / 2 + (dx - 1) * cell;
      const y = 320 + dy * cell;
      const r = this.add.rectangle(x, y, cell - 2, cell - 2, tColor, 1);
      r.setStrokeStyle(1, COLOR_HEX.fg, 0.4);
    }

    const controls = isTouchDevice()
      ? [
          "← → mover · ↓ acelerar · ↑ rotacionar",
          "ESPAÇO drop · SHIFT segurar",
        ]
      : [
          "← → mover · ↓ soft drop · ↑ rotacionar",
          "ESPAÇO hard drop · SHIFT/C hold · P pausar",
        ];
    controls.forEach((line, i) => {
      this.add
        .text(WIDTH / 2, 410 + i * 22, line, { ...TEXT_PRESETS.body, fontSize: "14px" })
        .setOrigin(0.5);
    });

    this.add
      .text(WIDTH / 2, HEIGHT - 56,
        isTouchDevice() ? "TOQUE A TELA PRA COMEÇAR" : "ESPAÇO OU ENTER PRA COMEÇAR  ·  K SCREENSHOT",
        TEXT_PRESETS.hint)
      .setOrigin(0.5);

    const kb = this.input.keyboard!;
    this.keys = {
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      ENTER: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      K: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
    };
    kb.on("keydown", unlockAudio);
    this.input.on("pointerdown", () => { unlockAudio(); this.scene.start("game"); });
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
