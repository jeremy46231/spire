export function onInit(bot) {
  console.log('Bot initialized!')
  bot.look(Math.random() * Math.PI * 2, 0)

  // Simple demo: look around and walk forward
  setInterval(() => {
    // console.log("Looking around...")
    bot.look(Math.random() * Math.PI * 2, 0)
  }, 3000)

  // log messages in chat to console
  bot.on('chat', (username, message) => {
    console.log(`[chat] <${username}> ${message}`)
  })

  // bot.setControlState('forward', true)
  // setTimeout(() => bot.setControlState('forward', false), 2000)
}
