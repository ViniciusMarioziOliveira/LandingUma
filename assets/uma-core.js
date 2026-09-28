/*
 * Uma Core — utilitários compartilhados pelas landing pages.
 * API Umapyoi (com cache e fallback via proxy da Vercel), imagens otimizadas,
 * preenchimento de campos, seletor de personagens, reveal e motor de scroll.
 */
(function () {
  "use strict";

  const API_DIRECT = "https://umapyoi.net/api/v1";
  const API_PROXY = "/api/umapyoi"; // rewrite definido em vercel.json
  const CACHE_PREFIX = "uma:v2:";
  const CACHE_TTL = 30 * 60 * 1000;
  const MICROCMS_HOST = "images.microcms-assets.io";

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  const GROUP_LABELS = {
    "Uniform": "Uniforme",
    "Racewear": "Traje de corrida",
    "Concept Art": "Arte conceitual",
    "Starting Future": "Starting Future"
  };

  const SUPPORT_TYPES = {
    Speed: "Velocidade", Stamina: "Resistência", Power: "Potência",
    Guts: "Garra", Wisdom: "Inteligência", Friend: "Amizade", Group: "Grupo"
  };

  const COMMON_TEXT = {
    "High School": "Ensino Médio",
    "Middle School": "Ensino Fundamental",
    "Ritto Dorm": "Dormitório Ritto",
    "Miho Dorm": "Dormitório Miho",
    "No fluctuation": "Sem alterações",
    "Small decrease": "Leve redução",
    "Small increase": "Leve aumento",
    "Consistently low": "Sempre baixo"
  };

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const stripTags = value => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  /* ---------------------------------------------------------------- cache */

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return undefined;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.t > CACHE_TTL) return undefined;
      return entry.v;
    } catch {
      return undefined;
    }
  }

  function writeCache(key, value) {
    try {
      sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
    } catch {
      /* armazenamento indisponível: segue sem cache */
    }
  }

  /* ------------------------------------------------------------------ API */

  async function request(url, timeout) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function api(path, { timeout = 9000 } = {}) {
    const cleanPath = String(path).replace(/^\/+/, "");
    const cached = readCache(cleanPath);
    if (cached !== undefined) return cached;

    // A Umapyoi libera CORS; o proxy da Vercel fica como segunda tentativa.
    const bases = location.protocol.startsWith("http") ? [API_DIRECT, API_PROXY] : [API_DIRECT];
    let lastError;
    for (const base of bases) {
      try {
        const data = await request(`${base}/${cleanPath}`, timeout);
        writeCache(cleanPath, data);
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  function unwrapObject(payload) {
    let current = payload;
    for (let depth = 0; depth < 4; depth += 1) {
      if (!current || typeof current !== "object" || Array.isArray(current)) break;
      const key = ["data", "result", "character", "payload"]
        .find(candidate => current[candidate] && typeof current[candidate] === "object" && !Array.isArray(current[candidate]));
      if (!key) break;
      current = current[key];
    }
    return current && typeof current === "object" && !Array.isArray(current) ? current : null;
  }

  function unwrapArray(payload) {
    if (Array.isArray(payload)) return payload;
    const key = ["data", "results", "items", "supports", "cards", "image_groups"]
      .find(candidate => Array.isArray(payload?.[candidate]));
    return key ? payload[key] : [];
  }

  async function fetchVoice(characterId) {
    const ids = unwrapArray(await api(`va/character/${characterId}`));
    const first = ids[0];
    const voiceId = first && typeof first === "object" ? first.id : first;
    if (voiceId === undefined || voiceId === null) throw new Error("Dubladora não encontrada");
    return api(`va/${voiceId}`);
  }

  /**
   * Busca personagem, imagens, support cards e dubladora em paralelo.
   * Cada parte falha de forma independente; a página continua com o fallback local.
   */
  async function loadCharacter({ id, gameId }) {
    const requests = [
      api(`character/${id}`),
      api(`character/images/${id}`),
      gameId ? api(`support/character/${gameId}`) : Promise.reject(new Error("Sem game id")),
      fetchVoice(id)
    ];
    const [character, images, supports, voice] = await Promise.allSettled(requests);
    const valueOf = result => (result.status === "fulfilled" ? result.value : null);

    [["personagem", character], ["imagens", images], ["support cards", supports], ["dubladora", voice]]
      .forEach(([label, result]) => {
        if (result.status === "rejected") console.warn(`Umapyoi: falha ao carregar ${label}.`, result.reason);
      });

    return {
      character: unwrapObject(valueOf(character)),
      groups: normalizeGroups(valueOf(images)),
      supports: normalizeSupports(valueOf(supports)),
      voice: unwrapObject(valueOf(voice)),
      loaded: [character, images, supports, voice].filter(result => result.status === "fulfilled").length,
      total: requests.length
    };
  }

  /* ---------------------------------------------------------- normalização */

  function normalizeUrl(value) {
    if (value && typeof value === "object") value = value.image ?? value.url ?? value.src ?? "";
    if (typeof value !== "string") return "";
    let url = value.trim().replace(/&amp;/g, "&");
    if (!url) return "";
    if (url.startsWith("//")) url = `https:${url}`;
    try {
      const parsed = new URL(url, "https://umapyoi.net/");
      if (parsed.protocol === "http:") parsed.protocol = "https:";
      return parsed.protocol === "https:" ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function normalizeGroups(payload) {
    return unwrapArray(payload).map((group, index) => {
      const labelEn = stripTags(group?.label_en || group?.label || `Visual ${index + 1}`);
      const images = [...new Set(unwrapArray(group?.images).map(normalizeUrl).filter(Boolean))];
      return {
        key: labelEn.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        label: GROUP_LABELS[labelEn] || labelEn,
        labelEn,
        labelJp: stripTags(group?.label || ""),
        images
      };
    }).filter(group => group.images.length);
  }

  const cleanTitle = value => (typeof value === "string" ? value.trim().replace(/^\[|\]$/g, "").trim() : "");

  function normalizeSupports(payload) {
    return unwrapArray(payload).map(card => {
      const id = Number(card?.id);
      const titleEn = cleanTitle(card?.title_en);
      const titleJp = cleanTitle(card?.title);
      const rarity = String(card?.rarity_string || { 3: "SSR", 2: "SR", 1: "R" }[card?.rarity] || "R").toUpperCase();
      return {
        id,
        title: titleEn || titleJp || "Support Card",
        titleJp: titleEn && titleJp && titleJp !== titleEn ? titleJp : "",
        rarity,
        type: SUPPORT_TYPES[card?.type] || card?.type || "Suporte",
        typeEn: card?.type || "",
        date: card?.start_date,
        url: `https://gametora.com/umamusume/supports/${card?.gametora || id}`,
        image: `https://media.gametora.com/umamusume/supports/full/small/${id}.png`
      };
    }).filter(card => card.id);
  }

  /* ------------------------------------------------------------ formatação */

  function formatBirthday(day, month) {
    const name = MONTHS[Number(month) - 1];
    return day && name ? `${day} de ${name}` : "";
  }

  function formatMonthYear(value) {
    const number = Number(value);
    const date = Number.isFinite(number) && number > 0
      ? new Date(number < 1e12 ? number * 1000 : number)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return "Arquivo";
    return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" })
      .format(date).replace(" de ", " ").replace(".", "");
  }

  function formatShoe(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const decimal = size => size.replace(".", ",");
    const both = value.match(/both:\s*([\d.]+)/i);
    if (both) return `${decimal(both[1])} cm`;
    const left = value.match(/left:\s*([\d.]+)/i);
    const right = value.match(/right:\s*([\d.]+)/i);
    if (left && right) return `Esq. ${decimal(left[1])} cm · Dir. ${decimal(right[1])} cm`;
    return value;
  }

  function translate(value, dictionary = {}) {
    if (value === undefined || value === null) return "";
    const text = String(value).trim();
    return dictionary[text] ?? COMMON_TEXT[text] ?? text;
  }

  /**
   * Preenche todos os elementos [data-field] com dados da personagem.
   * Textos em inglês da API são traduzidos quando a página fornece o dicionário;
   * valores novos que a página não conhece aparecem como vieram da API.
   */
  function fillCharacter(data, dictionary = {}, scope = document) {
    if (!data) return {};
    const text = key => translate(data[key], dictionary);
    const fields = {
      name: data.name_en,
      nameJp: data.name_jp,
      birthday: formatBirthday(data.birth_day, data.birth_month),
      height: data.height ? `${data.height} cm` : "",
      sizes: data.size_b ? `B${data.size_b} · W${data.size_w} · H${data.size_h}` : "",
      grade: text("grade"),
      residence: text("residence"),
      weight: text("weight"),
      shoe: formatShoe(data.shoe_size),
      strengths: text("strengths"),
      weaknesses: text("weaknesses"),
      ears: text("ears_fact"),
      tail: text("tail_fact"),
      family: text("family_fact"),
      slogan: text("slogan"),
      profile: text("profile"),
      category: text("category_label_en"),
      colorMain: data.color_main,
      colorSub: data.color_sub,
      id: data.id
    };
    setFields(fields, scope);
    return fields;
  }

  function fillVoice(voice, scope = document) {
    if (!voice) return {};
    const fields = { voice: voice.name_en, voiceJp: voice.name_jp };
    setFields(fields, scope);
    return fields;
  }

  function setFields(fields, scope = document) {
    scope.querySelectorAll("[data-field]").forEach(element => {
      const value = fields[element.dataset.field];
      if (value !== undefined && value !== null && value !== "") element.textContent = value;
    });
  }

  /* ---------------------------------------------------------------- imagens */

  const isMicroCms = url => {
    try {
      return new URL(url).hostname === MICROCMS_HOST;
    } catch {
      return false;
    }
  };

  /** URL redimensionada em WebP para assets do microCMS; outros hosts passam intactos. */
  function sizedUrl(url, width) {
    if (!isMicroCms(url)) return url;
    const parsed = new URL(url);
    parsed.searchParams.set("w", String(width));
    parsed.searchParams.set("fm", "webp");
    parsed.searchParams.set("q", "80");
    return parsed.href;
  }

  /**
   * Carrega uma imagem tentando cada fonte em sequência, com srcset responsivo.
   * Ignora a troca quando a mesma fonte já está carregada (evita piscar).
   */
  function setImage(image, sources, { widths = [480, 800, 1200], sizes = "100vw", onLoad, onFail } = {}) {
    if (!image) return;
    const queue = [...new Set((Array.isArray(sources) ? sources : [sources]).map(normalizeUrl).filter(Boolean))];
    if (queue.length && image.dataset.source === queue[0] && image.complete && image.naturalWidth) {
      image.hidden = false;
      image.classList.add("is-loaded");
      onLoad?.(image);
      return;
    }

    const token = String(Number(image.dataset.token || 0) + 1);
    image.dataset.token = token;
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    let index = 0;

    const next = () => {
      if (image.dataset.token !== token) return;
      const url = queue[index++];
      if (!url) {
        image.removeAttribute("srcset");
        image.removeAttribute("src");
        image.dataset.source = "";
        image.hidden = true;
        onFail?.(image);
        return;
      }
      image.dataset.source = url;
      if (isMicroCms(url)) {
        image.sizes = sizes;
        image.srcset = widths.map(width => `${sizedUrl(url, width)} ${width}w`).join(", ");
      } else {
        image.removeAttribute("srcset");
      }
      image.src = sizedUrl(url, widths[widths.length - 1]);
    };

    image.onload = () => {
      if (image.dataset.token !== token) return;
      image.hidden = false;
      image.classList.add("is-loaded");
      onLoad?.(image);
    };
    image.onerror = next;
    next();
  }

  /* ----------------------------------------------------- seletor de páginas */

  function initSwitcher() {
    document.querySelectorAll("[data-switcher]").forEach(switcher => {
      const button = switcher.querySelector("[data-switcher-toggle]");
      if (!button) return;
      const setOpen = open => {
        switcher.classList.toggle("is-open", open);
        button.setAttribute("aria-expanded", String(open));
      };
      button.addEventListener("click", () => setOpen(!switcher.classList.contains("is-open")));
      document.addEventListener("click", event => {
        if (!switcher.contains(event.target)) setOpen(false);
      });
      document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || !switcher.classList.contains("is-open")) return;
        setOpen(false);
        button.focus();
      });
      switcher.addEventListener("focusout", event => {
        if (event.relatedTarget && !switcher.contains(event.relatedTarget)) setOpen(false);
      });
    });
  }

  /* ---------------------------------------------------------------- reveal */

  function initReveal(selector = "[data-reveal]") {
    const items = [...document.querySelectorAll(selector)];
    if (!("IntersectionObserver" in window)) {
      items.forEach(item => item.classList.add("is-in"));
      return;
    }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      observer.unobserve(entry.target);
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    items.forEach(item => observer.observe(item));
  }

  /** Marca o link de navegação da seção visível no momento. */
  function initScrollSpy(linkSelector) {
    const links = [...document.querySelectorAll(linkSelector)];
    const sections = links
      .map(link => document.querySelector(link.getAttribute("href")))
      .filter(Boolean);
    if (!sections.length || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      links.forEach(link => link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`));
    }), { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach(section => observer.observe(section));
  }

  /** Pausa animações CSS de um elemento enquanto ele está fora da tela. */
  function pauseWhenHidden(element, className = "is-paused") {
    if (!element || !("IntersectionObserver" in window)) return;
    new IntersectionObserver(entries => {
      element.classList.toggle(className, !entries[0].isIntersecting);
    }).observe(element);
  }

  /* ------------------------------------------------------- motor de scroll */

  /*
   * Um único listener de scroll (passivo + rAF) calcula o progresso de cada
   * [data-scroll] e grava em --p (0 → 1). As posições ficam em cache e só são
   * medidas de novo quando o layout muda, então o scroll nunca força layout.
   *   data-scroll="sticky"  0 quando o topo encosta no topo da tela, 1 no fim da seção
   *   data-scroll="enter"   0 quando o topo entra por baixo, 1 ao chegar a 35% da tela
   *   data-scroll="through" 0 quando entra por baixo, 1 quando sai por cima
   *   data-scroll="exit"    0 com o topo no topo da tela, 1 quando sai por cima (heros)
   *   data-scroll="page"    progresso da página inteira
   *   data-steps="3"        também grava data-step (0, 1, 2) conforme --p
   */
  const tracked = [];
  const listeners = new Set();
  let viewportHeight = window.innerHeight;
  let maxScroll = 1;
  let lastY = window.scrollY;
  let frame = 0;
  let measureFrame = 0;
  let scrollReady = false;

  function measure() {
    measureFrame = 0;
    viewportHeight = window.innerHeight;
    maxScroll = Math.max(1, root.scrollHeight - viewportHeight);
    const y = window.scrollY;
    tracked.forEach(item => {
      const rect = item.element.getBoundingClientRect();
      item.top = rect.top + y;
      item.height = rect.height;
    });
    scheduleUpdate();
  }

  function scheduleMeasure() {
    if (!measureFrame) measureFrame = requestAnimationFrame(measure);
  }

  function progressOf(item, y) {
    switch (item.mode) {
      case "page":
        return clamp(y / maxScroll);
      case "sticky": {
        const range = item.height - viewportHeight;
        return range > 0 ? clamp((y - item.top) / range) : (y >= item.top ? 1 : 0);
      }
      case "enter":
        return clamp((y + viewportHeight - item.top) / (viewportHeight * 0.65));
      case "exit":
        return clamp((y - item.top) / Math.max(1, item.height));
      default:
        return clamp((y + viewportHeight - item.top) / (viewportHeight + item.height));
    }
  }

  function update() {
    frame = 0;
    const y = window.scrollY;
    const delta = y - lastY;
    lastY = y;

    for (const item of tracked) {
      const progress = Math.round(progressOf(item, y) * 1000) / 1000;
      if (progress === item.progress) continue;
      item.progress = progress;
      item.element.style.setProperty("--p", progress);
      if (item.steps) {
        const step = Math.min(item.steps - 1, Math.floor(progress * item.steps));
        if (step !== item.step) {
          item.step = step;
          item.element.dataset.step = String(step);
        }
      }
    }

    const state = { y, delta, viewportHeight, maxScroll, progress: clamp(y / maxScroll) };
    listeners.forEach(listener => listener(state));
  }

  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function track(element) {
    if (!element || tracked.some(item => item.element === element)) return;
    tracked.push({
      element,
      mode: element.dataset.scroll || "through",
      steps: Number(element.dataset.steps) || 0,
      top: 0,
      height: 0,
      progress: -1,
      step: -1
    });
  }

  function initScroll() {
    if (scrollReady) return;
    scrollReady = true;
    document.querySelectorAll("[data-scroll]").forEach(track);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    window.addEventListener("load", scheduleMeasure, { once: true });
    if ("ResizeObserver" in window) new ResizeObserver(scheduleMeasure).observe(document.body);
    document.fonts?.ready.then(scheduleMeasure);
    measure();
  }

  function onScroll(listener) {
    listeners.add(listener);
    scheduleUpdate();
    return () => listeners.delete(listener);
  }

  /** Último progresso calculado de um [data-scroll] (sem ler estilos do DOM). */
  function progress(element) {
    const item = tracked.find(entry => entry.element === element);
    return item ? Math.max(0, item.progress) : 0;
  }

  /* ------------------------------------------------------------ utilidades */

  function status(dot, label, result, messages = {}) {
    if (!label) return;
    const { loaded = 0, total = 1 } = result || {};
    const online = loaded > 0;
    dot?.classList.toggle("is-online", online);
    label.textContent = loaded === total
      ? messages.full || "Dados ao vivo · Umapyoi API"
      : online
        ? messages.partial || "Dados parciais · complementados localmente"
        : messages.offline || "Modo offline · arquivo local";
  }

  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  window.Uma = {
    api,
    loadCharacter,
    normalizeGroups,
    normalizeSupports,
    normalizeUrl,
    fillCharacter,
    fillVoice,
    setFields,
    translate,
    formatBirthday,
    formatMonthYear,
    formatShoe,
    sizedUrl,
    setImage,
    initSwitcher,
    initReveal,
    initScrollSpy,
    initScroll,
    pauseWhenHidden,
    onScroll,
    progress,
    remeasure: scheduleMeasure,
    status,
    el,
    clamp,
    get reduceMotion() { return reduceMotion.matches; },
    get finePointer() { return finePointer.matches; }
  };
})();
