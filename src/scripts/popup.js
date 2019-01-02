import {Config} from "./config.js";

class ExtensionManager {
    /**
     * @param {Set<string>} excludeType
     */
    constructor(excludeType) {
        this.partition = false;
        this.maxIconSize = 64;
        this.excludeType = excludeType;
        this.allExtIdMap = new WeakMap();
        this.eidDisabledSet = new Set();
        this.nodes = {
            h1: document.createElement("h1"),
            ul: document.createElement("ul"),
            app: document.getElementById("app"),
        };
    }

    /**
     * @public
     * @return {ExtensionManager}
     */
    init() {
        this.readFromLocal();
        this.renderExtensions();
        this.addListeners();
        return this;
    }

    /** @private */
    readFromLocal() {
        const data = localStorage.getItem(Config.deiKey);
        const list = data ? data.split(",") : [];
        list.forEach(id => this.eidDisabledSet.add(id));
    }

    /** @private */
    writeToLocal() {
        localStorage.setItem(Config.deiKey, Array.from(this.eidDisabledSet).join(","));
    }

    /** @private */
    sortByASCII(list) {
        const defSortFunction = (prev, next) => prev.name.localeCompare(next.name, "en-US");
        if (this.partition) {
            const enabled = [];
            const disabled = [];
            for (const item of list) {
                if (item.enabled) {
                    enabled.push(item);
                } else {
                    disabled.push(item);
                }
            }
            return enabled.sort(defSortFunction).concat(disabled.sort(defSortFunction));
        } else {
            return list.sort(defSortFunction);
        }
    }

    /** @private */
    renderExtensions() {
        chrome.management.getAll(list => {
            const listFragment = new DocumentFragment();
            this.sortByASCII(list).forEach(item => {
                if (item.id === chrome.runtime.id || this.excludeType.has(item.type)) return;
                const li = document.createElement("li");
                const img = document.createElement("img");
                const span = document.createElement("span");
                li.tabIndex = 0;
                li.append(img, span);
                listFragment.append(li);
                this.renderExtensionState(li, item);
                this.allExtIdMap.set(li, item);
            });
            this.nodes.h1.tabIndex = 0;
            this.nodes.h1.textContent = chrome.i18n.getMessage(
                this.eidDisabledSet.size ? "one_key_restore" : "one_key_disable");
            this.nodes.ul.textContent = this.nodes.app.textContent = "";
            this.nodes.ul.append(listFragment);
            this.nodes.app.append(this.nodes.h1, this.nodes.ul);
        });
    }

    /**
     * @private
     */
    renderExtensionState(li, item) {
        const img = li.querySelector("img");
        const span = li.querySelector("span");
        const iconInfo = {
            size: 32,
            url: `chrome://extension-icon/${item.id}/32/0`,
        };
        if (item.icons && item.icons.length) {
            const firstIcon = item.icons[0];
            const restIcons = item.icons.slice(1);
            iconInfo.size = firstIcon.size;
            iconInfo.url = firstIcon.url;
            for (const icon of restIcons) {
                if (icon.size > iconInfo.size && icon.size < this.maxIconSize) {
                    iconInfo.size = icon.size;
                    iconInfo.url = icon.url;
                }
            }
        }
        span.textContent = img.alt = item.shortName || item.name;
        img.src = `${iconInfo.url}${item.enabled ? "" : "?grayscale=true"}`;
        li.title = chrome.i18n.getMessage(item.enabled ? "disable_extension" : "enable_extension");
        li.dataset.enabled = item.enabled;
    }

    /** @private */
    addListeners() {
        this.nodes.h1.addEventListener("click", e => {
            if (this.eidDisabledSet.size) {
                this.oneKeyRestore();
            } else {
                this.oneKeyDisable();
            }
        });
        this.nodes.ul.addEventListener("click", e => {
            const li = e.target.closest("li");
            if (this.allExtIdMap.has(li)) {
                const id = this.allExtIdMap.get(li).id;
                chrome.management.get(id, item => chrome.management.setEnabled(item.id, !item.enabled));
            }
        });
        chrome.management.onEnabled.addListener(item => this.toggleExtensionState(item));
        chrome.management.onDisabled.addListener(item => this.toggleExtensionState(item));
        chrome.management.onInstalled.addListener(item => this.renderExtensions());
        chrome.management.onUninstalled.addListener(item => this.renderExtensions());
        document.addEventListener("keyup", e => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.target.click();
            }
        });
        document.addEventListener("keydown", e => {
            switch (e.key) {
                case "Tab":
                    e.preventDefault();
                    this.focusClickableElement(e.shiftKey ? -1 : 1);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    this.focusClickableElement(-1);
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    this.focusClickableElement(1);
                    break;
            }
        });
    }

    /**
     * @private
     */
    focusClickableElement(offset) {
        const clickableElements = [this.nodes.h1].concat(Array.from(this.nodes.ul.children));
        const index = clickableElements.findIndex(element => element === document.activeElement);
        switch (offset) {
            case 1: {
                clickableElements[(index + offset) % clickableElements.length].focus();
                break;
            }
            case -1: {
                clickableElements[
                    (Math.max(index, 0) + offset + clickableElements.length) % clickableElements.length].focus();
                break;
            }
        }
    }

    /**
     * @private
     */
    toggleExtensionState(item) {
        for (const li of this.nodes.ul.children) {
            if (this.allExtIdMap.has(li)) {
                if (this.allExtIdMap.get(li).id === item.id) {
                    this.renderExtensionState(li, item);
                    break;
                }
            }
        }
    }

    /** @private */
    oneKeyDisable() {
        chrome.management.getAll(list => {
            const filtered = list.filter(item =>
                item.id !== chrome.runtime.id && !this.excludeType.has(item.type) && item.enabled);
            const tailId = Boolean(filtered.length) && filtered[filtered.length - 1].id;
            while (filtered.length) {
                const item = filtered.shift();
                chrome.management.setEnabled(item.id, false, () => {
                    this.eidDisabledSet.add(item.id);
                    if (item.id === tailId) {
                        this.writeToLocal();
                        this.nodes.h1.textContent = chrome.i18n.getMessage("one_key_restore");
                    }
                });
            }
        });
    }

    /** @private */
    oneKeyRestore() {
        chrome.management.getAll(list => {
            const disabledRecently = Array.from(this.eidDisabledSet);
            const disabledExisting = new Set(list.map(item => {
                if (item.id !== chrome.runtime.id && !this.excludeType.has(item.type) && !item.enabled) {
                    return item.id;
                }
            }));
            while (disabledRecently.length) {
                const id = disabledRecently.shift();
                disabledExisting.has(id) && chrome.management.setEnabled(id, true);
            }
            this.eidDisabledSet.clear();
            this.writeToLocal();
            this.nodes.h1.textContent = chrome.i18n.getMessage("one_key_disable");
        })
    }
}

chrome.storage.sync.get(Config.etcKey, items => {
    const excludeType = new Set();
    const eTypeChecked = Object.assign(Config.eTypeChecked, items[Config.etcKey]);
    for (const [type, checked] of Object.entries(eTypeChecked)) {
        if (!checked) excludeType.add(type);
    }
    new ExtensionManager(excludeType).init();
});