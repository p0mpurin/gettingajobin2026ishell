// Runs inside the employer's page, in the Easy Apply webview. Reads the form and
// changes fields the way a person would. Rust decides what is allowed.
(() => {
  if (window.__bj) return;

  // Dropdowns built from scripts rather than a real <select>, from the common libraries.
  const CUSTOM_DROPDOWN = "[role=combobox],[aria-haspopup=listbox],[aria-haspopup=true][role=button],[class*=select__control],.MuiSelect-select,.ant-select-selector,.v-select,.vs__dropdown-toggle,.multiselect,.select2-selection,.choices,.el-select,.chosen-single";
  const OPTION = "[role=option],[role=menuitemradio],[role=listbox] li,.select__option,.MuiMenuItem-root,.ant-select-item-option,.vs__dropdown-option,.multiselect__element,.select2-results__option,.choices__item--choice,.el-select-dropdown__item,.chosen-results li,[class*=dropdown] li,[class*=-option]";
  const FIELD = `input,select,textarea,button,a[href],[role=button],[role=checkbox],[role=radio],${CUSTOM_DROPDOWN}`;
  const CAPTCHA = ".frc-captcha,.g-recaptcha,.h-captcha,.cf-turnstile,iframe[src*=recaptcha],iframe[src*=hcaptcha],iframe[src*=turnstile],iframe[src*=friendlycaptcha],iframe[src*=captcha]";

  // Forms often live in open shadow roots.
  function all(selector, root = document, out = []) {
    root.querySelectorAll(selector).forEach((e) => out.push(e));
    root.querySelectorAll("*").forEach((e) => e.shadowRoot && all(selector, e.shadowRoot, out));
    return out;
  }

  function visible(e) {
    const s = getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

  function labelOf(e) {
    const byId = e.id && e.getRootNode().querySelector(`label[for="${CSS.escape(e.id)}"]`);
    const refs = (e.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => id && e.getRootNode().getElementById?.(id)?.textContent)
      .join(" ");
    const near = e.closest("label") || e.closest("[class*=field],[class*=form-group],[class*=question]")?.querySelector("label,legend,[class*=label]");
    // A dropdown's text is its current value, not what it's for.
    const own = (["BUTTON", "A"].includes(e.tagName) || e.getAttribute("role") === "button") && !isCustomDropdown(e) ? e.innerText || e.value : "";
    return clean(byId?.textContent || refs || e.getAttribute("aria-label") || own || near?.textContent || e.placeholder || e.name || e.value || "").slice(0, 300);
  }

  /** Text inputs on the page: more than a couple means this is a real form. */
  const inputCount = () => all("input,textarea,select").filter((e) => !["hidden", "submit", "button"].includes(e.type) && (visible(e) || e.type === "file")).length;

  const isCustomDropdown = (e) => e.tagName !== "SELECT" && e.matches(CUSTOM_DROPDOWN);

  function kindOf(e) {
    const role = e.getAttribute("role");
    if (isCustomDropdown(e)) return "dropdown";
    if (e.tagName === "INPUT") return e.type || "text";
    if (e.tagName === "TEXTAREA") return "textarea";
    if (e.tagName === "SELECT") return "select";
    if (e.tagName === "A") return "link";
    return role || "button";
  }

  let next = 1;
  function refOf(e) {
    if (!e.dataset.bjRef) e.dataset.bjRef = String(next++);
    return e.dataset.bjRef;
  }
  const find = (ref) => all(`[data-bj-ref="${CSS.escape(String(ref))}"]`)[0];

  function mark(e) {
    // Shows the person watching what's being touched right now.
    e.scrollIntoView({ block: "center", behavior: "smooth" });
    const before = e.style.outline;
    e.style.outline = "2px solid #7fb2e5";
    e.style.outlineOffset = "2px";
    setTimeout(() => (e.style.outline = before), 1400);
  }

  // Many script-built controls listen for the press, not the click.
  function pressLikeAPerson(e) {
    const r = e.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    e.dispatchEvent(new PointerEvent("pointerover", at));
    e.dispatchEvent(new MouseEvent("mouseover", at));
    e.dispatchEvent(new PointerEvent("pointerdown", { ...at, pointerType: "mouse", isPrimary: true }));
    e.dispatchEvent(new MouseEvent("mousedown", at));
    e.focus?.();
    e.dispatchEvent(new PointerEvent("pointerup", { ...at, pointerType: "mouse", isPrimary: true }));
    e.dispatchEvent(new MouseEvent("mouseup", at));
    e.dispatchEvent(new MouseEvent("click", at));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // "Südtirol" and "Suedtirol", "ITALIA " and "Italia" should count as the same.
  const plain = (t) => clean(t).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").replace(/ß/g, "ss");

  /** Options that are showing now, wherever the page drew them (often at the end of <body>). */
  function openOptions(trigger) {
    const owned = trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns");
    const list = owned && trigger.getRootNode().getElementById?.(owned);
    const inside = list ? all(OPTION, list) : [];
    const found = inside.length ? inside : all(OPTION);
    return found.filter((o) => visible(o) && clean(o.textContent) && !o.contains(trigger) && o.getAttribute("aria-disabled") !== "true");
  }

  function bestMatch(options, want) {
    const w = plain(want);
    const text = (o) => plain(o.textContent);
    return options.find((o) => text(o) === w) || options.find((o) => text(o).startsWith(w)) || options.find((o) => text(o).includes(w)) || options.find((o) => w.includes(text(o)));
  }

  async function waitForOptions(trigger, ms) {
    for (let t = 0; t < ms; t += 100) {
      const o = openOptions(trigger);
      if (o.length) return o;
      await sleep(100);
    }
    return [];
  }

  /** Pressing a label sometimes doesn't reach the control: the input inside often takes it. */
  function typeBox(trigger) {
    if (trigger.tagName === "INPUT") return trigger;
    return trigger.querySelector("input:not([type=hidden])") || trigger.closest("[class*=select],[class*=combobox]")?.querySelector("input:not([type=hidden])");
  }

  async function chooseCustom(e, option) {
    mark(e);
    pressLikeAPerson(e);
    let options = await waitForOptions(e, 1500);
    let hit = bestMatch(options, option);
    // Long or search-as-you-type lists only show matches after typing.
    const box = typeBox(e);
    if (!hit && box && !box.readOnly) {
      box.focus();
      setValueKeepFocus(box, option);
      await sleep(300);
      options = await waitForOptions(e, 2500);
      hit = bestMatch(options, option);
    }
    if (!hit) {
      const seen = options.map((o) => clean(o.textContent)).slice(0, 60);
      if (box && !box.readOnly) setValueKeepFocus(box, "");
      e.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      // Pressing outside closes most of them; the page's own close handlers do the rest.
      pressLikeAPerson(document.body);
      return { options: seen };
    }
    const picked = clean(hit.textContent);
    hit.scrollIntoView({ block: "nearest" });
    pressLikeAPerson(hit);
    await sleep(250);
    return { picked };
  }

  function setValueKeepFocus(e, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setValue(e, value) {
    const proto = e.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    e.focus();
    Object.getOwnPropertyDescriptor(proto, "value").set.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
    e.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  window.__bj = {
    snapshot() {
      const fields = [];
      for (const e of all(FIELD)) {
        const file = e.type === "file";
        if (e.type === "hidden" || (!file && !visible(e)) || e.disabled) continue;
        const kind = kindOf(e);
        const f = { ref: refOf(e), kind, label: labelOf(e) };
        if (e.required || e.getAttribute("aria-required") === "true") f.required = true;
        if (kind === "select") {
          f.options = [...e.options].map((o) => clean(o.textContent)).slice(0, 40);
          if (e.options.length > 40) f.more_options = e.options.length - 40;
          f.value = clean(e.selectedOptions[0]?.textContent);
        } else if (kind === "dropdown") {
          f.value = clean(e.innerText || e.value).slice(0, 120);
        } else if (kind === "checkbox" || kind === "radio") {
          f.checked = e.checked ?? e.getAttribute("aria-checked") === "true";
        } else if (file) {
          f.has_file = e.files?.length > 0;
          f.accept = e.accept;
        } else if (e.value && e.tagName !== "BUTTON") {
          f.value = String(e.value).slice(0, 120);
        }
        if (kind === "link" && !/bewerb|apply|candid|job|karriere|career|form/i.test(`${f.label} ${e.href}`)) continue;
        fields.push(f);
        if (fields.length >= 120) break;
      }
      const main = document.querySelector("main,[role=main],article") || document.body;
      return {
        url: location.href,
        title: document.title,
        text: clean(main?.innerText).slice(0, 5000),
        fields,
        captcha: all(CAPTCHA).some((e) => e.tagName === "IFRAME" || visible(e)),
        has_password_field: all("input[type=password]").some(visible),
        cross_site_frames: all("iframe").filter((f) => visible(f) && !f.src.startsWith(location.origin) && !/captcha|turnstile/i.test(f.src)).length,
      };
    },

    info(ref) {
      const e = find(ref);
      if (!e) return null;
      return {
        kind: kindOf(e),
        label: labelOf(e),
        type: (e.getAttribute("type") || "").toLowerCase(),
        autocomplete: (e.getAttribute("autocomplete") || "").toLowerCase(),
        in_form: !!e.closest("form"),
        inputs_on_page: inputCount(),
        checked: e.checked === true || e.getAttribute("aria-checked") === "true",
      };
    },

    fill(ref, value) {
      const e = find(ref);
      mark(e);
      setValue(e, value);
      return clean(String(e.value)).slice(0, 80);
    },

    async choose(ref, option) {
      const e = find(ref);
      if (!e) return { options: [] };
      if (e.tagName !== "SELECT") return chooseCustom(e, option);
      mark(e);
      const opts = [...e.options].filter((o) => !o.disabled);
      const hit = opts.find((o) => o.value.toLowerCase() === option.trim().toLowerCase()) || bestMatch(opts, option);
      if (!hit) return { options: opts.map((o) => clean(o.textContent)).slice(0, 60) };
      e.value = hit.value;
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
      return { picked: clean(hit.textContent) };
    },

    press(ref) {
      const e = find(ref);
      mark(e);
      pressLikeAPerson(e);
      return true;
    },

    element(ref) {
      return find(ref);
    },
  };
})();
