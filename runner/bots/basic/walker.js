import { Movements, goals } from 'mineflayer-pathfinder'

export function onInit(bot) {
  const defaultMove = new Movements(bot)
  bot.pathfinder.setMovements(defaultMove)

  function walkToRandom() {
    // from -7 to 7 inclusive
    const x = Math.floor(Math.random() * 15) - 7
    const z = Math.floor(Math.random() * 15) - 7
    console.log(`Walking to ${x}, ${z}`)
    bot.pathfinder.setGoal(new goals.GoalNearXZ(x, z, 0.5))
  }

  setInterval(() => {
    if (!bot.entity) return
    if (!bot.pathfinder.goal) walkToRandom()
  }, 500)  
}
