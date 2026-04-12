import { bot, GoalNearXZ } from '$spire'

let lastAttackAt = 0

function getNearestSurvivalPlayerEntity() {
  let nearest = null
  let nearestDistance = Infinity

  for (const player of Object.values(bot.players)) {
    if (!player?.entity) continue
    if (player.username === bot.username) continue
    if (typeof player.gamemode === 'number' && player.gamemode !== 0) continue

    const distance = bot.entity.position.distanceTo(player.entity.position)
    if (distance < nearestDistance) {
      nearest = player.entity
      nearestDistance = distance
    }
  }

  return nearest
}

// Stay near the center
setInterval(() => {
  if (!bot.entity) return
  if (!bot.pathfinder.goal) {
    bot.pathfinder.setGoal(new GoalNearXZ(0, 0, 2))
  }
}, 1000)

// Attack nearby survival players
bot.on('physicsTick', () => {
  if (!bot.entity) return

  const target = getNearestSurvivalPlayerEntity()
  if (!target) return

  const distance = bot.entity.position.distanceTo(target.position)
  const now = Date.now()

  if (distance <= 3.5 && now - lastAttackAt >= 500) {
    lastAttackAt = now
    bot.lookAt(target.position.offset(0, target.height ?? 1.6, 0), true)
    bot.attack(target)
  }
})
