// $spire - the runtime module for bot scripts.
// The bot reference is set by bot-wrapper.ts before the user script is imported,
// so it is always available at import time in user code.

import type { Bot } from 'mineflayer'
import { Movements, goals } from 'mineflayer-pathfinder'

// --- Bot instance (live ESM binding, set before user script runs) ---

export let bot: Bot

export function _initSpire(b: Bot) {
  bot = b
  b.pathfinder.setMovements(new Movements(b))
}

// --- Re-exports ---

export const {
  Goal,
  GoalBlock,
  GoalNear,
  GoalXZ,
  GoalNearXZ,
  GoalY,
  GoalGetToBlock,
  GoalCompositeAny,
  GoalCompositeAll,
  GoalInvert,
  GoalFollow,
  GoalPlaceBlock,
  GoalLookAtBlock,
  GoalBreakBlock,
} = goals
