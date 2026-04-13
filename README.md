<a href="https://hackclub.com"><img align="right" width="113.5" height="64" src="https://assets.hackclub.com/flag-orpheus-top.svg" alt="Hack Club logo"/></a>

# Spire

### [Get Started](https://github.com/codespaces/new?repo=1203478974&machine=standardLinux32gb&geo=UsWest&hide_repo_select=true&skip_quickstart=true)

Get started with GitHub Codespaces by clicking the link above.

> [!NOTE]
> The prebuilt codespace is only stored in the US West region, and it might be very slow if you create a codespace in another region. When this event is run for real, it will be available in all regions and be more optimized. If speed is an issue, consider setting it up locally (see below).

### Local Setup

- [Fork this repo](https://github.com/jeremy46231/spire/fork), and clone it locally
- Make sure you have [Bun](https://bun.com/docs/installation) and [Java](https://docs.papermc.io/misc/java-install) (21 or newer) available
- Run `bun i && bun setup` to set up the dependencies
- Run `bun start` to start the server
  - The web interface is at [localhost:3000](http://localhost:3000)
  - Connect to the Minecraft server at `localhost:25565`
  - Admin console on the web interface or `bun console`
  - Stop with `bun stop`
