import { MODULE_ID } from "../currency.js";
import { getAllBusinesses, canCreateBusiness, FREE_BUSINESS_LIMIT, isProUser } from "../business.js";
import { refreshProtonStatus } from "../ai.js";
import { BusinessConfig } from "./business-config.js";
import { ShopWindow } from "./shop-window.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ShopsMainMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "rpgx-shops-main-menu",
    classes: ["rpgx-shops-traders"],
    tag: "div",
    window: {
      title: "RPGX Shops & Traders",
      icon: "fa-solid fa-store",
      resizable: true
    },
    position: {
      width: 480,
      height: "auto"
    },
    actions: {
      createBusiness: ShopsMainMenu.#onCreateBusiness,
      editBusiness: ShopsMainMenu.#onEditBusiness,
      deleteBusiness: ShopsMainMenu.#onDeleteBusiness,
      openBusiness: ShopsMainMenu.#onOpenBusiness
    }
  };

  static PARTS = {
    main: {
      template: "modules/rpgx-shops-traders/templates/main-menu.hbs"
    }
  };

  /** @override */
  async _prepareContext(_options) {
    const businesses = getAllBusinesses().map(actor => {
      const data = actor.getFlag(MODULE_ID, "data") ?? {};
      return {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        businessType: data.businessType || "",
        location: data.location || "",
        itemCount: actor.items?.size ?? 0
      };
    });

    return {
      businesses,
      isGM: game.user.isGM,
      isProUser: isProUser(),
      freeLimit: FREE_BUSINESS_LIMIT
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Re-bound on every render since the list HTML is rebuilt each time.
    for (const row of this.element.querySelectorAll(".rpgx-business-row")) {
      row.addEventListener("dragstart", this._onDragStart.bind(this));
    }
  }

  /**
   * Lets a business row be dragged straight onto the canvas to drop a
   * token, using the same {type: "Actor", uuid} payload Foundry's own
   * Actors directory uses, so the core canvas drop handler picks it up
   * with no extra wiring needed.
   */
  _onDragStart(event) {
    const businessId = event.currentTarget.dataset.businessId;
    const actor = game.actors.get(businessId);
    if (!actor) return;

    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Actor", uuid: actor.uuid }));
    event.dataTransfer.effectAllowed = "copyMove";
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);

    // No form fields here, unlike Business Config, so a re-render after
    // the /ping check resolves is safe and keeps the tier note accurate.
    refreshProtonStatus().then(() => {
      if (this.rendered) this.render();
    });

    // Keep the list live if businesses are created/edited/deleted elsewhere
    this._rpgxHooks = [
      ["createActor", Hooks.on("createActor", this._onActorChange.bind(this))],
      ["updateActor", Hooks.on("updateActor", this._onActorChange.bind(this))],
      ["deleteActor", Hooks.on("deleteActor", this._onActorChange.bind(this))]
    ];
  }

  /** @override */
  _onClose(options) {
    for (const [event, id] of this._rpgxHooks ?? []) Hooks.off(event, id);
    super._onClose(options);
  }

  _onActorChange() {
    if (this.rendered) this.render();
  }

  static async #onCreateBusiness(_event, _target) {
    if (!canCreateBusiness()) {
      ui.notifications.warn(
        `The free version is limited to ${FREE_BUSINESS_LIMIT} businesses. Upgrade to RPGX Proton for unlimited businesses.`
      );
      return;
    }

    new BusinessConfig({ businessId: null }).render(true);
  }

  static async #onEditBusiness(_event, target) {
    const businessId = target.closest("[data-business-id]")?.dataset.businessId;
    if (!businessId) return;
    new BusinessConfig({ businessId }).render(true);
  }

  static async #onDeleteBusiness(_event, target) {
    const businessId = target.closest("[data-business-id]")?.dataset.businessId;
    const actor = game.actors.get(businessId);
    if (!actor) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Business" },
      content: `<p>Delete <strong>${actor.name}</strong>? This cannot be undone.</p>`
    });

    if (confirmed) await actor.delete();
  }

  static async #onOpenBusiness(_event, target) {
    const businessId = target.closest("[data-business-id]")?.dataset.businessId;
    if (!businessId) return;
    new ShopWindow({ businessId }).render(true);
  }
}
