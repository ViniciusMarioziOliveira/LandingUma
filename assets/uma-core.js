/*
 * Uma Core — utilitários compartilhados pelas landing pages e pelo Paddock (index.html).
 * Dados da Umapyoi (snapshot local em data/, com a API ao vivo como reserva), imagens otimizadas,
 * preenchimento de campos, seletor de personagens, visitas, voz oficial, reveal e motor de scroll.
 */
(function () {
  "use strict";

  const API_DIRECT = "https://umapyoi.net/api/v1";
  const API_PROXY = "/api/umapyoi"; // rewrite definido em vercel.json
  const CACHE_PREFIX = "uma:v2:";
  const CACHE_TTL = 30 * 60 * 1000;
  const MICROCMS_HOST = "images.microcms-assets.io";
  const ASSETS = "https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938";
  const VISITED_KEY = "uma:visited";
  const LAST_KEY = "uma:last";

  /*
   * Elenco do Paddock, na ordem das baias. O seletor de cada página é montado a partir
   * desta lista; uma personagem nova entra aqui, no index.html e em scripts/update-data.ps1.
   */
  const ROSTER = [
    { slug: "dober", page: "dober.html", name: "Mejiro Dober", gate: 1, color: "#19B49E", icon: `${ASSETS}/a17237adfafe4643a73ce174e551c4ec/mejirodober_icon.png` },
    { slug: "ayabe", page: "ayabe.html", name: "Admire Vega", gate: 2, color: "#3865A1", icon: `${ASSETS}/d34bee3b36f0457f896e851359d0bd00/admirevega_icon.png` },
    { slug: "chiyo", page: "chiyo.html", name: "Sakura Chiyono O", gate: 3, color: "#F9879D", icon: `${ASSETS}/54ca5b65f05945d49d8780de4b3e75b7/sakurachiyonoo_icon.png` },
    { slug: "machan", page: "machan.html", name: "Aston Machan", gate: 4, color: "#CF4436", icon: `${ASSETS}/6cbe9384164943e195d74d79a788a495/astonmachan_icon.png` },
    { slug: "vivlos", page: "vivlos.html", name: "Vivlos", gate: 5, color: "#404FB1", icon: `${ASSETS}/a72fd0cded7040da8c4873657fb624a3/vivlos_icon.png` },
    { slug: "acute", page: "acute.html", name: "Wonder Acute", gate: 6, color: "#D85081", icon: `${ASSETS}/5b4b3d2d5a864f809e1dfc89fa5678fb/wonderacute_icon.png` },
    { slug: "victoire", page: "victoire.html", name: "Victoire Pisa", gate: 7, color: "#666AC5", icon: `${ASSETS}/bfbe62c6b00d49dbab70299dc1632455/victoirepisa_icon.png` }
  ];

  // Cores dos portões (枠) do turfe japonês, do 1 ao 8: [fundo, texto].
  const GATE_COLORS = [
    ["#F4F3EF", "#1D1D1F"], ["#1D1D1F", "#FFFFFF"], ["#D9342B", "#FFFFFF"], ["#2D5FC4", "#FFFFFF"],
    ["#F2C414", "#1D1D1F"], ["#1F9A52", "#FFFFFF"], ["#F08A24", "#1D1D1F"], ["#F2A7C3", "#1D1D1F"]
  ];

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
   * Lê o snapshot local data/<id>.json (gerado por scripts/update-data.ps1):
   * uma única requisição no mesmo domínio em vez de cinco à Umapyoi.
   * Se o arquivo não estiver disponível, recorre à API ao vivo.
   */
  async function loadCharacter({ id, gameId }) {
    try {
      const snapshot = await request(`data/${id}.json`, 6000);
      return {
        character: unwrapObject(snapshot.character),
        groups: normalizeGroups(snapshot.images),
        supports: normalizeSupports(snapshot.supports),
        voice: unwrapObject(snapshot.voice),
        source: "snapshot",
        updated: snapshot.updated || "",
        loaded: 4,
        total: 4
      };
    } catch (error) {
      console.warn("Snapshot local indisponível; usando a API Umapyoi.", error);
      return loadCharacterLive({ id, gameId });
    }
  }

  /**
   * Busca personagem, imagens, support cards e dubladora em paralelo.
   * Cada parte falha de forma independente; a página continua com o fallback local.
   */
  async function loadCharacterLive({ id, gameId }) {
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
      source: "live",
      updated: "",
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

  /** "2026-09-28" → "28/09/2026" (data local, sem deslocamento de fuso). */
  function formatDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
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
      voiceClip: normalizeUrl(data.voice),
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

  /* -------------------------------------------------------------- visitas */

  // O Paddock mostra quais páginas já foram visitadas neste navegador.
  function visited() {
    try {
      const list = JSON.parse(localStorage.getItem(VISITED_KEY) || "[]");
      return Array.isArray(list) ? list.filter(slug => ROSTER.some(character => character.slug === slug)) : [];
    } catch {
      return [];
    }
  }

  function lastVisited() {
    try {
      return localStorage.getItem(LAST_KEY) || "";
    } catch {
      return "";
    }
  }

  function markVisited(slug) {
    if (!ROSTER.some(character => character.slug === slug)) return;
    try {
      const list = visited();
      if (!list.includes(slug)) list.push(slug);
      localStorage.setItem(VISITED_KEY, JSON.stringify(list));
      localStorage.setItem(LAST_KEY, slug);
    } catch {
      /* sem armazenamento: a visita só não fica registrada */
    }
  }

  /* ----------------------------------------------------- seletor de páginas */

  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  /** Monta o painel: atalho para o Paddock + as personagens, com a atual e as visitadas marcadas. */
  function buildSwitcherPanel(panel) {
    const current = root.dataset.uma || "";
    const done = new Set(visited());

    const home = el("a", "switcher-home");
    home.href = "index.html";
    const grid = el("span", "switcher-home-icon");
    grid.setAttribute("aria-hidden", "true");
    ROSTER.forEach(character => {
      const tile = el("i");
      tile.style.background = character.color;
      grid.append(tile);
    });
    const homeText = el("span", "switcher-home-text");
    homeText.append(el("strong", "", "Paddock"), el("small", "", "Todas as personagens"));
    home.append(grid, homeText);

    const items = ROSTER.map(character => {
      const link = el("a", "switcher-item");
      link.href = character.page;
      link.style.setProperty("--c", character.color);

      const avatar = el("span", "switcher-avatar");
      avatar.setAttribute("aria-hidden", "true");
      const image = document.createElement("img");
      image.alt = "";
      image.width = 34;
      image.height = 34;
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove(), { once: true });
      image.src = sizedUrl(character.icon, 72);
      avatar.append(image);
      link.append(avatar, el("span", "switcher-name", character.name));

      if (character.slug === current) {
        link.setAttribute("aria-current", "page");
        link.append(el("small", "switcher-tag", "Atual"));
      } else if (done.has(character.slug)) {
        const check = el("small", "switcher-tag is-visited", "✓");
        check.setAttribute("aria-hidden", "true");
        link.append(check, el("span", "sr-only", " (visitada)"));
      }

      const [frame, frameInk] = GATE_COLORS[character.gate - 1] || GATE_COLORS[0];
      const gate = el("span", "switcher-gate", String(character.gate));
      gate.setAttribute("aria-hidden", "true");
      gate.style.setProperty("--frame", frame);
      gate.style.setProperty("--frame-ink", frameInk);
      link.append(gate);
      return link;
    });

    panel.replaceChildren(home, el("p", "switcher-label", "Trocar personagem"), ...items);
  }

  function initSwitcher() {
    document.querySelectorAll("[data-switcher]").forEach(switcher => {
      const button = switcher.querySelector("[data-switcher-toggle]");
      const panel = switcher.querySelector(".switcher-panel");
      if (!button || !panel) return;
      buildSwitcherPanel(panel);
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

  /* ------------------------------------------------------------ voz oficial */

  let playingVoice = null;

  /**
   * Liga um botão à fala oficial da personagem (o .mp3 do site oficial, vindo da Umapyoi).
   * O áudio só é baixado no primeiro clique; tocar uma voz pausa qualquer outra.
   * Retorna { setSource } para trocar o arquivo quando os dados chegarem.
   */
  function voice(button, source, { label, idle = "Ouvir a voz", playing = "Pausar", unavailable = "Áudio indisponível", onChange } = {}) {
    if (!button) return { setSource() {} };
    const labelElement = label === undefined ? button.querySelector("[data-voice-label]") : label;
    let url = normalizeUrl(source);
    let audio = null;

    const render = state => {
      button.setAttribute("aria-pressed", String(state === "playing"));
      button.classList.toggle("is-playing", state === "playing");
      if (labelElement) labelElement.textContent = state === "error" ? unavailable : state === "playing" ? playing : idle;
      onChange?.(state, audio);
    };

    button.disabled = !url;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (!url) return;
      if (!audio) {
        audio = new Audio();
        audio.preload = "auto";
        audio.addEventListener("playing", () => render("playing"));
        audio.addEventListener("pause", () => render("idle"));
        audio.addEventListener("error", () => {
          render("error");
          button.disabled = true;
        });
        audio.src = url;
      }
      if (audio.paused) {
        if (playingVoice && playingVoice !== audio) playingVoice.pause();
        playingVoice = audio;
        audio.play().catch(() => render("idle"));
      } else {
        audio.pause();
      }
    });

    return {
      setSource(next) {
        const normalized = normalizeUrl(next);
        if (!normalized || normalized === url) return;
        url = normalized;
        button.disabled = false;
        if (audio && audio.paused) audio.src = url;
      }
    };
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
    const { loaded = 0, total = 1, source = "", updated = "" } = result || {};
    const online = loaded > 0;
    dot?.classList.toggle("is-online", online);
    let text = loaded === total
      ? messages.full || "Dados da Umapyoi API"
      : online
        ? messages.partial || "Dados parciais · complementados localmente"
        : messages.offline || "Modo offline · arquivo local";
    // O snapshot local é uma cópia da Umapyoi: a data mostra de quando são os dados.
    const day = formatDay(updated);
    if (source === "snapshot" && day) {
      text += ` · arquivo de ${day}`;
      label.title = "Cópia local da Umapyoi API, gerada por scripts/update-data.ps1";
    } else if (source === "live" && loaded === total) {
      text += " · ao vivo";
    }
    label.textContent = text;
  }

  // Cada página declara a personagem em <html data-uma="...">; a visita fica registrada.
  if (root.dataset.uma) markVisited(root.dataset.uma);

  window.Uma = {
    roster: ROSTER,
    gateColors: GATE_COLORS,
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
    visited,
    lastVisited,
    markVisited,
    initSwitcher,
    voice,
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
