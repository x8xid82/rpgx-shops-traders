import { getDefaultInventoryLists, setDefaultInventoryLists } from "../business.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class DefaultInventoriesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.lists = foundry.utils.deepClone(getDefaultInventoryLists());
    this.selectedListId = this.lists[0]?.id ?? null;
  }

  static DEFAULT_OPTIONS = {
    id: "rpgx-shops-default-inventories",
    classes: ["rpgx-shops-traders"],
    tag: "div",
    window: {
      title: "Default Inventories",
      icon: "fa-solid fa-boxes-stacked",
      resizable: true
    },
    position: {
      width: 560,
      height: 520
    },
    actions: {
      createList: DefaultInventoriesApp.#onCreateList,
      selectList: DefaultInventoriesApp.#onSelectList,
      renameList: DefaultInventoriesApp.#onRenameList,
      setDefaultList: DefaultInventoriesApp.#onSetDefaultList,
      deleteList: DefaultInventoriesApp.#onDeleteList,
      removeItem: DefaultInventoriesApp.#onRemoveItem
    }
  };

  static PARTS = {
    main: {
      template: "modules/rpgx-shops-traders/templates/default-inventories.hbs"
    }
  };

  /** @override */
  async _prepareContext(_options) {
    const lists = this.lists.map(list => ({
      ...list,
      active: list.id === this.selectedListId
    }));

    const selectedList = lists.find(l => l.active) ?? null;
    if (selectedList) {
      selectedList.items = selectedList.items.map(item => ({
        ...item,
        qty: item.system?.quantity ?? 1
      }));
    }

    return {
      lists,
      selectedList
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    const dropZone = this.element.querySelector(".rpgx-inv-dropzone");
    if (dropZone) {
      dropZone.addEventListener("dragover", ev => ev.preventDefault());
      dropZone.addEventListener("drop", ev => this._onDropItem(ev));
    }

    this.element.querySelectorAll(".rpgx-inv-qty-input").forEach(input => {
      input.addEventListener("change", async ev => {
        const list = this.lists.find(l => l.id === this.selectedListId);
        if (!list) return;

        const index = Number(ev.target.dataset.itemIndex);
        const item = list.items[index];
        if (!item) return;

        const qty = Math.max(1, Math.floor(Number(ev.target.value) || 1));
        foundry.utils.setProperty(item, "system.quantity", qty);
        await this._persist();
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

  async _onDropItem(event) {
    event.preventDefault();

    const list = this.lists.find(l => l.id === this.selectedListId);
    if (!list) return;

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }

    if (data.type !== "Item") {
      ui.notifications.warn("Only Items can be added to a default inventory list.");
      return;
    }

    const item = await fromUuid(data.uuid);
    if (!item) return;

    const itemData = item.toObject();
    delete itemData._id;
    list.items.push(itemData);

    await this._persist();
  }

  /** Save the working copy back to the world setting and re-render. */
  async _persist() {
    await setDefaultInventoryLists(this.lists);
    this.render();
  }

  static async #onCreateList(_event, _target) {
    const name = await promptForName("New List", "");
    if (!name) return;

    const list = {
      id: foundry.utils.randomID(),
      name,
      isDefault: this.lists.length === 0,
      items: []
    };

    this.lists.push(list);
    this.selectedListId = list.id;

    await this._persist();
  }

  static async #onSelectList(_event, target) {
    this.selectedListId = target.closest("[data-list-id]")?.dataset.listId ?? null;
    this.render();
  }

  static async #onRenameList(_event, target) {
    const listId = target.closest("[data-list-id]")?.dataset.listId;
    const list = this.lists.find(l => l.id === listId);
    if (!list) return;

    const name = await promptForName("Rename List", list.name);
    if (!name) return;

    list.name = name;
    await this._persist();
  }

  static async #onSetDefaultList(_event, target) {
    const listId = target.closest("[data-list-id]")?.dataset.listId;
    for (const list of this.lists) list.isDefault = (list.id === listId);
    await this._persist();
  }

  static async #onDeleteList(_event, target) {
    const listId = target.closest("[data-list-id]")?.dataset.listId;
    const list = this.lists.find(l => l.id === listId);
    if (!list) return;

    const confirmed = await DialogV2.confirm({
      window: { title: "Delete List" },
      content: `<p>Delete the "<strong>${list.name}</strong>" list? This cannot be undone.</p>`
    });
    if (!confirmed) return;

    this.lists = this.lists.filter(l => l.id !== listId);
    if (this.selectedListId === listId) this.selectedListId = this.lists[0]?.id ?? null;

    await this._persist();
  }

  static async #onRemoveItem(_event, target) {
    const list = this.lists.find(l => l.id === this.selectedListId);
    if (!list) return;

    const index = Number(target.closest("[data-item-index]")?.dataset.itemIndex);
    if (Number.isNaN(index)) return;

    list.items.splice(index, 1);
    await this._persist();
  }
}

/** Small single-field text prompt, used for naming/renaming lists. */
async function promptForName(title, initial) {
  const safeInitial = String(initial ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return DialogV2.prompt({
    window: { title },
    content: `<input type="text" name="listName" value="${safeInitial}" autofocus style="width: 100%;" />`,
    ok: {
      label: "Save",
      callback: (_event, button) => button.form.elements.listName.value?.trim()
    },
    rejectClose: false
  }).catch(() => null);
}
