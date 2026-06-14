import { createBusiness, updateBusinessData, getBusinessData, refileBusinessToLocation, getDefaultInventoryLists, getAllBusinesses, isProUser } from "../business.js";
import { generateJSON, buildBusinessPrompt, refreshProtonStatus, protonStatus } from "../ai.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BusinessConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ businessId } = {}, options = {}) {
    super(options);
    this.businessId = businessId;
    this.shopkeepers = []; // working list of { uuid, name, img } until saved
    this._initialized = false;
  }

  static DEFAULT_OPTIONS = {
    id: "rpgx-shops-business-config",
    classes: ["rpgx-shops-traders"],
    tag: "form",
    window: {
      title: "Business Configuration",
      icon: "fa-solid fa-store",
      resizable: true
    },
    position: {
      width: 480,
      height: 720
    },
    form: {
      handler: BusinessConfig.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      removeShopkeeper: BusinessConfig.#onRemoveShopkeeper,
      generateWithAI: BusinessConfig.#onGenerateWithAI
    }
  };

  static PARTS = {
    main: {
      template: "modules/rpgx-shops-traders/templates/business-config.hbs"
    }
  };

  get actor() {
    return this.businessId ? game.actors.get(this.businessId) : null;
  }

  /** @override */
  async _prepareContext(_options) {
    const actor = this.actor;
    const data = actor
      ? getBusinessData(actor)
      : { businessType: "", location: "", description: "", otherNotes: "", buybackRate: null, shopkeepers: [] };

    if (!this._initialized) {
      this._initialized = true;
      if (actor) {
        this.shopkeepers = data.shopkeepers
          .map(uuid => fromUuidSync(uuid))
          .filter(a => a)
          .map(a => ({ uuid: a.uuid, name: a.name, img: a.img }));
      }
    }

    // Starting inventory options only make sense for brand new businesses,
    // applying a list to an existing one with its own items isn't handled here.
    const inventoryLists = actor
      ? []
      : getDefaultInventoryLists().map(list => ({
          id: list.id,
          name: list.name,
          isDefault: !!list.isDefault
        }));

    return {
      name: actor?.name ?? "",
      businessType: data.businessType,
      location: data.location,
      description: data.description,
      otherNotes: data.otherNotes,
      buybackRate: data.buybackRate ?? "",
      shopkeepers: this.shopkeepers,
      inventoryLists,
      isEdit: !!actor,
      isPaidTier: isProUser(),
      protonDetected: protonStatus.detected
    };
  }

  /**
   * Re-check RPGX Proton on open and flip the AI section's unlocked state
   * via a DOM attribute, not this.render(). A render() here could land
   * mid-typing (the /ping check can take a few seconds) and wipe the form,
   * same reasoning as the shopkeeper list and AI result handling below.
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);

    refreshProtonStatus().then(() => {
      const section = this.element.querySelector(".rpgx-ai-section");
      if (section) section.dataset.unlocked = String(isProUser());
    });
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    const dropZone = this.element.querySelector(".shopkeeper-dropzone");
    if (!dropZone) return;

    dropZone.addEventListener("dragover", ev => ev.preventDefault());
    dropZone.addEventListener("drop", ev => this._onDropShopkeeper(ev));
  }

  async _onDropShopkeeper(event) {
    event.preventDefault();

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }

    if (data.type !== "Actor") {
      ui.notifications.warn("Only Actors can be assigned as shopkeepers.");
      return;
    }

    const actor = await fromUuid(data.uuid);
    if (!actor) return;

    if (this.shopkeepers.some(s => s.uuid === actor.uuid)) return;

    this.shopkeepers.push({ uuid: actor.uuid, name: actor.name, img: actor.img });
    this._renderShopkeeperList();
  }

  /**
   * Rebuild just the shopkeeper list/hint inside the dropzone, without
   * calling this.render(). A full render() would regenerate every field
   * from _prepareContext(), which would wipe out anything the GM has
   * typed into the rest of the form but not saved yet.
   */
  _renderShopkeeperList() {
    const dropZone = this.element.querySelector(".shopkeeper-dropzone");
    if (!dropZone) return;

    dropZone.innerHTML = "";

    if (this.shopkeepers.length === 0) {
      const hint = document.createElement("p");
      hint.classList.add("dropzone-hint");
      hint.textContent =
        "Drag an Actor here to assign them as a shopkeeper. If you assign more than one, a random shopkeeper is chosen each time a player visits.";
      dropZone.appendChild(hint);
      return;
    }

    const list = document.createElement("ul");
    list.classList.add("shopkeeper-list");

    for (const sk of this.shopkeepers) {
      const li = document.createElement("li");
      li.dataset.uuid = sk.uuid;

      const img = document.createElement("img");
      img.src = sk.img;
      img.alt = sk.name;

      const span = document.createElement("span");
      span.textContent = sk.name;

      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = "removeShopkeeper";
      button.title = "Remove";
      button.innerHTML = `<i class="fa-solid fa-xmark"></i>`;

      li.append(img, span, button);
      list.appendChild(li);
    }

    dropZone.appendChild(list);
  }

  static async #onRemoveShopkeeper(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    this.shopkeepers = this.shopkeepers.filter(s => s.uuid !== uuid);
    this._renderShopkeeperList();
  }

  static async #onGenerateWithAI(_event, target) {
    if (!isProUser()) {
      ui.notifications.warn("AI generation requires RPGX Proton with an active subscription.");
      return;
    }

    const userPrompt = this.element.querySelector('[name="aiPrompt"]')?.value?.trim() ?? "";
    const businessType = this.element.querySelector('[name="businessType"]')?.value ?? "";
    const location = this.element.querySelector('[name="location"]')?.value ?? "";

    // Don't tell the AI to avoid this shop's own current name when
    // regenerating an existing business.
    const ownName = this.actor?.name?.trim().toLowerCase() ?? null;
    const existingNames = getAllBusinesses()
      .map(a => a.name?.trim())
      .filter(n => n && n.toLowerCase() !== ownName);

    const originalHTML = target.innerHTML;
    target.disabled = true;
    target.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating...`;

    const MAX_ATTEMPTS = 2;
    const tried = [];
    let result;

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const prompt = buildBusinessPrompt({
          userPrompt,
          businessType,
          location,
          existingNames: [...existingNames, ...tried]
        });
        result = await generateJSON(prompt, ["name", "description"]);

        const generatedName = result.name.trim();
        const isDuplicate = [...existingNames, ...tried].some(
          n => n.toLowerCase() === generatedName.toLowerCase()
        );

        if (!isDuplicate) break;

        tried.push(generatedName);
        if (attempt < MAX_ATTEMPTS) {
          target.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> "${generatedName}" is already in use, retrying...`;
        } else {
          ui.notifications.warn(
            `The AI generated "${generatedName}" again, which is already in use by another shop. You may want to tweak the name before saving.`
          );
        }
      }

      this._applyGeneratedContent(result);
    } catch (err) {
      console.error("RPGX Shops & Traders |", err);
      ui.notifications.error(
        "AI generation failed. Make sure RPGX Proton is running and reachable, then check the browser console (F12) for details."
      );
    } finally {
      target.disabled = false;
      target.innerHTML = originalHTML;
    }
  }

  /**
   * Write generated values directly into the form fields, without calling
   * this.render(). Same reasoning as the shopkeeper list, a full render
   * would wipe out the Location and anything else the GM already typed.
   */
  _applyGeneratedContent(result) {
    const setField = (name, value) => {
      if (typeof value !== "string" || !value.trim()) return;
      const field = this.element.querySelector(`[name="${name}"]`);
      if (field) field.value = value;
    };

    setField("name", result.name);
    setField("businessType", result.businessType);
    setField("description", result.description);
    setField("otherNotes", result.otherNotes);
  }

  static async #onSubmit(_event, _form, formData) {
    const data = formData.object;
    const shopkeeperUuids = this.shopkeepers.map(s => s.uuid);
    const buybackRate = data.buybackRate === "" ? null : Number(data.buybackRate);

    if (this.actor) {
      await this.actor.update({ name: data.name });
      await updateBusinessData(this.actor, {
        businessType: data.businessType,
        location: data.location,
        description: data.description,
        otherNotes: data.otherNotes,
        buybackRate,
        shopkeepers: shopkeeperUuids
      });
      await refileBusinessToLocation(this.actor, data.location);
    } else {
      await createBusiness({
        name: data.name,
        businessType: data.businessType,
        location: data.location,
        description: data.description,
        otherNotes: data.otherNotes,
        buybackRate,
        shopkeepers: shopkeeperUuids,
        startingInventoryId: data.startingInventoryId || null
      });
    }
  }
}
