import { bot, GoalNearXZ } from '$spire'

function walkToRandom() {
  const x = Math.floor(Math.random() * 31) - 15
  const z = Math.floor(Math.random() * 31) - 15
  bot.pathfinder.setGoal(new GoalNearXZ(x, z, 1))
}

setInterval(() => {
  if (!bot.pathfinder.goal) walkToRandom()
}, 500)
