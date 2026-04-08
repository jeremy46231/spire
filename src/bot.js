import { Movements, goals } from 'mineflayer-pathfinder'

export function onInit(bot) {
  console.log('Bot initialized!')

  const defaultMove = new Movements(bot)
  let currentTarget = null
  let lastAttackAt = 0

  function getNearestSurvivalPlayerEntity() {
    let nearest = null
    let nearestDistance = Infinity

    for (const player of Object.values(bot.players)) {
      if (!player?.entity) continue
      if (player.username === bot.username) continue

      // In vanilla, 0 is survival mode. If gamemode is unknown, treat as valid.
      if (typeof player.gamemode === 'number' && player.gamemode !== 0) continue

      const distance = bot.entity.position.distanceTo(player.entity.position)
      if (distance < nearestDistance) {
        nearest = player.entity
        nearestDistance = distance
      }
    }

    return nearest
  }

  function retarget() {
    if (!bot.entity) return

    const target = getNearestSurvivalPlayerEntity()
    if (!target) {
      // console.log('No valid target found, clearing path')

      currentTarget = null
      bot.pathfinder.setGoal(null)
      return
    }

    if (currentTarget?.id !== target.id || !currentTarget.isValid) {
      console.log(`New target: ${target.username} at ${target.position}`)

      currentTarget = target
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true)
    }
  }

  bot.on('physicsTick', () => {
    if (!currentTarget || !currentTarget.isValid) return

    const distance = bot.entity.position.distanceTo(currentTarget.position)
    const now = Date.now()

    if (distance <= 3.5 && now - lastAttackAt >= 500) {
      lastAttackAt = now
      bot.lookAt(
        currentTarget.position.offset(0, currentTarget.height ?? 1.6, 0),
        true
      )
      bot.attack(currentTarget)
    }
  })

  // log messages in chat to console
  bot.on('chat', (username, message) => {
    console.log(`[chat] <${username}> ${message}`)
  })

  bot.pathfinder.setMovements(defaultMove)
  setInterval(retarget, 1000)
}
