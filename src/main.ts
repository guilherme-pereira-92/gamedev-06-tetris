import Phaser from "phaser";
import { MenuScene } from "./scenes/MenuScene";
import { TetrisScene } from "./scenes/TetrisScene";
import { GameOverScene } from "./scenes/GameOverScene";
import { COLORS, FONT_NAMES } from "./theme";

async function bootstrap() {
  try {
    await Promise.all([
      document.fonts.load(`16px "${FONT_NAMES.mono}"`),
      document.fonts.load(`64px "${FONT_NAMES.display}"`),
    ]);
  } catch {}

  new Phaser.Game({
    type: Phaser.AUTO,
    backgroundColor: COLORS.bg,
    parent: "game",
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: "100%",
      height: "100%",
    },
    input: { activePointers: 3 },
    scene: [MenuScene, TetrisScene, GameOverScene],
  });
}

void bootstrap();
