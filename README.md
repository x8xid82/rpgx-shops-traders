# RPGX Shops & Traders

Build living shops for your Foundry VTT world. Create businesses, assign shopkeepers, stock inventory, and let your players browse, buy, sell, and haggle, all from a dedicated shop window that syncs live across every connected client.

Part of the **RPGX Toolbelt** by RPGX Studios / X8 Studios.

## Features

- **Business creation**: set up a shop as its own Actor, with a name, business type, location, description, and GM-only notes. New businesses are organized automatically into a "Businesses" folder, with a subfolder for each Location.
- **Shopkeepers**: drag one or more NPC Actors onto a business to assign them as shopkeepers. If more than one is assigned, a shopkeeper is chosen at random for each visit, and the GM can reroll at any time.
- **A real shop window**: players open a shop from a floating button or by clicking the business's token on the canvas. Inside, they can browse inventory, pay for services, sell loot from their own character sheet, and check out, with live totals based on their character's actual funds.
- **Haggling**: a one-click "Haggle" button sends a whispered request to the GM to call for a Persuasion check (or whatever your table uses), so the GM can apply a temporary price modifier.
- **Full GM controls**: edit stock counts inline, mark individual items as unlimited stock, restock everything back to starting quantities with one click, reroll the active shopkeeper, set a flat haggle modifier, and remove items from a shop entirely.
- **Default inventory lists**: build reusable, named lists of items and quantities (a "General Store" stock list, a "Blacksmith" stock list, and so on), then apply one as the starting inventory whenever you create a new business.
- **AI-assisted generation**: with RPGX Proton running, generate a shop's name, type, description, and GM notes with one click, written to match your world's game system and genre, and checked against your existing shop names so it won't generate a duplicate.
- **Currency handling**: prices and totals are automatically converted and displayed in your world's currency (gp/sp/cp by default), and each business can override the default buyback rate for sold loot.
- **Built for multiplayer**: players only ever have read access to a business's inventory. Every purchase, sale, and haggle request is relayed through an online GM's client, so nothing requires giving players edit permissions on shop Actors.

## Requirements

- Foundry VTT v12 or later (verified on v14)
- Built and tested for the dnd5e system, currency and stock handling assume dnd5e's data model
- Optional: [RPGX Proton](https://www.rpgxstudios.com), a free local desktop companion app, required for AI-assisted shop generation

## Installation

Search for "RPGX Shops & Traders" in Foundry's built-in module browser, or install manually using this manifest URL:

```
https://github.com/x8xid82/rpgx-shops-traders/releases/latest/download/module.json
```

## Getting Started

1. Enable the module in your world.
2. Click the floating cart button in the bottom corner of the screen to open the RPGX Shops & Traders menu.
3. Click **New Business**.
4. Fill in the business's name, type, location, description, and GM notes. To assign a shopkeeper, drag an NPC Actor into the Shopkeeper(s) box (drag in more than one for a random rotation).
5. Optionally, choose a Starting Inventory list to pre-fill the shop's stock.
6. If RPGX Proton is running, click **Generate with AI** to write the shop's flavor text for you. Review and edit anything before saving.
7. Click Save. The business appears as an Actor in your Businesses folder, sorted into a subfolder by Location.

From here, players can open the shop from the floating button, or by double-clicking the business's token on the canvas.

## Default Inventory Lists

Open **Settings > Manage Default Inventories** to build reusable stock lists:

- Create as many named lists as you like.
- Drag items into a list from a compendium, a character, or anywhere else, and set how many of each should be in stock.
- Mark one list with the star icon to make it the default suggestion when creating a new business.

Applying a list to a new business copies its items and quantities onto that business's inventory as a starting point, the list itself is left untouched and can be reused for the next shop.

## The Shop Window

**For players:**

- **Inventory**: browse what's for sale, see prices and how much is in stock, and add items to your cart.
- **Services**: pay for flat-rate services the business offers (room and board, repairs, training, and so on).
- **Sell Loot**: drag items from your character sheet here to sell them back to the shop.
- **Shopping as**: if you control more than one character, choose which one is doing the shopping.
- **Haggle**: ask the GM for a check to try to get a better price.

**For GMs**, everything above plus:

- Inline editing of every item's stock count.
- An "unlimited stock" toggle per item, useful for items a system won't let you stack past one (see Known Limitations).
- **Restock All**, which resets every item back to the quantity it had when first added to the shop.
- Rerolling the active shopkeeper.
- A haggle modifier, a flat percentage applied to every price in the shop.
- Removing an item from the shop entirely (it won't come back on Restock).

## AI-Assisted Shop Generation

With RPGX Proton running and connected, the **Generate with AI** button writes a shop's name, business type, description, and GM notes in one pass. Generation takes into account:

- Your world's configured Game System and Campaign Genre (set in this module's settings)
- Whatever Business Type and Location you've already entered
- The names of your existing shops, so the result won't be a duplicate or a near match

Generation runs entirely through your local RPGX Proton instance. No world data is sent anywhere outside your own machine.

## Settings

- **RPGX Proton URL / Auth Token**: connection details for your local Proton instance.
- **Game System / Campaign Genre**: free-text context used to steer AI generation.
- **AI Model Tier / Generation Timeout / Creativity**: tune AI generation for your hardware and how predictable or wild you want results to be.
- **Default Buyback Rate**: the percentage of an item's value a shop pays when buying loot from a player, unless a business overrides it.
- **Manage Default Inventories**: opens the default inventory list editor described above.

## Free vs. Pro

- **Free**: up to 3 businesses.
- **Pro**: unlimited businesses, plus AI-assisted shop generation, unlocked with an active RPGX Proton subscription.

## Known Limitations

Some item types, most notably dnd5e's "Container" items such as Backpacks, Barrels, and Bags of Holding, can't be held in a stack of more than one. This is enforced by the game system itself and isn't something this module can override. If you want a shop to appear to sell several of one of these, toggle that item's "Unlimited" stock instead of relying on a stock count.

## Support and Community

- Website: [rpgxstudios.com](https://www.rpgxstudios.com)
- Patreon: [patreon.com/c/rpgxstudios](https://www.patreon.com/c/rpgxstudios)
- Discord: [discord.gg/9PAuuDVUZJ](https://discord.gg/9PAuuDVUZJ)
- Found a bug? Use the in-app "Report a Bug" button, or open an issue on GitHub.

## Other RPGX Toolbelt Modules

- [RPGX AI Assistant](https://github.com/x8xid82/rpgx-ai), a local AI-powered assistant and lore librarian for your world
- [RPGX Quest Log](https://github.com/x8xid82/rpgx-quest-log), AI-assisted quest generation and tracking

## License

MIT
