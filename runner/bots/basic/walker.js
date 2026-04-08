import { Movements, goals } from 'mineflayer-pathfinder'

export function onInit(bot) {
  const defaultMove = new Movements(bot)
  bot.pathfinder.setMovements(defaultMove)

  function walkToRandom() {
    const x = Math.floor(Math.random() * 31) - 15
    const z = Math.floor(Math.random() * 31) - 15
    console.log(`Walking to ${x}, ${z}`)
    bot.pathfinder.setGoal(new goals.GoalNearXZ(x, z, 1))
  }

  setInterval(() => {
    if (!bot.entity) return
    if (!bot.pathfinder.goal) walkToRandom()
  }, 500)  
}
