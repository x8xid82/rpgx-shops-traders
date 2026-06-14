import {
  MODULE_ID,
  getCurrencyConfig,
  formatBaseUnit,
  getItemPriceInBase,
  getActorFundsInBase,
  applyHaggle
} from "../currency.js";
import {
  BUSINESS_FLAG,
  getBusiness,
  getBusinessData,
  updateBusinessData,
  isItemUnlimited,
  setItemUnlimited,
  restockAll,
  getActiveShopkeeper,
  rerollShopkeeper,
  addService,
  updateService,
  removeService
} from "../business.js";
import { requestTransaction, requestHaggle } from "../socket.js";
import { mergeItemsIntoActor } from "../shop.js";

const { ApplicationV2, DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Shared behavior for the Shop window, mixed into two different bases:
 *
 * - ShopWindow:      a standalone window opened from the Main Menu
 *                     (new ShopWindow({ businessId }).render(true)).
 * - ShopWindowSheet: registered as the actor "sheet" for businesses, so
 *                     double-clicking a business's token on the canvas
 *                     opens this directly (Foundry's normal
 *                     "double-click a token to open its sheet" behavior).
 *
 * Both end up with identical tabs/cart/checkout behavior, the only
 * difference is how they're constructed and how Foundry tracks them.
 */
function ShopWindowBehavior(Base) {
  return class extends Base {
    static PARTS = {
      main: {
        template: "modules/rpgx-shops-traders/templates/shop-window.hbs"
      }
    };

    /** Dynamic window title showing the business's name. */
    get title() {
      return this.actor?.name ?? "Shop";
    }

    get actor() {
      return getBusiness(this.businessId);
    }

    /** The character whose inventory/currency this session is shopping with. */
    get shopper() {
      if (game.user.isGM) {
        return game.actors.get(this._gmActingAsId) ?? game.user.character ?? null;
      }
      const picked = game.actors.get(this._playerActingAsId);
      if (picked?.isOwner) return picked;
      return game.user.character ?? null;
    }

    /** @override */
    async _prepareContext(_options) {
      const business = this.actor;
      if (!business) return { missing: true };

      const data = getBusinessData(business);
      const modifier = data.haggleModifier ?? 0;
      const shopkeeper = await getActiveShopkeeper(business);

      if (game.user.isGM && !this._gmActingAsId) {
        const pc = game.actors.find(a => a.hasPlayerOwner);
        if (pc) this._gmActingAsId = pc.id;
      }

      if (!game.user.isGM && !this._playerActingAsId) {
        const owned = game.actors.filter(a => a.isOwner && !a.getFlag(MODULE_ID, BUSINESS_FLAG));
        this._playerActingAsId = game.user.character?.id ?? owned[0]?.id ?? null;
      }

      const items = business.items
        .map(item => {
          const unlimited = isItemUnlimited(item);
          const stock = item.system.quantity ?? 0;
          const inCart = this._cartQty("buy", item.id);
          const available = unlimited ? Infinity : Math.max(0, stock - inCart);

          return {
            id: item.id,
            name: item.name,
            img: item.img,
            uuid: item.uuid,
            unlimited,
            stock,
            available,
            priceLabel: formatBaseUnit(applyHaggle(getItemPriceInBase(item), modifier)),
            inCart,
            outOfStock: !unlimited && stock <= 0,
            canAddMore: unlimited || available > 0,
            canRemove: inCart > 0
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const services = (data.services ?? []).map(svc => {
        const inCart = this._cartQty("service", svc.id);
        return {
          id: svc.id,
          name: svc.name,
          cost: svc.cost,
          priceLabel: formatBaseUnit(applyHaggle(svc.cost, modifier)),
          inCart,
          canRemove: inCart > 0
        };
      });

      const sellEntries = [...this.cart.values()]
        .filter(e => e.type === "sell")
        .map(e => ({
          id: e.id,
          name: e.name,
          img: e.img,
          qty: e.qty,
          uuid: this.shopper?.items.get(e.id)?.uuid ?? null,
          priceLabel: formatBaseUnit(applyHaggle(e.unitBase, modifier)),
          canAddMore: e.qty < e.max
        }));

      const cartEntries = [...this.cart.values()]
        .filter(e => e.qty > 0)
        .map(e => {
          const unit = applyHaggle(e.unitBase, modifier);
          const total = unit * e.qty;
          return {
            type: e.type,
            id: e.id,
            name: e.name,
            qty: e.qty,
            isCredit: e.type === "sell",
            totalLabel: formatBaseUnit(total)
          };
        });

      const totalBase = this._cartTotalBase(modifier);

      const shopper = this.shopper;
      const fundsBase = shopper ? getActorFundsInBase(shopper) : 0;
      const afterBase = fundsBase - totalBase;

      const actingAsOptions = game.user.isGM
        ? game.actors.filter(a => a.hasPlayerOwner).map(a => ({
            id: a.id,
            name: a.name,
            selected: a.id === this._gmActingAsId
          }))
        : game.actors.filter(a => a.isOwner && !a.getFlag(MODULE_ID, BUSINESS_FLAG)).map(a => ({
            id: a.id,
            name: a.name,
            selected: a.id === this._playerActingAsId
          }));

      // GM's version is part of the testing toolbar, always shown if there's
      // at least one player character to choose. Players only need it if
      // they actually have more than one character to pick between.
      const showGmActingAs = game.user.isGM && actingAsOptions.length > 0;
      const showPlayerActingAs = !game.user.isGM && actingAsOptions.length > 1;

      return {
        isGM: game.user.isGM,
        businessName: business.name,
        location: data.location,
        description: data.description,
        otherNotes: data.otherNotes,
        showGmNotes: game.user.isGM && !!data.otherNotes,
        shopkeeper,
        fallbackImg: business.img,
        haggleModifier: modifier,
        activeTab: this.activeTab,
        tabInventory: this.activeTab === "inventory",
        tabServices: this.activeTab === "services",
        tabSell: this.activeTab === "sell",
        items,
        services,
        sellEntries,
        cartEntries,
        hasCart: cartEntries.length > 0,
        hasShopper: !!shopper,
        shopperName: shopper?.name ?? null,
        fundsLabel: formatBaseUnit(fundsBase),
        totalLabel: formatBaseUnit(Math.abs(totalBase)),
        totalIsCredit: totalBase < 0,
        totalIsZero: Math.abs(totalBase) < 1e-9,
        afterLabel: formatBaseUnit(Math.max(0, afterBase)),
        canAfford: !shopper || afterBase >= -1e-6,
        actingAsOptions,
        showGmActingAs,
        showPlayerActingAs,
        showHaggleButton: !game.user.isGM
      };
    }

    /** @override */
    _onFirstRender(context, options) {
      super._onFirstRender(context, options);

      this._hookIds = [
        ["updateActor", Hooks.on("updateActor", this._onDocChange.bind(this))],
        ["createItem", Hooks.on("createItem", this._onDocChange.bind(this))],
        ["updateItem", Hooks.on("updateItem", this._onDocChange.bind(this))],
        ["deleteItem", Hooks.on("deleteItem", this._onDocChange.bind(this))]
      ];
    }

    /** @override */
    _onRender(context, options) {
      super._onRender(context, options);

      const dropZone = this.element.querySelector(".rpgx-sell-dropzone");
      if (dropZone) {
        dropZone.addEventListener("dragover", ev => ev.preventDefault());
        dropZone.addEventListener("drop", ev => this._onDropSellItem(ev));
      }

      const addItemZone = this.element.querySelector(".rpgx-add-item-dropzone");
      if (addItemZone) {
        addItemZone.addEventListener("dragover", ev => ev.preventDefault());
        addItemZone.addEventListener("drop", ev => this._onDropAddItem(ev));
      }

      const haggleInput = this.element.querySelector('[name="haggleModifier"]');
      haggleInput?.addEventListener("change", async ev => {
        const value = Number(ev.target.value) || 0;
        await updateBusinessData(this.actor, { haggleModifier: value });
      });
      haggleInput?.addEventListener("keydown", ev => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          ev.target.blur();
        }
      });

      const actingAsSelect = this.element.querySelector('[name="actingAs"]');
      actingAsSelect?.addEventListener("change", ev => {
        if (game.user.isGM) this._gmActingAsId = ev.target.value;
        else this._playerActingAsId = ev.target.value;
        this.render();
      });

      // GM-only: editable "qty on hand" inputs. Updating an item triggers
      // the updateItem hook, which re-renders this (and any other open)
      // Shop window with the new stock numbers.
      this.element.querySelectorAll(".rpgx-qty-input").forEach(input => {
        input.addEventListener("change", async ev => {
          const item = this.actor?.items.get(ev.target.dataset.itemId);
          if (!item) return;
          const value = Math.max(0, Math.floor(Number(ev.target.value) || 0));
          if (value === (item.system.quantity ?? 0)) return;
          await item.update({ "system.quantity": value });
        });

        // A number input doesn't fire "change" on Enter by itself, only on
        // blur, so without this Enter looks like it did nothing.
        input.addEventListener("keydown", ev => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            ev.target.blur();
          }
        });
      });
    }

    /** @override */
    _onClose(options) {
      for (const [name, id] of this._hookIds ?? []) Hooks.off(name, id);
      super._onClose(options);
    }

    /** Re-render if the change is relevant to this shop or shopper, ignore everything else. */
    _onDocChange(doc) {
      const parent = doc.documentName === "Item" ? doc.parent : doc;
      if (!parent) return;
      const relevant = parent.id === this.businessId || parent.id === this.shopper?.id;
      if (relevant && this.rendered) this.render();
    }

    /* ===================================================== */
    /* Cart                                                   */
    /* ===================================================== */

    _cartQty(type, id) {
      return this.cart.get(`${type}:${id}`)?.qty ?? 0;
    }

    /** Net amount the shopper would pay (positive) or receive (negative), in base units, at the current haggle modifier. */
    _cartTotalBase(modifier) {
      let total = 0;
      for (const entry of this.cart.values()) {
        if (entry.qty <= 0) continue;
        const unit = applyHaggle(entry.unitBase, modifier);
        total += entry.type === "sell" ? -unit * entry.qty : unit * entry.qty;
      }
      return total;
    }

    _adjustCart(type, id, delta) {
      const key = `${type}:${id}`;
      const existing = this.cart.get(key);
      const business = this.actor;

      if (type === "sell") {
        if (!existing) return; // sell entries are only created by dropping an item
        const newQty = Math.max(0, Math.min(existing.max, existing.qty + delta));
        if (newQty === 0) this.cart.delete(key);
        else this.cart.set(key, { ...existing, qty: newQty });
        this.render();
        return;
      }

      let max = 99;
      let unitBase = 0;
      let name = "";
      let img = "";

      if (type === "buy") {
        const item = business.items.get(id);
        if (!item) return;
        name = item.name;
        img = item.img;
        unitBase = getItemPriceInBase(item);
        max = isItemUnlimited(item) ? Infinity : (item.system.quantity ?? 0);
      } else if (type === "service") {
        const data = getBusinessData(business);
        const svc = data.services.find(s => s.id === id);
        if (!svc) return;
        name = svc.name;
        img = "icons/svg/coins.svg";
        unitBase = svc.cost;
      }

      const currentQty = existing?.qty ?? 0;
      const newQty = Math.max(0, Math.min(max, currentQty + delta));

      if (newQty === 0) this.cart.delete(key);
      else this.cart.set(key, { type, id, name, img, unitBase, qty: newQty, max });

      this.render();
    }

    /** Dragging an item from a character sheet onto the Sell Loot tab. */
    async _onDropSellItem(event) {
      event.preventDefault();

      let data;
      try {
        data = JSON.parse(event.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }

      if (data.type !== "Item") {
        ui.notifications.warn("Drag an item from a character sheet to sell it.");
        return;
      }

      const item = await fromUuid(data.uuid);
      if (!item?.parent) {
        ui.notifications.warn("That item isn't on a character.");
        return;
      }

      const shopper = this.shopper;
      if (!game.user.isGM && item.parent.id !== shopper?.id) {
        ui.notifications.warn("You can only sell items from your own character.");
        return;
      }

      const business = this.actor;
      const businessData = getBusinessData(business);
      const buybackRate = (businessData.buybackRate ?? game.settings.get(MODULE_ID, "defaultBuybackRate") ?? 50) / 100;
      const unitBase = getItemPriceInBase(item) * buybackRate;

      const key = `sell:${item.id}`;
      const max = item.system.quantity ?? 1;
      const existing = this.cart.get(key);
      const newQty = Math.min(max, (existing?.qty ?? 0) + 1);

      this.cart.set(key, {
        type: "sell",
        id: item.id,
        name: item.name,
        img: item.img,
        unitBase,
        qty: newQty,
        max
      });

      this.render();
    }

    /** GM-only: dragging an item from a compendium/character/sidebar onto the Inventory tab to stock the shop. */
    async _onDropAddItem(event) {
      event.preventDefault();
      if (!game.user.isGM) return;

      let data;
      try {
        data = JSON.parse(event.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }

      if (data.type !== "Item") {
        ui.notifications.warn("Drag an item here to add it to this shop's stock.");
        return;
      }

      const item = await fromUuid(data.uuid);
      if (!item) return;

      const itemData = item.toObject();
      delete itemData._id;

      await mergeItemsIntoActor(this.actor, [itemData]);
      ui.notifications.info(`Added ${item.name} to ${this.actor.name}'s stock.`);
    }

    /* ===================================================== */
    /* Actions                                                */
    /* ===================================================== */

    static #onSetTab(_event, target) {
      this.activeTab = target.dataset.tab;
      this.render();
    }

    static #onAddToCart(_event, target) {
      this._adjustCart(target.dataset.type, target.dataset.id, 1);
    }

    static #onRemoveFromCart(_event, target) {
      if (target.dataset.clear === "true") {
        this.cart.delete(`${target.dataset.type}:${target.dataset.id}`);
        this.render();
        return;
      }
      this._adjustCart(target.dataset.type, target.dataset.id, -1);
    }

    static async #onCheckout(_event, target) {
      const shopper = this.shopper;
      if (!shopper) {
        ui.notifications.warn("No character assigned. Ask your GM to assign you a character first.");
        return;
      }

      const purchases = [];
      const sales = [];
      const services = [];

      for (const entry of this.cart.values()) {
        if (entry.qty <= 0) continue;
        if (entry.type === "buy") purchases.push({ itemId: entry.id, qty: entry.qty });
        else if (entry.type === "sell") sales.push({ itemId: entry.id, qty: entry.qty });
        else if (entry.type === "service") services.push({ id: entry.id, qty: entry.qty });
      }

      if (!purchases.length && !sales.length && !services.length) {
        ui.notifications.info("Your cart is empty.");
        return;
      }

      const original = target.innerHTML;
      target.disabled = true;
      target.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;

      try {
        await requestTransaction({ businessId: this.businessId, actorId: shopper.id, purchases, sales, services });
        this.cart.clear();
        ui.notifications.info("Transaction complete!");
        this.render();
      } catch (err) {
        console.error("RPGX Shops & Traders |", err);
        ui.notifications.error(err.message);
      } finally {
        target.disabled = false;
        target.innerHTML = original;
      }
    }

    static async #onToggleUnlimited(_event, target) {
      const itemId = target.closest("[data-item-id]")?.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      await setItemUnlimited(item, !isItemUnlimited(item));
      this.render();
    }

    static async #onRestockAll(_event, _target) {
      const count = await restockAll(this.actor);
      ui.notifications.info(
        count ? `Restocked ${count} item(s) to their starting quantities.` : "Nothing needed restocking."
      );
    }

    static async #onRerollShopkeeper(_event, _target) {
      await rerollShopkeeper(this.actor);
      this.render();
    }

    static async #onAddService(_event, _target) {
      const baseUnit = getCurrencyConfig().find(d => d.rate === 1)?.id ?? "";

      let result;
      try {
        result = await foundry.applications.api.DialogV2.prompt({
          window: { title: "Add Service" },
          content: `
            <div class="form-group">
              <label>Service Name</label>
              <input type="text" name="name" placeholder="e.g. Basic Room, Horse Rental" autofocus />
            </div>
            <div class="form-group">
              <label>Cost (${baseUnit})</label>
              <input type="number" name="cost" min="0" step="0.5" value="0" />
            </div>
          `,
          ok: {
            label: "Add",
            callback: (_ev, button) => ({
              name: button.form.querySelector('[name="name"]').value,
              cost: Number(button.form.querySelector('[name="cost"]').value) || 0
            })
          },
          rejectClose: false
        });
      } catch {
        return;
      }

      if (!result?.name?.trim()) return;
      await addService(this.actor, result);
      this.render();
    }

    static async #onEditService(_event, target) {
      const id = target.closest("[data-service-id]")?.dataset.serviceId;
      const data = getBusinessData(this.actor);
      const svc = data.services.find(s => s.id === id);
      if (!svc) return;

      const baseUnit = getCurrencyConfig().find(d => d.rate === 1)?.id ?? "";

      let result;
      try {
        result = await foundry.applications.api.DialogV2.prompt({
          window: { title: "Edit Service" },
          content: `
            <div class="form-group">
              <label>Service Name</label>
              <input type="text" name="name" value="${svc.name}" autofocus />
            </div>
            <div class="form-group">
              <label>Cost (${baseUnit})</label>
              <input type="number" name="cost" min="0" step="0.5" value="${svc.cost}" />
            </div>
          `,
          ok: {
            label: "Save",
            callback: (_ev, button) => ({
              name: button.form.querySelector('[name="name"]').value,
              cost: Number(button.form.querySelector('[name="cost"]').value) || 0
            })
          },
          rejectClose: false
        });
      } catch {
        return;
      }

      if (!result?.name?.trim()) return;
      await updateService(this.actor, id, result);
      this.render();
    }

    static async #onRemoveService(_event, target) {
      const id = target.closest("[data-service-id]")?.dataset.serviceId;
      if (!id) return;
      await removeService(this.actor, id);
      this.render();
    }

    /**
     * Open the shopkeeper NPC's own actor sheet. Foundry's normal
     * permission rules apply here: a GM always sees the full sheet, a
     * player with Observer/Owner sees the full sheet, a player with
     * Limited sees the limited view, and a player with no permission gets
     * Foundry's standard "you don't have permission" warning.
     */
    static async #onOpenShopkeeper(_event, target) {
      const uuid = target.closest("[data-uuid]")?.dataset.uuid;
      if (!uuid) return;
      const npc = await fromUuid(uuid);
      npc?.sheet?.render(true);
    }

    /**
     * View an item's own sheet (its "item card"), for both shop inventory
     * items and items in the Sell Loot list. Uses the same sheet.render(true)
     * pattern as the shopkeeper portrait, GMs get the full editable sheet,
     * players get Foundry's normal read-only view via permission inheritance
     * from the parent actor.
     */
    static async #onViewItem(_event, target) {
      const uuid = target.closest("[data-uuid]")?.dataset.uuid;
      if (!uuid) return;
      const item = await fromUuid(uuid);
      item?.sheet?.render(true);
    }

    /** Let the GM know this player would like to haggle, without forcing an immediate response. */
    static async #onHaggle(_event, _target) {
      const shopper = this.shopper;
      const shopperName = shopper?.name ?? game.user.name;

      await requestHaggle({
        businessName: this.actor?.name ?? "the shop",
        shopperName,
        shopperActorId: shopper?.id ?? null
      });

      ui.notifications.info("Your GM has been notified that you'd like to haggle.");
    }

    /**
     * GM-only: permanently remove an item from this shop's inventory.
     * Unlike setting quantity to 0, this is for items the GM never wants to
     * see again (one-of-a-kind loot that's been sold, etc.), it's gone for
     * good and Restock All has nothing left to reset.
     */
    static async #onRemoveItem(_event, target) {
      const itemId = target.closest("[data-item-id]")?.dataset.itemId;
      const item = this.actor?.items.get(itemId);
      if (!item) return;

      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Remove Item" },
        content: `<p>Remove <strong>${item.name}</strong> from this shop's inventory? This can't be undone, and Restock All won't bring it back.</p>`,
        rejectClose: false
      });

      if (!confirmed) return;
      await item.delete();
    }

    static DEFAULT_OPTIONS = {
      classes: ["rpgx-shops-traders", "rpgx-shop-window"],
      window: {
        icon: "fa-solid fa-store",
        resizable: true
      },
      position: {
        width: 880,
        height: 750
      },
      actions: {
        setTab: this.#onSetTab,
        addToCart: this.#onAddToCart,
        removeFromCart: this.#onRemoveFromCart,
        checkout: this.#onCheckout,
        toggleUnlimited: this.#onToggleUnlimited,
        restockAll: this.#onRestockAll,
        rerollShopkeeper: this.#onRerollShopkeeper,
        addService: this.#onAddService,
        editService: this.#onEditService,
        removeService: this.#onRemoveService,
        openShopkeeper: this.#onOpenShopkeeper,
        haggle: this.#onHaggle,
        removeItem: this.#onRemoveItem,
        viewItem: this.#onViewItem
      }
    };
  };
}

/* ===================================================== */
/* Standalone window (opened from the Main Menu)         */
/* ===================================================== */

export class ShopWindow extends ShopWindowBehavior(HandlebarsApplicationMixin(ApplicationV2)) {
  constructor({ businessId } = {}, options = {}) {
    super(options);
    this.businessId = businessId;
    this.activeTab = "inventory";
    this.cart = new Map();
    this._gmActingAsId = null;
    this._playerActingAsId = null;
  }

  static DEFAULT_OPTIONS = {
    id: "rpgx-shop-window-{id}"
  };
}

/* ===================================================== */
/* Registered actor sheet (token double-click)           */
/* ===================================================== */

export class ShopWindowSheet extends ShopWindowBehavior(HandlebarsApplicationMixin(DocumentSheetV2)) {
  constructor(options = {}) {
    super(options);
    this.businessId = this.document?.id ?? options.document?.id ?? options.object?.id;
    this.activeTab = "inventory";
    this.cart = new Map();
    this._gmActingAsId = null;
    this._playerActingAsId = null;
  }

  static DEFAULT_OPTIONS = {};
}
