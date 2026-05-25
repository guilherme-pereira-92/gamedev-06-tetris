import Phaser from "phaser";
import { COLOR_HEX, TEXT_PRESETS, FONTS, COLORS } from "../theme";
import { drawDiagonalScanlines, createPulsingDot, addCornerLabel } from "../ui";
import { takeScreenshot } from "../screenshot";
import { playTone, unlockAudio } from "../audio";
import { isTouchDevice } from "../input";

const COLS = 10;
const ROWS = 20;

const DAS_DELAY = 160;
const ARR_RATE = 40;
const SOFT_DROP_RATE = 50;
const LOCK_DELAY = 500;

const HIGHSCORE_KEY = "gamedev-06-tetris-highscore";

type PieceId = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Cell = number;

const PIECE_COLORS: Record<PieceId, number> = {
  I: 0x00d4ff, O: 0xfbbf24, T: 0xc084fc, S: 0x7ad17a,
  Z: 0xef4444, J: 0x60a5fa, L: 0xff4500,
};

const PIECE_COLOR_INDEX: Record<PieceId, number> = {
  I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7,
};

const INDEX_TO_COLOR: number[] = [
  0, PIECE_COLORS.I, PIECE_COLORS.O, PIECE_COLORS.T,
  PIECE_COLORS.S, PIECE_COLORS.Z, PIECE_COLORS.J, PIECE_COLORS.L,
];

type Matrix = number[][];

const SHAPES: Record<PieceId, Matrix[]> = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ],
  O: [[[1,1],[1,1]],[[1,1],[1,1]],[[1,1],[1,1]],[[1,1],[1,1]]],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]], [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]], [[0,1,0],[1,1,0],[0,1,0]],
  ],
  S: [
    [[0,1,1],[1,1,0],[0,0,0]], [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]], [[1,0,0],[1,1,0],[0,1,0]],
  ],
  Z: [
    [[1,1,0],[0,1,1],[0,0,0]], [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]], [[0,1,0],[1,1,0],[1,0,0]],
  ],
  J: [
    [[1,0,0],[1,1,1],[0,0,0]], [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]], [[0,1,0],[0,1,0],[1,1,0]],
  ],
  L: [
    [[0,0,1],[1,1,1],[0,0,0]], [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]], [[1,1,0],[0,1,0],[0,1,0]],
  ],
};

const WALL_KICKS: Array<[number, number]> = [
  [0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0],
];

interface ActivePiece {
  id: PieceId;
  rotation: number;
  x: number;
  y: number;
}

interface Layout {
  cell: number;
  pfX: number;
  pfY: number;
  pfW: number;
  pfH: number;
  holdX: number;
  holdY: number;
  holdSize: number;
  nextX: number;
  nextY: number;
  nextSize: number;
  nextCount: number;
  statsX: number;
  statsY: number;
  scoreFontSize: number;
  portrait: boolean;
}

type GameState = "playing" | "paused" | "gameover";

export class TetrisScene extends Phaser.Scene {
  private board: Cell[][] = [];
  private active: ActivePiece | null = null;
  private hold: PieceId | null = null;
  private canHold = true;
  private nextQueue: PieceId[] = [];
  private bag: PieceId[] = [];

  private bg!: Phaser.GameObjects.Rectangle;
  private scanlines!: Phaser.GameObjects.Graphics;
  private frameGraphics!: Phaser.GameObjects.Graphics;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private boardGraphics!: Phaser.GameObjects.Graphics;
  private activeGraphics!: Phaser.GameObjects.Graphics;
  private ghostGraphics!: Phaser.GameObjects.Graphics;
  private holdGraphics!: Phaser.GameObjects.Graphics;
  private nextGraphics!: Phaser.GameObjects.Graphics;
  private flashGraphics!: Phaser.GameObjects.Graphics;

  private chromeTexts: Phaser.GameObjects.Text[] = [];
  private scoreText!: Phaser.GameObjects.Text;
  private linesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private holdLabel!: Phaser.GameObjects.Text;
  private nextLabel!: Phaser.GameObjects.Text;

  private overlayBg!: Phaser.GameObjects.Rectangle;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayHint!: Phaser.GameObjects.Text;

  private score = 0;
  private lines = 0;
  private level = 1;
  private state: GameState = "playing";
  private layout!: Layout;

  private gravityAccumulator = 0;
  private lockTimer = 0;
  private clearingRows: number[] = [];
  private clearFlashTimer = 0;

  private leftHeldSince = 0;
  private leftLastMove = 0;
  private rightHeldSince = 0;
  private rightLastMove = 0;
  private softDropLast = 0;

  private keys!: Record<
    "LEFT" | "RIGHT" | "UP" | "DOWN" | "Z" | "X" | "C" | "SHIFT" | "SPACE" | "P" | "ESC" | "K",
    Phaser.Input.Keyboard.Key
  >;

  constructor() { super("game"); }

  create() {
    this.layout = this.computeLayout();

    this.bg = this.add.rectangle(0, 0, this.scale.width, this.scale.height, COLOR_HEX.bg);
    this.bg.setOrigin(0, 0);
    this.scanlines = drawDiagonalScanlines(this, this.scale.width, this.scale.height, 18, 0.04);

    this.initBoard();

    this.frameGraphics = this.add.graphics();
    this.gridGraphics = this.add.graphics();
    this.boardGraphics = this.add.graphics();
    this.ghostGraphics = this.add.graphics();
    this.activeGraphics = this.add.graphics();
    this.holdGraphics = this.add.graphics();
    this.nextGraphics = this.add.graphics();
    this.flashGraphics = this.add.graphics();

    this.drawChrome();
    this.drawSidePanels();
    this.drawPlayfieldFrame();
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

    this.setupTouchControls();
    this.spawnNext();
    this.refreshChrome();
    this.drawAll();

    this.scale.on("resize", this.onResize, this);
    this.events.once("shutdown", () => this.scale.off("resize", this.onResize, this));
  }

  // ---------- responsive layout ----------

  private computeLayout(): Layout {
    const W = this.scale.width;
    const H = this.scale.height;
    const portrait = H > W;
    let cell: number;
    let pfX: number, pfY: number;
    let holdX: number, holdY: number, holdSize: number;
    let nextX: number, nextY: number, nextSize: number, nextCount: number;
    let statsX: number, statsY: number;
    let scoreFontSize: number;

    if (portrait) {
      // PORTRAIT: playfield grande no centro, panels acima e abaixo
      // - top: HOLD (esq) + NEXT (dir) + stats no meio
      // - playfield: middle
      // - bottom: hint
      const topReserved = 110; // espaço pra HOLD/NEXT no topo
      const bottomReserved = 60; // espaço pra hint/touch hint
      const availableH = H - topReserved - bottomReserved;
      const cellByH = availableH / ROWS;
      const cellByW = (W * 0.92) / COLS;
      cell = Math.floor(Math.min(cellByH, cellByW));
      const pfW = cell * COLS;
      const pfH = cell * ROWS;
      pfX = (W - pfW) / 2;
      pfY = topReserved + (availableH - pfH) / 2;

      // HOLD top-left
      holdSize = Math.min(20, cell * 0.85);
      holdX = 22;
      holdY = 56;

      // NEXT top-right (apenas 1 next em portrait pra caber)
      nextSize = holdSize;
      nextCount = 1;
      nextX = W - 22 - 4 * nextSize;
      nextY = 56;

      // Stats no centro entre HOLD e NEXT
      statsX = W / 2;
      statsY = 50;
      scoreFontSize = Math.min(22, W * 0.05);
    } else {
      // LANDSCAPE: layout clássico — playfield centro, HOLD esq, NEXT dir
      const topReserved = 60;
      const bottomReserved = 50;
      const availableH = H - topReserved - bottomReserved;
      const cellByH = availableH / ROWS;
      const cellByW = (W * 0.4) / COLS; // playfield ocupa 40% da largura, deixa espaço pros panels
      cell = Math.floor(Math.min(cellByH, cellByW));
      const pfW = cell * COLS;
      const pfH = cell * ROWS;
      pfX = (W - pfW) / 2;
      pfY = topReserved + (availableH - pfH) / 2;

      // HOLD left of playfield
      holdSize = Math.max(14, cell * 0.85);
      holdX = pfX - 4 * holdSize - 32;
      holdY = pfY + 40;

      // NEXT right of playfield (até 3 next)
      nextSize = holdSize;
      nextCount = 3;
      nextX = pfX + pfW + 32;
      nextY = pfY + 40;

      // Stats embaixo do hold
      statsX = holdX + 2 * holdSize;
      statsY = holdY + 4 * holdSize + 30;
      scoreFontSize = 24;
    }

    return { cell, pfX, pfY, pfW: cell * COLS, pfH: cell * ROWS,
      holdX, holdY, holdSize, nextX, nextY, nextSize, nextCount,
      statsX, statsY, scoreFontSize, portrait };
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.bg.setSize(gameSize.width, gameSize.height);
    this.scanlines.destroy();
    this.scanlines = drawDiagonalScanlines(this, gameSize.width, gameSize.height, 18, 0.04);
    this.layout = this.computeLayout();
    this.drawChrome();
    this.drawSidePanels();
    this.drawPlayfieldFrame();
    this.drawAll();
  }

  // ---------- update loop ----------

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

    if (this.state !== "playing" || !this.active) return;

    if (this.clearingRows.length > 0) {
      this.clearFlashTimer -= delta;
      this.drawClearFlash();
      if (this.clearFlashTimer <= 0) this.applyLineClears();
      return;
    }

    this.handleInput(time);

    const gravityMs = this.gravityInterval();
    this.gravityAccumulator += delta;
    while (this.gravityAccumulator >= gravityMs) {
      this.gravityAccumulator -= gravityMs;
      this.fallOneStep();
    }

    if (this.isPieceLanded()) {
      this.lockTimer += delta;
      if (this.lockTimer >= LOCK_DELAY) this.lockPiece();
    } else {
      this.lockTimer = 0;
    }

    this.drawAll();
  }

  // ---------- input ----------

  private handleInput(time: number) {
    const justDown = Phaser.Input.Keyboard.JustDown;

    if (this.keys.LEFT.isDown) {
      if (this.leftHeldSince === 0) { this.leftHeldSince = time; this.leftLastMove = time; this.tryMove(-1, 0); }
      else if (time - this.leftHeldSince > DAS_DELAY && time - this.leftLastMove > ARR_RATE) {
        this.leftLastMove = time; this.tryMove(-1, 0);
      }
    } else this.leftHeldSince = 0;

    if (this.keys.RIGHT.isDown) {
      if (this.rightHeldSince === 0) { this.rightHeldSince = time; this.rightLastMove = time; this.tryMove(1, 0); }
      else if (time - this.rightHeldSince > DAS_DELAY && time - this.rightLastMove > ARR_RATE) {
        this.rightLastMove = time; this.tryMove(1, 0);
      }
    } else this.rightHeldSince = 0;

    if (this.keys.DOWN.isDown && time - this.softDropLast > SOFT_DROP_RATE) {
      this.softDropLast = time;
      if (this.tryMove(0, 1)) { this.score += 1; this.refreshChrome(); this.gravityAccumulator = 0; }
    }

    if (justDown(this.keys.UP) || justDown(this.keys.X)) this.tryRotate(1);
    if (justDown(this.keys.Z)) this.tryRotate(-1);
    if (justDown(this.keys.SPACE)) this.hardDrop();
    if (justDown(this.keys.SHIFT) || justDown(this.keys.C)) this.tryHold();
  }

  private setupTouchControls() {
    // Touch: swipe horizontal = move, swipe down longa = hard drop,
    // swipe down curto = soft drop, swipe up = hold, tap = rotate.
    let startX = 0, startY = 0, startTime = 0, tracking = false;
    let lastSoftDrop = 0;

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      startX = pointer.x; startY = pointer.y;
      startTime = this.time.now;
      tracking = true;
      lastSoftDrop = this.time.now;
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!tracking || !pointer.isDown || !this.active) return;
      const now = this.time.now;
      const dx = pointer.x - startX;
      const dy = pointer.y - startY;
      const cell = this.layout.cell;

      // Move horizontal: cada cell de drag = 1 step
      if (Math.abs(dx) >= cell * 0.8) {
        const steps = Math.trunc(dx / (cell * 0.8));
        for (let i = 0; i < Math.abs(steps); i++) {
          this.tryMove(steps > 0 ? 1 : -1, 0);
        }
        startX = pointer.x;
      }

      // Soft drop ao arrastar pra baixo (continuo)
      if (dy > cell * 0.8 && now - lastSoftDrop > SOFT_DROP_RATE) {
        if (this.tryMove(0, 1)) {
          this.score += 1; this.refreshChrome(); this.gravityAccumulator = 0;
        }
        lastSoftDrop = now;
        startY = pointer.y; // reset pra continuar swipe
      }
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (!tracking) return;
      tracking = false;
      if (!this.active) return;
      const dx = pointer.x - startX;
      const dy = pointer.y - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const duration = this.time.now - startTime;

      // Tap rápido sem mover muito = rotate
      if (dist < 15 && duration < 250) {
        this.tryRotate(1);
        return;
      }

      // Swipe pra cima = hold
      if (dy < -60 && Math.abs(dy) > Math.abs(dx) && duration < 400) {
        this.tryHold();
        return;
      }

      // Swipe pra baixo rápido = hard drop
      if (dy > 100 && Math.abs(dy) > Math.abs(dx) && duration < 250) {
        this.hardDrop();
        return;
      }
    });
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
      id, rotation: 0,
      x: Math.floor((COLS - shape[0].length) / 2),
      y: id === "I" ? -1 : 0,
    };
    this.canHold = true;
    if (!this.isValidPosition(this.active)) { this.gameOver(); return; }
    this.gravityAccumulator = 0;
    this.lockTimer = 0;
  }

  private drawFromBag(): PieceId {
    if (this.bag.length === 0) {
      this.bag = ["I", "O", "T", "S", "Z", "J", "L"];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop()!;
  }

  private refillQueue() {
    while (this.nextQueue.length < 3) this.nextQueue.push(this.drawFromBag());
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
    return !this.isValidPosition({ ...this.active, y: this.active.y + 1 });
  }

  private fallOneStep() {
    if (!this.active) return;
    this.tryMove(0, 1);
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
    const scoreTable = [0, 40, 100, 300, 1200];
    this.score += scoreTable[n] * this.level;
    this.lines += n;
    this.level = 1 + Math.floor(this.lines / 10);

    for (const r of this.clearingRows.sort((a, b) => a - b)) {
      this.board.splice(r, 1);
      this.board.unshift(new Array(COLS).fill(0));
    }
    this.clearingRows = [];
    this.refreshChrome();
    if (n === 4) playTone(880, 200, "triangle", 0.16);
    else playTone(660, 120, "triangle", 0.12);
    this.spawnNext();
  }

  private tryHold() {
    if (!this.canHold || !this.active) return;
    const current = this.active.id;
    if (this.hold === null) { this.hold = current; this.spawnNext(); }
    else { const prevHold = this.hold; this.hold = current; this.spawnPiece(prevHold); }
    this.canHold = false;
    playTone(330, 50, "square", 0.06);
  }

  private gravityInterval(): number {
    const level = Math.min(this.level, 20);
    return Math.max(50, 1000 - (level - 1) * 50);
  }

  // ---------- rendering ----------

  private initBoard() {
    this.board = [];
    for (let r = 0; r < ROWS; r++) this.board.push(new Array(COLS).fill(0));
  }

  private drawPlayfieldFrame() {
    this.frameGraphics.clear();
    this.frameGraphics.lineStyle(1, COLOR_HEX.fg, 0.4);
    this.frameGraphics.strokeRect(this.layout.pfX - 2, this.layout.pfY - 2, this.layout.pfW + 4, this.layout.pfH + 4);

    this.gridGraphics.clear();
    this.gridGraphics.lineStyle(1, COLOR_HEX.border, 0.6);
    for (let c = 1; c < COLS; c++) {
      this.gridGraphics.lineBetween(this.layout.pfX + c * this.layout.cell, this.layout.pfY,
        this.layout.pfX + c * this.layout.cell, this.layout.pfY + this.layout.pfH);
    }
    for (let r = 1; r < ROWS; r++) {
      this.gridGraphics.lineBetween(this.layout.pfX, this.layout.pfY + r * this.layout.cell,
        this.layout.pfX + this.layout.pfW, this.layout.pfY + r * this.layout.cell);
    }
  }

  private drawSidePanels() {
    // Destroy previous panel texts/labels
    if (this.holdLabel) this.holdLabel.destroy();
    if (this.nextLabel) this.nextLabel.destroy();
    if (this.scoreText) this.scoreText.destroy();
    if (this.linesText) this.linesText.destroy();
    if (this.levelText) this.levelText.destroy();

    const L = this.layout;
    this.holdLabel = this.add.text(L.holdX, L.holdY - 22, "HOLD", { ...TEXT_PRESETS.monoLabelFg, fontSize: "12px" });
    this.nextLabel = this.add.text(L.nextX, L.nextY - 22, "NEXT", { ...TEXT_PRESETS.monoLabelFg, fontSize: "12px" });

    if (L.portrait) {
      // Stats em linha horizontal no topo entre hold e next
      this.scoreText = this.add.text(L.statsX, L.statsY, "000000", { fontFamily: FONTS.mono, fontSize: `${L.scoreFontSize}px`, color: COLORS.fg, fontStyle: "500" }).setOrigin(0.5);
      this.linesText = this.add.text(L.statsX, L.statsY + L.scoreFontSize + 2, "lines 0 · lv 1", { ...TEXT_PRESETS.hint, fontSize: "11px" }).setOrigin(0.5);
      this.levelText = this.add.text(0, 0, "", { fontSize: "1px" }); // dummy invisible (level já no linesText)
      this.levelText.setVisible(false);
    } else {
      // Landscape: stacked vertical
      this.add.text(L.statsX, L.statsY - 20, "SCORE", { ...TEXT_PRESETS.monoLabel, fontSize: "10px" }).setOrigin(0.5);
      this.scoreText = this.add.text(L.statsX, L.statsY, "000000", { fontFamily: FONTS.mono, fontSize: `${L.scoreFontSize}px`, color: COLORS.fg, fontStyle: "500" }).setOrigin(0.5);
      this.add.text(L.statsX, L.statsY + 36, "LINES", { ...TEXT_PRESETS.monoLabel, fontSize: "10px" }).setOrigin(0.5);
      this.linesText = this.add.text(L.statsX, L.statsY + 52, "000", { fontFamily: FONTS.mono, fontSize: "18px", color: COLORS.fg }).setOrigin(0.5);
      this.add.text(L.statsX, L.statsY + 82, "LEVEL", { ...TEXT_PRESETS.monoLabel, fontSize: "10px" }).setOrigin(0.5);
      this.levelText = this.add.text(L.statsX, L.statsY + 98, "01", { fontFamily: FONTS.mono, fontSize: "18px", color: COLORS.fg }).setOrigin(0.5);
    }
  }

  private drawChrome() {
    // Destroy existing chrome
    for (const t of this.chromeTexts) t.destroy();
    this.chromeTexts = [];

    const W = this.scale.width;
    const H = this.scale.height;
    const labels = addCornerLabel(this, 22, 22, "/ 06", "TETRIS", false);
    if (labels.accentText) this.chromeTexts.push(labels.accentText);
    this.chromeTexts.push(labels.mainText);
    createPulsingDot(this, W - 22 - 4, 22 + 6, 4, COLOR_HEX.accent);

    this.chromeTexts.push(
      this.add.text(22, H - 22, "GAMEDEV.06", TEXT_PRESETS.hint).setOrigin(0, 1)
    );
    this.chromeTexts.push(
      this.add.text(W - 22, H - 22, isTouchDevice()
        ? "ARRASTE ↔ MOVER · TAP ROTAÇÃO · ↓ DROP · ↑ HOLD"
        : "← → ↓ ↑ ESPAÇO · SHIFT HOLD · P PAUSAR · K", TEXT_PRESETS.hint).setOrigin(1, 1)
    );
  }

  private drawOverlay() {
    if (this.overlayBg) this.overlayBg.destroy();
    if (this.overlayTitle) this.overlayTitle.destroy();
    if (this.overlayHint) this.overlayHint.destroy();
    const W = this.scale.width;
    const H = this.scale.height;
    this.overlayBg = this.add.rectangle(W / 2, H / 2, W, H, COLOR_HEX.bg, 0.82);
    this.overlayTitle = this.add.text(W / 2, H / 2 - 40, "", TEXT_PRESETS.heroOutline).setOrigin(0.5).setFontSize("80px");
    this.overlayHint = this.add.text(W / 2, H / 2 + 40, "", TEXT_PRESETS.hint).setOrigin(0.5);
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
    if (this.layout.portrait) {
      this.linesText.setText(`lines ${this.lines} · lv ${this.level}`);
    } else {
      this.linesText.setText(String(this.lines).padStart(3, "0"));
      this.levelText.setText(String(this.level).padStart(2, "0"));
    }
  }

  private drawAll() {
    this.drawBoard();
    this.drawGhost();
    this.drawActive();
    this.drawHold();
    this.drawNext();
  }

  private drawCell(g: Phaser.GameObjects.Graphics, col: number, row: number, color: number, alpha = 1) {
    if (color === 0) return;
    g.fillStyle(color, alpha);
    g.fillRect(this.layout.pfX + col * this.layout.cell + 1,
               this.layout.pfY + row * this.layout.cell + 1,
               this.layout.cell - 2, this.layout.cell - 2);
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
    let ghostY = this.active.y;
    while (this.isValidPosition({ ...this.active, y: ghostY + 1 })) ghostY++;
    if (ghostY === this.active.y) return;
    const shape = SHAPES[this.active.id][this.active.rotation];
    const color = PIECE_COLORS[this.active.id];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        this.drawCell(this.ghostGraphics, this.active.x + c, ghostY + r, color, 0.2);
      }
    }
  }

  private drawHold() {
    this.holdGraphics.clear();
    if (!this.hold) return;
    const shape = SHAPES[this.hold][0];
    const color = PIECE_COLORS[this.hold];
    const cell = this.layout.holdSize;
    const baseX = this.layout.holdX + (4 * cell - shape[0].length * cell) / 2;
    const baseY = this.layout.holdY + (4 * cell - shape.length * cell) / 2;
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
    const cell = this.layout.nextSize;
    let baseY = this.layout.nextY;
    const count = Math.min(this.layout.nextCount, this.nextQueue.length);
    for (let i = 0; i < count; i++) {
      const id = this.nextQueue[i];
      const shape = SHAPES[id][0];
      const color = PIECE_COLORS[id];
      const offsetX = this.layout.nextX + (4 * cell - shape[0].length * cell) / 2;
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
    const alpha = this.clearFlashTimer / 220;
    for (const r of this.clearingRows) {
      this.flashGraphics.fillStyle(COLOR_HEX.fg, alpha);
      this.flashGraphics.fillRect(this.layout.pfX, this.layout.pfY + r * this.layout.cell,
        this.layout.pfW, this.layout.cell);
    }
  }

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
