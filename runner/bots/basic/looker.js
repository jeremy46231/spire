import { bot } from '$spire'

setInterval(() => {
  bot.look(Math.random() * Math.PI * 2, 0)
}, 1000)
