import Phaser from "phaser";
import { COLOR_HEX, TEXT_PRESETS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel } from "../ui";
import { takeScreenshot } from "../screenshot";
import { playTone, unlockAudio } from "../audio";

const WIDTH = 800;
const HEIGHT = 600;
const COLS = 10;
const ROWS = 20;
const CELL = 22;
const PLAYFIELD_W = COLS * CELL; // 220
const PLAYFIELD_H = ROWS * CELL; // 440
const PLAYFIELD_X = (WIDTH - PLAYFIELD_W) / 2; // 290
const PLAYFIELD_Y = 80;

const DAS_DELAY = 160;
const ARR_RATE = 40;
const SOFT_DROP_RATE = 50;
const LOCK_DELAY = 500;

const HIGHSCORE_KEY = "gamedev-06-tetris-highscore";

type PieceId = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Cell = number; // 0 = empty, 1+ = filled (color index)

// Cores por peça (mistura da paleta do site + alguns extras pra distinção visual)
const PIECE_COLORS: Record<PieceId, number> = {
  I: 0x00d4ff, // cyan
  O: 0xfbbf24, // amber
  T: 0xc084fc, // light purple
  S: 0x7ad17a, // green
  Z: 0xef4444, // red
  J: 0x60a5fa, // light blue
  L: 0xff4500, // orange (accent)
};

const PIECE_COLOR_INDEX: Record<PieceId, number> = {
  I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7,
};

const INDEX_TO_COLOR: number[] = [
  0, // 0 (empty)
  PIECE_COLORS.I,
  PIECE_COLORS.O,
  PIECE_COLORS.T,
  PIECE_COLORS.S,
  PIECE_COLORS.Z,
  PIECE_COLORS.J,
  PIECE_COLORS.L,
];

// Shapes definidas em 4×4 (padrão SRS, exceto O que é 2×2 mas usamos 4×4 padded).
// Array de 4 rotações por peça. Cada rotação é matriz com 1 = cell ocupada.
type Matrix = number[][];

const SHAPES: Record<PieceId, Matrix[]> = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ],
  O: [
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
  ],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]],
    [[0,1,0],[1,1,0],[0,1,0]],
  ],
  S: [
    [[0,1,1],[1,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]],
    [[1,0,0],[1,1,0],[0,1,0]],
  ],
  Z: [
    [[1,1,0],[0,1,1],[0,0,0]],
    [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]],
    [[0,1,0],[1,1,0],[1,0,0]],
  ],
  J: [
    [[1,0,0],[1,1,1],[0,0,0]],
    [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]],
    [[0,1,0],[0,1,0],[1,1,0]],
  ],
  L: [
    [[0,0,1],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]],
    [[1,1,0],[0,1,0],[0,1,0]],
  ],
};

// Wall kicks (simplificado, não é SRS completo mas funciona bem na prática)
const WALL_KICKS: Array<[number, number]> = [
  [0, 0],   // sem kick
  [-1, 0],  // 1 pra esquerda
  [1, 0],   // 1 pra direita
  [0, -1],  // 1 pra cima
  [-2, 0],  // 2 pra esquerda
  [2, 0],   // 2 pra direita
];

interface ActivePiece {
  id: PieceId;
  rotation: number;
  x: number; // col da matriz no playfield
  y: number; // row da matriz no playfield
}

type GameState = "playing" | "paused" | "gameover";

export class TetrisScene extends Phaser.Scene {
  private board: Cell[][] = [];
  private active: ActivePiece | null = null;
  private hold: PieceId | null = null;
  private canHold = true;
  private nextQueue: PieceId[] = [];
  private bag: PieceId[] = [];

  private boardGraphics!: Phaser.GameObjects.Graphics;
  private activeGraphics!: Phaser.GameObjects.Graphics;
  private ghostGraphics!: Phaser.GameObjects.Graphics;
  private holdGraphics!: Phaser.GameObjects.Graphics;
  private nextGraphics!: Phaser.GameObjects.Graphics;
  private flashGraphics!: Phaser.GameObjects.Graphics;

  private scoreText!: Phaser.GameObjects.Text;
  private linesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;

  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayHint!: Phaser.GameObjects.Text;

  private score = 0;
  private lines = 0;
  private level = 1;
  private state: GameState = "playing";

  private gravityAccumulator = 0;
  private lockTimer = 0;
  private clearingRows: number[] = [];
  private clearFlashTimer = 0;

  // DAS state
  private leftHeldSince = 0;
  private leftLastMove = 0;
  private rightHeldSince = 0;
  private rightLastMove = 0;
  private softDropLast = 0;

  private keys!: Record<
    "LEFT" | "RIGHT" | "UP" | "DOWN" | "Z" | "X" | "C" | "SHIFT" | "SPACE" | "P" | "ESC" | "K",
    Phaser.Input.Keyboard.Key
  >;

  constructor() {
    super("game");
  }

  create() {
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, COLOR_HEX.bg);
    drawDiagonalScanlines(this, WIDTH, HEIGHT, 18, 0.04);

    this.initBoard();
    this.drawPlayfieldFrame();
    this.drawSidePanels();
    this.drawChrome();

    this.boardGraphics = this.add.graphics();
    this.ghostGraphics = this.add.graphics();
    this.activeGraphics = this.add.graphics();
    this.holdGraphics = this.add.graphics();
    this.nextGraphics = this.add.graphics();
    this.flashGraphics = this.add.graphics();

    this.drawOverlay();

    const kb = this.input.keyboard!;
    this.keys = {
      LEFT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      RIGHT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      UP: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      DOWN: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      Z: kb.addKey(Phaser.Input.Keyboard.KeyCodes.Z),
      X: kb.addKey(Phaser.Input.Keyboard.KeyCodes.X),
      C: kb.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      SHIFT: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      SPACE: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      P: kb.addKey(Phaser.Input.Keyboard.KeyCodes.P),
      ESC: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
      K: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
    };
    kb.on("keydown", unlockAudio);

    this.spawnNext();
    this.refreshChrome();
    this.drawAll();

    this.events.on("shutdown", () => {
      // cleanup if needed
    });
  }

  update(time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.K)) takeScreenshot(this.game, "gamedev-06-tetris");
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) { this.scene.start("menu"); return; }
    if (Phaser.Input.Keyboard.JustDown(this.keys.P)) {
      if (this.state === "playing") {
        this.state = "paused";
        this.showOverlay("PAUSADO", "P CONTINUAR");
      } else if (this.state === "paused") {
        this.state = "playing";
        this.hideOverlay();
      }
      return;
    }

    if (this.state !== "playing") return;
    if (!this.active) return;

    // Line clear animation
    if (this.clearingRows.length > 0) {
      this.clearFlashTimer -= delta;
      this.drawClearFlash();
      if (this.clearFlashTimer <= 0) {
        this.applyLineClears();
      }
      return;
    }

    // Input
    this.handleInput(time);

    // Gravity
    const gravityMs = this.gravityInterval();
    this.gravityAccumulator += delta;
    while (this.gravityAccumulator >= gravityMs) {
      this.gravityAccumulator -= gravityMs;
      this.fallOneStep();
    }

    // Lock delay (peça encostou no chão por X ms = trava)
    if (this.isPieceLanded()) {
      this.lockTimer += delta;
      if (this.lockTimer >= LOCK_DELAY) {
        this.lockPiece();
      }
    } else {
      this.lockTimer = 0;
    }

    this.drawAll();
  }

  // ---------- input ----------

  private handleInput(time: number) {
    const justDown = Phaser.Input.Keyboard.JustDown;

    // Movimento horizontal com DAS
    if (this.keys.LEFT.isDown) {
      if (this.leftHeldSince === 0) {
        this.leftHeldSince = time;
        this.leftLastMove = time;
        this.tryMove(-1, 0);
      } else if (time - this.leftHeldSince > DAS_DELAY && time - this.leftLastMove > ARR_RATE) {
        this.leftLastMove = time;
        this.tryMove(-1, 0);
      }
    } else {
      this.leftHeldSince = 0;
    }

    if (this.keys.RIGHT.isDown) {
      if (this.rightHeldSince === 0) {
        this.rightHeldSince = time;
        this.rightLastMove = time;
        this.tryMove(1, 0);
      } else if (time - this.rightHeldSince > DAS_DELAY && time - this.rightLastMove > ARR_RATE) {
        this.rightLastMove = time;
        this.tryMove(1, 0);
      }
    } else {
      this.rightHeldSince = 0;
    }

    // Soft drop
    if (this.keys.DOWN.isDown && time - this.softDropLast > SOFT_DROP_RATE) {
      this.softDropLast = time;
      if (this.tryMove(0, 1)) {
        this.score += 1;
        this.refreshChrome();
        this.gravityAccumulator = 0;
      }
    }

    // Rotação (UP ou X = CW, Z = CCW)
    if (justDown(this.keys.UP) || justDown(this.keys.X)) this.tryRotate(1);
    if (justDown(this.keys.Z)) this.tryRotate(-1);

    // Hard drop
    if (justDown(this.keys.SPACE)) this.hardDrop();

    // Hold
    if (justDown(this.keys.SHIFT) || justDown(this.keys.C)) this.tryHold();
  }

  // ---------- piece ops ----------

  private spawnNext() {
    const id = this.nextQueue.shift() ?? this.drawFromBag();
    this.refillQueue();
    this.spawnPiece(id);
  }

  private spawnPiece(id: PieceId) {
    const shape = SHAPES[id][0];
    this.active = {
      id,
      rotation: 0,
      x: Math.floor((COLS - shape[0].length) / 2),
      y: id === "I" ? -1 : 0, // I spawn ligeiramente mais alto
    };
    this.canHold = true;

    if (!this.isValidPosition(this.active)) {
      this.gameOver();
      return;
    }
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
  }

  private drawFromBag(): PieceId {
    if (this.bag.length === 0) {
      this.bag = ["I", "O", "T", "S", "Z", "J", "L"];
      // Fisher-Yates shuffle
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop()!;
  }

  private refillQueue() {
    while (this.nextQueue.length < 3) {
      this.nextQueue.push(this.drawFromBag());
    }
  }

  private tryMove(dx: number, dy: number): boolean {
    if (!this.active) return false;
    const newPos = { ...this.active, x: this.active.x + dx, y: this.active.y + dy };
    if (this.isValidPosition(newPos)) {
      this.active = newPos;
      this.lockTimer = 0;
      return true;
    }
    return false;
  }

  private tryRotate(direction: 1 | -1) {
    if (!this.active) return;
    const newRotation = (this.active.rotation + direction + 4) % 4;
    // Tenta wall kicks
    for (const [dx, dy] of WALL_KICKS) {
      const candidate = { ...this.active, rotation: newRotation, x: this.active.x + dx, y: this.active.y + dy };
      if (this.isValidPosition(candidate)) {
        this.active = candidate;
        this.lockTimer = 0;
        playTone(440, 30, "square", 0.06);
        return;
      }
    }
  }

  private isValidPosition(p: ActivePiece): boolean {
    const shape = SHAPES[p.id][p.rotation];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const boardX = p.x + c;
        const boardY = p.y + r;
        if (boardX < 0 || boardX >= COLS) return false;
        if (boardY >= ROWS) return false;
        if (boardY >= 0 && this.board[boardY][boardX] !== 0) return false;
      }
    }
    return true;
  }

  private isPieceLanded(): boolean {
    if (!this.active) return false;
    const test = { ...this.active, y: this.active.y + 1 };
    return !this.isValidPosition(test);
  }

  private fallOneStep() {
    if (!this.active) return;
    if (!this.tryMove(0, 1)) {
      // landed — lock delay will handle
    }
  }

  private hardDrop() {
    if (!this.active) return;
    let cells = 0;
    while (this.tryMove(0, 1)) cells++;
    this.score += cells * 2;
    this.refreshChrome();
    this.lockPiece();
  }

  private lockPiece() {
    if (!this.active) return;
    const shape = SHAPES[this.active.id][this.active.rotation];
    const colorIndex = PIECE_COLOR_INDEX[this.active.id];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        const boardX = this.active.x + c;
        const boardY = this.active.y + r;
        if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
          this.board[boardY][boardX] = colorIndex;
        }
      }
    }
    playTone(180, 60, "square", 0.08);

    // Check for full lines
    const fullRows: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      if (this.board[r].every((cell) => cell !== 0)) fullRows.push(r);
    }
    if (fullRows.length > 0) {
      this.clearingRows = fullRows;
      this.clearFlashTimer = 220;
      this.cameras.main.flash(80, 245, 100, 30, false);
    } else {
      this.spawnNext();
    }
  }

  private applyLineClears() {
    const n = this.clearingRows.length;
    // Score Nintendo: 40/100/300/1200 × (level+1)
    const scoreTable = [0, 40, 100, 300, 1200];
    this.score += scoreTable[n] * (this.level);
    this.lines += n;
    this.level = 1 + Math.floor(this.lines / 10);

    // Remove rows e dá shift pra baixo
    for (const r of this.clearingRows.sort((a, b) => a - b)) {
      this.board.splice(r, 1);
      this.board.unshift(new Array(COLS).fill(0));
    }

    this.clearingRows = [];
    this.refreshChrome();

    // Som específico
    if (n === 4) playTone(880, 200, "triangle", 0.16);
    else playTone(660, 120, "triangle", 0.12);

    this.spawnNext();
  }

  private tryHold() {
    if (!this.canHold || !this.active) return;
    const current = this.active.id;
    if (this.hold === null) {
      this.hold = current;
      this.spawnNext();
    } else {
      const prevHold = this.hold;
      this.hold = current;
      this.spawnPiece(prevHold);
    }
    this.canHold = false;
    playTone(330, 50, "square", 0.06);
  }

  // ---------- gravity speed ----------

  private gravityInterval(): number {
    // Tetris guideline-ish: gradient suave de 1000ms (lv1) até 50ms (lv20+)
    const level = Math.min(this.level, 20);
    return Math.max(50, 1000 - (level - 1) * 50);
  }

  // ---------- rendering ----------

  private initBoard() {
    this.board = [];
    for (let r = 0; r < ROWS; r++) {
      this.board.push(new Array(COLS).fill(0));
    }
  }

  private drawPlayfieldFrame() {
    // Frame ao redor do playfield
    const g = this.add.graphics();
    g.lineStyle(1, COLOR_HEX.fg, 0.4);
    g.strokeRect(PLAYFIELD_X - 2, PLAYFIELD_Y - 2, PLAYFIELD_W + 4, PLAYFIELD_H + 4);

    // Grid sutil
    g.lineStyle(1, COLOR_HEX.border, 0.6);
    for (let c = 1; c < COLS; c++) {
      g.lineBetween(PLAYFIELD_X + c * CELL, PLAYFIELD_Y, PLAYFIELD_X + c * CELL, PLAYFIELD_Y + PLAYFIELD_H);
    }
    for (let r = 1; r < ROWS; r++) {
      g.lineBetween(PLAYFIELD_X, PLAYFIELD_Y + r * CELL, PLAYFIELD_X + PLAYFIELD_W, PLAYFIELD_Y + r * CELL);
    }
  }

  private drawSidePanels() {
    // HOLD label
    this.add.text(50, 100, "HOLD", { ...TEXT_PRESETS.monoLabelFg, fontSize: "14px" });
    const g1 = this.add.graphics();
    g1.lineStyle(1, COLOR_HEX.border, 1);
    g1.strokeRect(50, 122, 4 * CELL + 4, 4 * CELL + 4);

    // SCORE
    this.add.text(50, 250, "SCORE", { ...TEXT_PRESETS.monoLabel, fontSize: "12px" });
    this.scoreText = this.add.text(50, 268, "000000", { ...TEXT_PRESETS.monoLabelFg, fontSize: "24px" });

    // LINES
    this.add.text(50, 320, "LINES", { ...TEXT_PRESETS.monoLabel, fontSize: "12px" });
    this.linesText = this.add.text(50, 338, "000", { ...TEXT_PRESETS.monoLabelFg, fontSize: "20px" });

    // LEVEL
    this.add.text(50, 380, "LEVEL", { ...TEXT_PRESETS.monoLabel, fontSize: "12px" });
    this.levelText = this.add.text(50, 398, "01", { ...TEXT_PRESETS.monoLabelFg, fontSize: "20px" });

    // NEXT label
    this.add.text(WIDTH - 50 - 4 * CELL - 4, 100, "NEXT", { ...TEXT_PRESETS.monoLabelFg, fontSize: "14px" });
    const g2 = this.add.graphics();
    g2.lineStyle(1, COLOR_HEX.border, 1);
    g2.strokeRect(WIDTH - 50 - 4 * CELL - 4, 122, 4 * CELL + 4, 3 * 4 * CELL + 30); // espaço pra 3 next
  }

  private drawChrome() {
    addCornerLabel(this, 22, 22, "/ 06", "TETRIS", false);
    createPulsingDot(this, WIDTH - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);

    this.add.text(22, HEIGHT - 22, "GAMEDEV.06 · CLÁSSICO", TEXT_PRESETS.hint).setOrigin(0, 1);
    this.add.text(WIDTH - 22, HEIGHT - 22, "← → ↓ ↑ ESPAÇO · SHIFT HOLD · P PAUSAR · K SCREENSHOT", TEXT_PRESETS.hint).setOrigin(1, 1);
  }

  private drawOverlay() {
    this.overlayBg = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, COLOR_HEX.bg, 0.82);
    this.overlayTitle = this.add
      .text(WIDTH / 2, HEIGHT / 2 - 40, "", TEXT_PRESETS.heroOutline)
      .setOrigin(0.5)
      .setFontSize("80px");
    this.overlayHint = this.add
      .text(WIDTH / 2, HEIGHT / 2 + 40, "", TEXT_PRESETS.hint)
      .setOrigin(0.5);
    this.hideOverlay();
  }

  private showOverlay(title: string, hint: string) {
    this.overlayBg.setVisible(true);
    this.overlayTitle.setVisible(true).setText(title);
    this.overlayHint.setVisible(true).setText(hint);
  }

  private hideOverlay() {
    this.overlayBg.setVisible(false);
    this.overlayTitle.setVisible(false);
    this.overlayHint.setVisible(false);
  }

  private refreshChrome() {
    this.scoreText.setText(String(this.score).padStart(6, "0"));
    this.linesText.setText(String(this.lines).padStart(3, "0"));
    this.levelText.setText(String(this.level).padStart(2, "0"));
  }

  private drawAll() {
    this.drawBoard();
    this.drawGhost();
    this.drawActive();
    this.drawHold();
    this.drawNext();
  }

  private drawCell(g: Phaser.GameObjects.Graphics, col: number, row: number, color: number, alpha = 1, originX = PLAYFIELD_X, originY = PLAYFIELD_Y, size = CELL) {
    if (color === 0) return;
    g.fillStyle(color, alpha);
    g.fillRect(originX + col * size + 1, originY + row * size + 1, size - 2, size - 2);
  }

  private drawBoard() {
    this.boardGraphics.clear();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = this.board[r][c];
        if (idx === 0) continue;
        this.drawCell(this.boardGraphics, c, r, INDEX_TO_COLOR[idx]);
      }
    }
  }

  private drawActive() {
    this.activeGraphics.clear();
    if (!this.active) return;
    const shape = SHAPES[this.active.id][this.active.rotation];
    const color = PIECE_COLORS[this.active.id];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        this.drawCell(this.activeGraphics, this.active.x + c, this.active.y + r, color);
      }
    }
  }

  private drawGhost() {
    this.ghostGraphics.clear();
    if (!this.active) return;
    // Encontra posição final via simulação
    let ghostY = this.active.y;
    while (this.isValidPosition({ ...this.active, y: ghostY + 1 })) ghostY++;
    if (ghostY === this.active.y) return; // já está no chão, não desenha ghost

    const shape = SHAPES[this.active.id][this.active.rotation];
    const color = PIECE_COLORS[this.active.id];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        this.drawCell(this.ghostGraphics, this.active.x + c, ghostY + r, color, 0.18);
      }
    }
  }

  private drawHold() {
    this.holdGraphics.clear();
    if (!this.hold) return;
    const shape = SHAPES[this.hold][0];
    const color = PIECE_COLORS[this.hold];
    const cell = 18;
    const baseX = 52 + (4 * cell - shape[0].length * cell) / 2;
    const baseY = 124 + (4 * cell - shape.length * cell) / 2;
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        this.holdGraphics.fillStyle(this.canHold ? color : COLOR_HEX.muted, this.canHold ? 1 : 0.5);
        this.holdGraphics.fillRect(baseX + c * cell + 1, baseY + r * cell + 1, cell - 2, cell - 2);
      }
    }
  }

  private drawNext() {
    this.nextGraphics.clear();
    const cell = 18;
    const baseX = WIDTH - 50 - 4 * cell - 2;
    let baseY = 124;
    for (let i = 0; i < 3 && i < this.nextQueue.length; i++) {
      const id = this.nextQueue[i];
      const shape = SHAPES[id][0];
      const color = PIECE_COLORS[id];
      const offsetX = baseX + (4 * cell - shape[0].length * cell) / 2;
      const offsetY = baseY + (4 * cell - shape.length * cell) / 2;
      for (let r = 0; r < shape.length; r++) {
        for (let c = 0; c < shape[r].length; c++) {
          if (!shape[r][c]) continue;
          this.nextGraphics.fillStyle(color, 1);
          this.nextGraphics.fillRect(offsetX + c * cell + 1, offsetY + r * cell + 1, cell - 2, cell - 2);
        }
      }
      baseY += 4 * cell + 10;
    }
  }

  private drawClearFlash() {
    this.flashGraphics.clear();
    const alpha = (this.clearFlashTimer / 220);
    for (const r of this.clearingRows) {
      this.flashGraphics.fillStyle(COLOR_HEX.fg, alpha);
      this.flashGraphics.fillRect(PLAYFIELD_X, PLAYFIELD_Y + r * CELL, PLAYFIELD_W, CELL);
    }
  }

  // ---------- game over ----------

  private gameOver() {
    this.state = "gameover";
    this.saveHighScore();
    playTone(180, 350, "sawtooth", 0.18);
    this.cameras.main.shake(300, 0.012);
    this.time.delayedCall(700, () => {
      this.scene.start("gameover", { score: this.score, lines: this.lines, level: this.level });
    });
  }

  private saveHighScore() {
    try {
      const raw = localStorage.getItem(HIGHSCORE_KEY);
      const prev = raw ? parseInt(raw, 10) : 0;
      if (this.score > prev) localStorage.setItem(HIGHSCORE_KEY, String(this.score));
    } catch {}
  }
}
