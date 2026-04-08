export function onInit(bot) {
  setInterval(() => {
    bot.look(Math.random() * Math.PI * 2, 0)
  }, 1000)
}
