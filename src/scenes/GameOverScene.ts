import Phaser from "phaser";
import { COLORS, COLOR_HEX, TEXT_PRESETS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel } from "../ui";
import { takeScreenshot } from "../screenshot";
import { isTouchDevice } from "../input";
import { HIGHSCORE_KEY } from "./MenuScene";

const WIDTH = 800;
const HEIGHT = 600;

interface InitData {
  score?: number;
  lines?: number;
  level?: number;
}

export class GameOverScene extends Phaser.Scene {
  private score = 0;
  private lines = 0;
  private level = 1;
  private high = 0;
  private isNewRecord = false;

  private keys!: Record<"R" | "SPACE" | "ENTER" | "ESC" | "K", Phaser.Input.Keyboard.Key>;

  constructor() { super("gameover"); }

  init(data: InitData) {
    this.score = data.score ?? 0;
    this.lines = data.lines ?? 0;
    this.level = data.level ?? 1;
    this.high = this.loadHigh();
    this.isNewRecord = this.score > this.high;
    if (this.isNewRecord) {
      this.high = this.score;
      try { localStorage.setItem(HIGHSCORE_KEY, String(this.high)); } catch {}
    }
  }

  create() {
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, COLOR_HEX.bg);
    drawDiagonalScanlines(this, WIDTH, HEIGHT, 15, 0.045);

    addCornerLabel(this, 22, 22, "/ 06", "TETRIS", false);
    createPulsingDot(this, WIDTH - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);
    this.add.text(WIDTH - 38, 22, `MELHOR  ${String(this.high).padStart(6, "0")}`, TEXT_PRESETS.monoLabel).setOrigin(1, 0);

    this.add.text(22, HEIGHT - 22, "GAMEDEV.06 · GAME OVER", TEXT_PRESETS.hint).setOrigin(0, 1);

    this.add
      .text(WIDTH / 2, 130, this.isNewRecord ? "NOVO RECORDE" : "GAME OVER", TEXT_PRESETS.monoLabel)
      .setOrigin(0.5)
      .setColor(this.isNewRecord ? COLORS.accent : COLORS.muted);

    this.add
      .text(WIDTH / 2, 230, String(this.score).padStart(6, "0"), TEXT_PRESETS.heroOutline)
      .setOrigin(0.5)
      .setFontSize("120px");

    this.add
      .text(WIDTH / 2, 350, `${this.lines} linhas  ·  nível ${this.level}`, TEXT_PRESETS.body)
      .setOrigin(0.5);

    this.add
      .text(WIDTH / 2, HEIGHT - 56, isTouchDevice()
        ? "TOQUE A TELA PRA JOGAR DE NOVO"
        : "R OU ESPAÇO PRA JOGAR DE NOVO  ·  ESC MENU  ·  K SCREENSHOT",
        TEXT_PRESETS.hint)
      .setOrigin(0.5);

    const kb = this.input.keyboard!;
    this.keys = {
      R: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      ENTER: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      ESC: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      K: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
    };
    this.input.on("pointerdown", () => this.scene.start("game"));
  }

  update() {
    const justDown = Phaser.Input.Keyboard.JustDown;
    if (justDown(this.keys.K)) takeScreenshot(this.game, "gamedev-06-tetris-over");
    if (justDown(this.keys.R) || justDown(this.keys.SPACE) || justDown(this.keys.ENTER)) this.scene.start("game");
    else if (justDown(this.keys.ESC)) this.scene.start("menu");
  }

  private loadHigh(): number {
    try {
      const raw = localStorage.getItem(HIGHSCORE_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }
}
