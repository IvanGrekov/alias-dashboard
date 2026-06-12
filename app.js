const CONFIG = {
  minPlayers: 2,
  maxPlayers: 6,
  minRounds: 1,
  maxRounds: 3,
  wordsPerPlayerPerRound: 14,
  mainSeconds: 120,
  extraSeconds: 60,
  colors: ["#1e5eff", "#d92d20", "#079455", "#7a5af8", "#dc6803", "#0086c9"],
  icons: ["🦊", "🐼", "🐸", "🦁", "🐙", "🦉"]
};

const ROUND_DESCRIPTIONS = [
  "Українські слова",
  "Тематичні українські слова",
  "Англійські слова"
];

const dom = {
  setupScreen: document.getElementById("setup-screen"),
  gameScreen: document.getElementById("game-screen"),
  playerInputs: document.getElementById("player-inputs"),
  addPlayerBtn: document.getElementById("add-player-btn"),
  removePlayerBtn: document.getElementById("remove-player-btn"),
  resetSetupBtn: document.getElementById("reset-setup-btn"),
  roundsCount: document.getElementById("rounds-count"),
  roundLegend: document.getElementById("round-legend"),
  expectedSetsBox: document.getElementById("expected-sets-box"),
  copyPromptBtn: document.getElementById("copy-prompt-btn"),
  promptText: document.getElementById("prompt-text"),
  buildWordFieldsBtn: document.getElementById("build-word-fields-btn"),
  wordsPanel: document.getElementById("words-panel"),
  wordFields: document.getElementById("word-fields"),
  wordSetsProgress: document.getElementById("word-sets-progress"),
  validationSummary: document.getElementById("validation-summary"),
  startGameBtn: document.getElementById("start-game-btn"),
  scoreboard: document.getElementById("scoreboard"),
  turnOrder: document.getElementById("turn-order"),
  eventLog: document.getElementById("event-log"),
  gamePanel: document.getElementById("game-panel")
};

const STORAGE_KEY = "alias-host-app-state-v1";
const SETUP_DRAFT_KEY = "alias-host-app-setup-v1";

let setupPlayerCount = 4;

let state = createEmptyGameState();

function createEmptyGameState() {
  return {
    players: [],
    roundsCount: 3,
    wordSets: {},
    order: [],
    currentRoundIndex: 0,
    currentTurnIndex: 0,
    currentWordIndex: 0,
    phase: "setup",
    timeLeft: 0,
    timerId: null,
    isPaused: false,
    lastScoreSnapshot: null,
    log: []
  };
}

function init() {
  renderRoundLegend();

  if (!restoreSetupDraft()) {
    renderPlayerInputs();
    updateExpectedSets();
  }

  dom.addPlayerBtn.addEventListener("click", addPlayerInput);
  dom.removePlayerBtn.addEventListener("click", removePlayerInput);
  dom.resetSetupBtn.addEventListener("click", resetSetup);
  dom.roundsCount.addEventListener("change", () => {
    updateExpectedSets();
    if (!dom.wordsPanel.classList.contains("hidden")) {
      buildWordFields();
    }
  });
  dom.buildWordFieldsBtn.addEventListener("click", buildWordFields);
  dom.startGameBtn.addEventListener("click", startGameFromSetup);
  dom.copyPromptBtn.addEventListener("click", copyWordsPrompt);

  restoreSavedState();
}

function saveState() {
  if (state.phase === "setup") return;

  const { timerId, ...persistable } = state;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch {
    // Storage can be full or unavailable (e.g. private mode); the game keeps working without persistence.
  }
}

function clearSavedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: nothing to clear if storage is unavailable.
  }
}

function saveSetupDraft() {
  const draft = {
    playerNames: [...document.querySelectorAll(".player-name-input")].map(input => input.value),
    roundsCount: dom.roundsCount.value,
    words: {}
  };

  [...dom.wordFields.querySelectorAll("textarea")].forEach(textarea => {
    if (textarea.value.trim()) {
      draft.words[textarea.id] = textarea.value;
    }
  });

  try {
    localStorage.setItem(SETUP_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable: setup just won't survive a reload.
  }
}

function clearSetupDraft() {
  try {
    localStorage.removeItem(SETUP_DRAFT_KEY);
  } catch {
    // Ignore: nothing to clear if storage is unavailable.
  }
}

function restoreSetupDraft() {
  let draft = null;

  try {
    draft = JSON.parse(localStorage.getItem(SETUP_DRAFT_KEY));
  } catch {
    clearSetupDraft();
    return false;
  }

  if (!draft || !Array.isArray(draft.playerNames)) return false;

  const names = draft.playerNames.map(name => (typeof name === "string" ? name : ""));
  setupPlayerCount = Math.min(CONFIG.maxPlayers, Math.max(CONFIG.minPlayers, names.length));
  renderPlayerInputs(names);

  const rounds = Number(draft.roundsCount);
  if (rounds >= CONFIG.minRounds && rounds <= CONFIG.maxRounds) {
    dom.roundsCount.value = String(rounds);
  }

  updateExpectedSets();

  const words = draft.words && typeof draft.words === "object" ? draft.words : {};

  if (Object.keys(words).length && !validatePlayerNames(getPlayerNames()).length) {
    buildWordFields();

    [...dom.wordFields.querySelectorAll("textarea")].forEach(textarea => {
      if (typeof words[textarea.id] === "string") {
        textarea.value = words[textarea.id];
      }
    });

    updateWordCounters();
  }

  return true;
}

function isValidSavedState(saved) {
  if (!saved || typeof saved !== "object") return false;

  if (!["between-turns", "running", "extra", "round-ended", "game-ended"].includes(saved.phase)) {
    return false;
  }

  const playersValid =
    Array.isArray(saved.players) &&
    saved.players.length >= CONFIG.minPlayers &&
    saved.players.length <= CONFIG.maxPlayers &&
    saved.players.every(
      player =>
        player &&
        typeof player.id === "string" &&
        typeof player.name === "string" &&
        Number.isFinite(player.score)
    );

  if (!playersValid) return false;

  const playerIds = new Set(saved.players.map(player => player.id));
  const orderValid =
    Array.isArray(saved.order) &&
    saved.order.length === saved.players.length &&
    saved.order.every(id => playerIds.has(id));

  if (!orderValid) return false;

  if (!Array.isArray(saved.log) || !saved.log.every(item => typeof item === "string")) return false;
  if (!saved.wordSets || typeof saved.wordSets !== "object") return false;

  return [
    saved.roundsCount,
    saved.currentRoundIndex,
    saved.currentTurnIndex,
    saved.currentWordIndex,
    saved.timeLeft
  ].every(Number.isFinite);
}

function restoreSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

    if (!isValidSavedState(saved)) {
      if (saved !== null) clearSavedState();
      return;
    }

    state = { ...createEmptyGameState(), ...saved, timerId: null };

    if (state.phase === "running") {
      // A reload mid-turn restores as paused so the host resumes the timer deliberately.
      state.isPaused = true;
      state.log.push("Гру відновлено після перезавантаження. Таймер на паузі.");
    } else {
      state.log.push("Гру відновлено після перезавантаження.");
    }

    showGameScreen();
    renderGame();

    if (state.phase === "extra") {
      startTimer(state.timeLeft, handleExtraTimerFinished);
    }
  } catch {
    // A corrupted save must never block the app: drop it and start from the setup screen.
    clearSavedState();
    state = createEmptyGameState();
    showSetupScreen();
  }
}

function addPlayerInput() {
  if (setupPlayerCount >= CONFIG.maxPlayers) return;
  setupPlayerCount += 1;
  renderPlayerInputs();
  updateExpectedSets();
}

function removePlayerInput() {
  if (setupPlayerCount <= CONFIG.minPlayers) return;
  setupPlayerCount -= 1;
  renderPlayerInputs();
  updateExpectedSets();
}

function renderPlayerInputs(existingNames = []) {
  dom.playerInputs.innerHTML = "";

  for (let i = 0; i < setupPlayerCount; i += 1) {
    const row = document.createElement("div");
    row.className = "player-row";

    const index = document.createElement("div");
    index.className = "player-index";
    index.textContent = i + 1;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "player-name-input";
    input.placeholder = `Player ${i + 1}`;
    input.value = existingNames[i] || "";

    input.addEventListener("input", () => {
      updateExpectedSets();
      if (!dom.wordsPanel.classList.contains("hidden")) {
        buildWordFields();
      }
    });

    row.append(index, input);
    dom.playerInputs.appendChild(row);
  }

  dom.addPlayerBtn.disabled = setupPlayerCount >= CONFIG.maxPlayers;
  dom.removePlayerBtn.disabled = setupPlayerCount <= CONFIG.minPlayers;
}

function resetSetup() {
  stopTimer();
  clearSavedState();
  clearSetupDraft();
  state = createEmptyGameState();
  setupPlayerCount = 4;
  dom.roundsCount.value = "3";
  renderPlayerInputs();
  updateExpectedSets();
  dom.wordFields.innerHTML = "";
  dom.wordsPanel.classList.add("hidden");
  hideValidationSummary();
  showSetupScreen();
}

function getPlayerNames() {
  return [...document.querySelectorAll(".player-name-input")]
    .map(input => normalizeSpaces(input.value))
    .filter(Boolean);
}

function updateExpectedSets() {
  const rawNames = [...document.querySelectorAll(".player-name-input")];
  const playerCount = rawNames.length || setupPlayerCount;
  const roundsCount = Number(dom.roundsCount.value);
  const sets = playerCount * roundsCount;

  dom.expectedSetsBox.textContent = `${playerCount} players × ${roundsCount} rounds = ${sets} word sets`;

  updateRoundLegend(roundsCount);
  const enteredNames = rawNames.map(input => normalizeSpaces(input.value));
  dom.promptText.value = buildWordsPrompt(playerCount, roundsCount, enteredNames);
  saveSetupDraft();
}

function renderRoundLegend() {
  dom.roundLegend.innerHTML = ROUND_DESCRIPTIONS.map((description, index) => `
    <li data-round="${index + 1}">
      <strong>Раунд ${index + 1}</strong>
      <span>${description}</span>
    </li>
  `).join("");
}

function updateRoundLegend(roundsCount) {
  [...dom.roundLegend.querySelectorAll("li")].forEach(item => {
    item.classList.toggle("inactive", Number(item.dataset.round) > roundsCount);
  });
}

function copyWordsPrompt(event) {
  copyTextareaToClipboard(event, dom.promptText, dom.copyPromptBtn, "Copy prompt");
}

function copyTextareaToClipboard(event, textarea, button, idleLabel) {
  // The button lives inside <summary>: without preventDefault the click also toggles the <details>.
  event.preventDefault();
  event.stopPropagation();

  const showCopied = () => {
    button.textContent = "Copied!";
    window.setTimeout(() => {
      button.textContent = idleLabel;
    }, 1500);
  };

  const copyViaSelection = () => {
    textarea.select();
    document.execCommand("copy");
    showCopied();
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(textarea.value).then(showCopied).catch(copyViaSelection);
  } else {
    copyViaSelection();
  }
}

function buildWordsPrompt(playerCount, roundsCount, playerNames = []) {
  const wordsPerSet = CONFIG.wordsPerPlayerPerRound;
  const totalWords = playerCount * roundsCount * wordsPerSet;
  const playersList = Array.from(
    { length: playerCount },
    (_, i) => `${i + 1} - ${playerNames[i] || `Гравець ${i + 1}`}`
  ).join("\n");
  const ukWordsLine = Array.from({ length: wordsPerSet }, (_, i) => `слово${i + 1}`).join(", ");
  const enWordsLine = Array.from({ length: wordsPerSet }, (_, i) => `word${i + 1}`).join(", ");

  return `Згенеруй слова для гри Alias у форматі, зручному для копіювання в застосунок ведучого.

Перед генерацією врахуй мої параметри:

Кількість гравців: ${playerCount}
Кількість раундів: ${roundsCount}

Імена гравців:
${playersList}

Використовуй тільки стільки гравців, скільки вказано в параметрі “Кількість гравців”.

Правила формату:
- Для кожного гравця в кожному раунді потрібно рівно ${wordsPerSet} слів.
- Загальна кількість наборів слів = кількість гравців × кількість раундів.
- Наприклад:
  - 2 гравці × 1 раунд = 2 набори слів.
  - 4 гравці × 3 раунди = 12 наборів слів.
  - 6 гравців × 2 раунди = 12 наборів слів.
- Кожен набір має бути в один рядок.
- Слова в кожному рядку мають бути розділені комами.
- Не використовуй нумерацію всередині рядків.
- Не використовуй зайві пояснення після списків.
- Усі слова в межах всієї гри мають бути унікальні, без дублікатів.
- Не використовуй однакові слова в різних формах або мовах, якщо вони означають те саме.
  Наприклад: “піца” і “pizza” вважати дублем.
- Не використовуй спільнокореневі або похідні слова в межах всієї гри.
  Наприклад: “детектив” і “детективний”, “море” і “морський”, “ліс” і “лісник” вважати дублем.
- Це правило діє між усіма раундами і всіма гравцями, включно з англійськими словами раунду 3.
  Наприклад: “детектив” у раунді 1 і “detective” у раунді 3 вважати дублем.
- Якщо знайшов дублікати після генерації — заміни їх перед фінальною відповіддю.

Правила раундів:

Раунд 1:
- Завжди генерується, якщо кількість раундів 1 або більше.
- Українські слова.
- Різні сфери життя.
- Слова мають бути не надто легкі.
- Не використовуй занадто очевидні побутові слова типу “стіл”, “вікно”, “книга”, “телефон”.
- Слова мають бути придатні для пояснення в Alias.

Раунд 2:
- Генерується тільки якщо кількість раундів 2 або більше.
- Українські слова.
- Одна конкретна тематика.
- Тематику обери самостійно і випадково.
- Тематика має бути зрозуміла для дорослих гравців.
- Усі слова раунду 2 мають відповідати цій тематиці.
- Не повторюй слова з раунду 1.

Раунд 3:
- Генерується тільки якщо кількість раундів 3.
- Англійські слова.
- Пояснення в грі буде англійською.
- Орієнтовний рівень: B1–B2.
- Слова мають бути простішими, ніж у раунді 1.
- Тематика різна.
- Не використовуй дуже складні, рідкісні або вузькопрофесійні слова.
- Не повторюй слова з раундів 1–2, включно з перекладами або очевидними відповідниками.

Структура відповіді:

Якщо кількість раундів = 1, виведи тільки:

Раунд 1 — Українські слова, різні тематики

[Імʼя гравця 1]:
${ukWordsLine}

[Імʼя гравця 2]:
${ukWordsLine}

[І так далі для всіх гравців]


Якщо кількість раундів = 2, виведи:

Раунд 1 — Українські слова, різні тематики

[Імʼя гравця 1]:
${ukWordsLine}

[Імʼя гравця 2]:
${ukWordsLine}

[І так далі для всіх гравців]


Раунд 2 — Українські слова, тематика: [назва тематики]

[Імʼя гравця 1]:
${ukWordsLine}

[Імʼя гравця 2]:
${ukWordsLine}

[І так далі для всіх гравців]


Якщо кількість раундів = 3, виведи:

Раунд 1 — Українські слова, різні тематики

[Імʼя гравця 1]:
${ukWordsLine}

[Імʼя гравця 2]:
${ukWordsLine}

[І так далі для всіх гравців]


Раунд 2 — Українські слова, тематика: [назва тематики]

[Імʼя гравця 1]:
${ukWordsLine}

[Імʼя гравця 2]:
${ukWordsLine}

[І так далі для всіх гравців]


Round 3 — English words, mixed topics, B1–B2 level

[Імʼя гравця 1]:
${enWordsLine}

[Імʼя гравця 2]:
${enWordsLine}

[І так далі для всіх гравців]

ВАЖЛИВО: перед фінальною відповіддю виконай внутрішню валідацію.

1. Спочатку сформуй один глобальний список усіх слів гри.
2. Загальна кількість слів має бути: кількість гравців × кількість раундів × ${wordsPerSet}.
   Для моїх параметрів це рівно ${totalWords} слів (${playerCount} × ${roundsCount} × ${wordsPerSet}).
3. Перевір, що після нормалізації всі ${totalWords} слів унікальні:
   - нижній регістр;
   - без зайвих пробілів;
   - без дефісів і апострофів;
   - без однакових слів в іншій мові (“піца” / “pizza”, “детектив” / “detective”);
   - без спільнокореневих або очевидно похідних слів (“детектив” / “детективний”, “море” / “морський”).
4. Якщо знайдено дубль або близький дубль, заміни пізніше слово, а не перше.
5. Після кожної заміни повтори перевірку з кроку 3.
6. Не розподіляй слова по гравцях і раундах, доки глобальний список не пройшов перевірку.
7. Після розподілу перевір, що кількість наборів дорівнює: кількість гравців × кількість раундів,
   і що в кожному наборі рівно ${wordsPerSet} слів.
8. У фінальній відповіді виведи тільки готовий список у потрібному форматі, без опису перевірки.`;
}

function buildWordFields() {
  const playerNames = getPlayerNames();
  const errors = validatePlayerNames(playerNames);

  if (errors.length) {
    showValidationSummary(errors);
    dom.wordsPanel.classList.add("hidden");
    return;
  }

  hideValidationSummary();

  const roundsCount = Number(dom.roundsCount.value);
  dom.wordFields.innerHTML = "";

  for (let roundIndex = 0; roundIndex < roundsCount; roundIndex += 1) {
    const roundGroup = document.createElement("section");
    roundGroup.className = "round-group";

    const roundTitle = document.createElement("div");
    roundTitle.className = "round-title";
    roundTitle.innerHTML = `
      <strong>Round ${roundIndex + 1} · ${ROUND_DESCRIPTIONS[roundIndex]}</strong>
      <span class="muted">${playerNames.length} sets × ${CONFIG.wordsPerPlayerPerRound} words</span>
    `;

    const grid = document.createElement("div");
    grid.className = "word-set-grid";

    playerNames.forEach((name, playerIndex) => {
      const id = wordInputId(roundIndex, playerIndex);

      const set = document.createElement("div");
      set.className = "word-set";
      set.innerHTML = `
        <div class="word-set-header">
          <strong>${escapeHtml(name)}</strong>
          <span class="counter" data-counter-for="${id}">0/${CONFIG.wordsPerPlayerPerRound}</span>
        </div>
        <label class="field-label" for="${id}">
          Round ${roundIndex + 1} · ${escapeHtml(name)}
        </label>
        <textarea
          id="${id}"
          data-round-index="${roundIndex}"
          data-player-index="${playerIndex}"
          placeholder="Слово 1, Слово 2; Слово 3. Слово 4"
        ></textarea>
      `;

      grid.appendChild(set);
    });

    roundGroup.append(roundTitle, grid);
    dom.wordFields.appendChild(roundGroup);
  }

  dom.wordsPanel.classList.remove("hidden");

  [...dom.wordFields.querySelectorAll("textarea")].forEach(textarea => {
    textarea.addEventListener("input", updateWordCounters);
  });

  updateWordCounters();
}

function wordInputId(roundIndex, playerIndex) {
  return `words-r${roundIndex}-p${playerIndex}`;
}

function updateWordCounters() {
  const textareas = [...dom.wordFields.querySelectorAll("textarea")];
  let validCount = 0;

  textareas.forEach(textarea => {
    const words = parseWords(textarea.value);
    const counter = dom.wordFields.querySelector(`[data-counter-for="${textarea.id}"]`);

    if (!counter) return;

    counter.textContent = `${words.length}/${CONFIG.wordsPerPlayerPerRound}`;
    counter.classList.toggle("valid", words.length === CONFIG.wordsPerPlayerPerRound);

    if (words.length === CONFIG.wordsPerPlayerPerRound) {
      validCount += 1;
    }
  });

  dom.wordSetsProgress.textContent = `${validCount}/${textareas.length} valid sets`;
  saveSetupDraft();
}

function startGameFromSetup() {
  const playerNames = getPlayerNames();
  const roundsCount = Number(dom.roundsCount.value);
  const errors = validatePlayerNames(playerNames);

  if (roundsCount < CONFIG.minRounds || roundsCount > CONFIG.maxRounds) {
    errors.push(`Кількість раундів має бути від ${CONFIG.minRounds} до ${CONFIG.maxRounds}.`);
  }

  let wordData = null;

  if (dom.wordsPanel.classList.contains("hidden")) {
    errors.push("Спочатку створи поля для введення слів.");
  } else {
    wordData = collectWordData(playerNames, roundsCount);
    errors.push(...wordData.errors);
  }

  if (errors.length) {
    showValidationSummary(errors);
    dom.validationSummary.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  hideValidationSummary();

  const players = playerNames.map((name, index) => ({
    id: `player-${index}`,
    name,
    score: 0,
    icon: "",
    color: ""
  }));

  assignUniqueAvatars(players);

  state = createEmptyGameState();
  state.players = players;
  state.roundsCount = roundsCount;
  state.wordSets = wordData.wordSets;
  state.order = shuffle(players.map(player => player.id));
  state.currentRoundIndex = 0;
  state.currentTurnIndex = 0;
  state.currentWordIndex = 0;
  state.phase = "between-turns";
  state.log = [
    `Порядок визначено: ${state.order.map(id => logPlayer(getPlayerById(id, players))).join(" → ")}.`
  ];

  showGameScreen();
  renderGame();
}

function validatePlayerNames(playerNames) {
  const errors = [];

  if (playerNames.length < CONFIG.minPlayers) {
    errors.push(`Потрібно мінімум ${CONFIG.minPlayers} гравці.`);
  }

  if (playerNames.length > CONFIG.maxPlayers) {
    errors.push(`Максимум ${CONFIG.maxPlayers} гравців.`);
  }

  const normalized = playerNames.map(name => normalizeForDuplicateCheck(name));
  const duplicateNames = findDuplicates(normalized);

  if (duplicateNames.length) {
    errors.push("Імена гравців не мають повторюватись.");
  }

  const allInputCount = document.querySelectorAll(".player-name-input").length;
  if (playerNames.length !== allInputCount) {
    errors.push("Усі поля з іменами гравців мають бути заповнені.");
  }

  return errors;
}

function collectWordData(playerNames, roundsCount) {
  const errors = [];
  const wordSets = {};
  const allWords = [];

  for (let roundIndex = 0; roundIndex < roundsCount; roundIndex += 1) {
    wordSets[roundIndex] = {};

    playerNames.forEach((name, playerIndex) => {
      const textarea = document.getElementById(wordInputId(roundIndex, playerIndex));
      const words = textarea ? parseWords(textarea.value) : [];
      const playerId = `player-${playerIndex}`;

      if (words.length !== CONFIG.wordsPerPlayerPerRound) {
        errors.push(
          `Round ${roundIndex + 1}, ${name}: потрібно рівно ${CONFIG.wordsPerPlayerPerRound} слів, зараз ${words.length}.`
        );
      }

      wordSets[roundIndex][playerId] = words;

      words.forEach(word => {
        allWords.push({
          original: word,
          normalized: normalizeForDuplicateCheck(word),
          location: `Round ${roundIndex + 1}, ${name}`
        });
      });
    });
  }

  const seen = new Map();
  const duplicates = [];

  allWords.forEach(item => {
    if (seen.has(item.normalized)) {
      duplicates.push({
        word: item.original,
        first: seen.get(item.normalized),
        second: item.location
      });
    } else {
      seen.set(item.normalized, item.location);
    }
  });

  if (duplicates.length) {
    const duplicateList = duplicates
      .slice(0, 8)
      .map(item => `“${item.word}” повторюється: ${item.first} і ${item.second}`)
      .join("; ");

    errors.push(`Слова не мають повторюватись. ${duplicateList}.`);
  }

  return { wordSets, errors };
}

function parseWords(raw) {
  return raw
    .split(/[,.;\n]+/u)
    .map(normalizeSpaces)
    .filter(Boolean);
}

function normalizeSpaces(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeForDuplicateCheck(value) {
  return normalizeSpaces(value)
    .normalize("NFC")
    .replace(/[ʼ’`´]/g, "'")
    .toLocaleLowerCase("uk-UA");
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();

  values.forEach(value => {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  });

  return [...duplicates];
}

function assignUniqueAvatars(players) {
  const colors = shuffle([...CONFIG.colors]);
  const icons = shuffle([...CONFIG.icons]);

  players.forEach((player, index) => {
    player.color = colors[index];
    player.icon = icons[index];
  });
}

function shuffle(input) {
  const arr = [...input];

  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function showSetupScreen() {
  dom.setupScreen.classList.add("active");
  dom.gameScreen.classList.remove("active");
}

function showGameScreen() {
  dom.setupScreen.classList.remove("active");
  dom.gameScreen.classList.add("active");
}

function renderGame() {
  renderScoreboard();
  renderTurnOrder();
  renderLog();
  renderMainGamePanel();
  saveState();
}

function renderScoreboard() {
  // Ties (including the 0:0 start) follow turn order so the scoreboard matches the "Order" panel.
  const sorted = [...state.players].sort(
    (a, b) => b.score - a.score || state.order.indexOf(a.id) - state.order.indexOf(b.id)
  );

  dom.scoreboard.innerHTML = sorted.map(player => {
    const isCurrent = getCurrentExplainer()?.id === player.id;
    return `
      <div class="player-card ${isCurrent ? "active" : ""}">
        <div class="player-identity">
          ${renderAvatar(player)}
          <div>
            <div class="player-name">${escapeHtml(player.name)}</div>
            <div class="player-meta">${isCurrent ? "Пояснює зараз" : "Гравець"}</div>
          </div>
        </div>
        <div class="score-value">${player.score}</div>
      </div>
    `;
  }).join("");
}

function renderTurnOrder() {
  dom.turnOrder.innerHTML = state.order.map((playerId, index) => {
    const player = getPlayerById(playerId);
    const isActive = state.currentTurnIndex === index && !["round-ended", "game-ended"].includes(state.phase);
    const isDone = index < state.currentTurnIndex || state.phase === "round-ended" || state.phase === "game-ended";

    return `
      <div class="order-card ${isActive ? "active" : ""}">
        <div class="player-identity">
          ${renderAvatar(player)}
          <div>
            <div class="player-name">${index + 1}. ${escapeHtml(player.name)}</div>
            <div class="player-meta">${isDone ? "Done in this round" : isActive ? "Current" : "Waiting"}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderLog() {
  // Log entries are HTML built only by logPlayer/escapeHtml, so they are safe to inject.
  const items = [...state.log].reverse();

  dom.eventLog.innerHTML = items.length
    ? items.map(item => `<div class="log-item">${item}</div>`).join("")
    : `<div class="log-item">Подій ще немає.</div>`;
}

function renderMainGamePanel() {
  if (state.phase === "between-turns") {
    renderBetweenTurnsPanel();
    return;
  }

  if (state.phase === "running" || state.phase === "extra") {
    renderActiveTurnPanel();
    return;
  }

  if (state.phase === "round-ended") {
    renderRoundEndedPanel();
    return;
  }

  if (state.phase === "game-ended") {
    renderFinalPanel();
    return;
  }
}

function renderBetweenTurnsPanel() {
  const explainer = getCurrentExplainer();
  const turnWords = state.wordSets[state.currentRoundIndex]?.[explainer?.id] || [];

  dom.gamePanel.innerHTML = `
    ${renderStatusCards()}
    <div class="between-card">
      <p class="eyebrow">Ready</p>
      <h2>Наступний пояснює: ${renderInlinePlayer(explainer)}</h2>
      <p class="muted">
        Раунд ${state.currentRoundIndex + 1}/${state.roundsCount}.
        Натисни Start turn, коли гравець готовий.
      </p>
      ${turnWords.length ? `
        <details class="prompt-card turn-words-card">
          <summary>
            <span>
              <strong>Слова цього ходу</strong>
              <span class="muted">Скопіюй набір слів ${escapeHtml(explainer.name)} для Round ${state.currentRoundIndex + 1}</span>
            </span>
            <button id="copy-turn-words-btn" class="secondary-btn" type="button">Copy words</button>
          </summary>
          <textarea id="turn-words-text" class="prompt-text compact" readonly spellcheck="false">${turnWords.map(word => escapeHtml(word)).join(", ")}</textarea>
        </details>
      ` : ""}
      <div class="control-row">
        <button id="start-turn-btn" class="primary-btn big-action" type="button">Start turn</button>
        ${renderUndoButtonIfAvailable()}
        <button id="finish-game-btn" class="danger-btn" type="button">Finish game</button>
      </div>
    </div>
  `;

  document.getElementById("copy-turn-words-btn")?.addEventListener("click", event => {
    copyTextareaToClipboard(
      event,
      document.getElementById("turn-words-text"),
      document.getElementById("copy-turn-words-btn"),
      "Copy words"
    );
  });
  document.getElementById("start-turn-btn").addEventListener("click", startTurn);
  document.getElementById("undo-last-score-btn")?.addEventListener("click", undoLastScore);
  document.getElementById("finish-game-btn").addEventListener("click", endGameEarly);
}

function renderRoundEndedPanel() {
  dom.gamePanel.innerHTML = `
    ${renderStatusCards()}
    <div class="between-card">
      <p class="eyebrow">Round complete</p>
      <h2>Раунд ${state.currentRoundIndex + 1} завершено</h2>
      <p class="muted">Усі гравці зробили хід у цьому раунді.</p>
      <div class="control-row">
        <button id="start-new-round-btn" class="primary-btn big-action" type="button">Start new round</button>
        ${renderUndoButtonIfAvailable()}
        <button id="finish-game-btn" class="danger-btn" type="button">Finish game</button>
      </div>
    </div>
  `;

  document.getElementById("start-new-round-btn").addEventListener("click", startNewRound);
  document.getElementById("undo-last-score-btn")?.addEventListener("click", undoLastScore);
  document.getElementById("finish-game-btn").addEventListener("click", endGameEarly);
}

function renderActiveTurnPanel() {
  const explainer = getCurrentExplainer();
  const currentWord = getCurrentWord();
  const guessers = state.players.filter(player => player.id !== explainer.id);
  const isExtra = state.phase === "extra";
  const isPaused = state.isPaused;

  dom.gamePanel.innerHTML = `
    ${renderStatusCards()}
    <div class="turn-hero">
      <div class="presenter-line">
        ${renderAvatar(explainer)}
        <div>
          <p class="eyebrow">${isExtra ? "Extra minute" : isPaused ? "Paused" : "Main time"}</p>
          <h2>${escapeHtml(explainer.name)} пояснює</h2>
        </div>
      </div>

      <div class="current-word">
        <div>
          <small>Word ${state.currentWordIndex + 1}/${CONFIG.wordsPerPlayerPerRound}</small>
          <strong>${escapeHtml(currentWord || "—")}</strong>
        </div>
      </div>

      <div class="timer-row">
        <div>
          <div class="status-label">Timer</div>
          <div id="timer-display" class="timer ${isExtra ? "extra" : ""} ${isPaused ? "paused" : ""}">${formatTime(state.timeLeft)}</div>
        </div>
        <div class="pill">${isExtra ? "Only current word can be finished" : isPaused ? "Гру призупинено" : "New words are allowed"}</div>
      </div>

      <div>
        <div class="status-label">Хто першим відгадав?</div>
        <div class="guess-grid">
          ${guessers.map(player => `
            <button
              class="score-btn"
              data-guesser-id="${player.id}"
              style="background: ${player.color}"
              type="button"
              ${isPaused ? "disabled" : ""}
            >
              <span>${player.icon}</span>
              <span>${escapeHtml(player.name)}</span>
            </button>
          `).join("")}
        </div>
      </div>

      <div class="control-row">
        ${isExtra ? "" : `
          <button id="pause-turn-btn" class="secondary-btn" type="button">
            ${isPaused ? "▶ Resume" : "⏸ Pause"}
          </button>
        `}
        <button id="skip-word-btn" class="secondary-btn" type="button" ${isPaused ? "disabled" : ""}>Skip word</button>
        <button id="undo-last-score-btn" class="secondary-btn" type="button" ${state.lastScoreSnapshot ? "" : "disabled"}>
          Undo last score
        </button>
        <button id="end-turn-btn" class="danger-btn" type="button">End turn</button>
        <button id="finish-game-btn" class="danger-btn" type="button">Finish game</button>
      </div>
    </div>
  `;

  dom.gamePanel.querySelectorAll("[data-guesser-id]").forEach(button => {
    button.addEventListener("click", () => handleGuess(button.dataset.guesserId));
  });

  document.getElementById("pause-turn-btn")?.addEventListener("click", togglePause);
  document.getElementById("finish-game-btn").addEventListener("click", endGameEarly);
  document.getElementById("skip-word-btn").addEventListener("click", skipWord);
  document.getElementById("undo-last-score-btn").addEventListener("click", undoLastScore);
  document.getElementById("end-turn-btn").addEventListener("click", () => {
    const shouldEnd = window.confirm("Завершити поточний хід без зарахування поточного слова?");
    if (shouldEnd) {
      state.log.push(`Хід ${logPlayer(getCurrentExplainer())} завершено вручну.`);
      advanceAfterTurn({ keepUndo: false });
    }
  });

  updateTimerDisplay();
}

function renderFinalPanel() {
  const ranked = getRankedPlayers();
  const maxScore = Math.max(...state.players.map(player => player.score));
  const winners = state.players.filter(player => player.score === maxScore);

  dom.gamePanel.innerHTML = `
    <div class="final-card">
      <p class="eyebrow">Game complete</p>
      <h2>Фінальний результат</h2>

      <div class="winner-box">
        ${winners.length === 1
          ? `Переможець: ${escapeHtml(winners[0].name)} · ${winners[0].score} points`
          : `Нічия: ${winners.map(player => escapeHtml(player.name)).join(", ")} · ${maxScore} points`}
      </div>

      <div class="final-table">
        ${ranked.map(item => `
          <div class="rank-row">
            <div class="rank-place">#${item.place}</div>
            <div class="player-identity">
              ${renderAvatar(item.player)}
              <div>
                <div class="player-name">${escapeHtml(item.player.name)}</div>
                <div class="player-meta">Final place</div>
              </div>
            </div>
            <div class="score-value">${item.player.score}</div>
          </div>
        `).join("")}
      </div>

      <div class="control-row">
        <button id="start-new-game-btn" class="primary-btn big-action" type="button">Start new game</button>
        ${renderUndoButtonIfAvailable()}
      </div>
    </div>
  `;

  document.getElementById("undo-last-score-btn")?.addEventListener("click", undoLastScore);
  document.getElementById("start-new-game-btn").addEventListener("click", () => {
    const confirmed = window.confirm("Почати нову гру? Поточний результат буде очищено.");
    if (confirmed) {
      resetSetup();
    }
  });
}

function renderStatusCards() {
  const explainer = getCurrentExplainer();

  return `
    <div class="host-status">
      <div class="status-card">
        <div class="status-label">Раунд</div>
        <div class="status-value">${state.currentRoundIndex + 1}/${state.roundsCount}</div>
      </div>
      <div class="status-card">
        <div class="status-label">Пояснювач</div>
        <div class="status-value">${explainer ? escapeHtml(explainer.name) : "—"}</div>
      </div>
      <div class="status-card">
        <div class="status-label">Слово</div>
        <div class="status-value">${Math.min(state.currentWordIndex + 1, CONFIG.wordsPerPlayerPerRound)}/${CONFIG.wordsPerPlayerPerRound}</div>
      </div>
    </div>
  `;
}

function renderAvatar(player) {
  if (!player) return "";
  return `<span class="avatar" style="background: ${player.color}">${player.icon}</span>`;
}

function renderInlinePlayer(player) {
  if (!player) return "—";
  return `<span class="player-identity" style="display:inline-flex; vertical-align:middle;">${renderAvatar(player)}<span>${escapeHtml(player.name)}</span></span>`;
}

function logPlayer(player) {
  if (!player) return "—";
  return `<span class="log-player" style="color: ${player.color}"><span class="log-avatar" style="background: ${player.color}">${player.icon}</span>${escapeHtml(player.name)}</span>`;
}

function renderUndoButtonIfAvailable() {
  if (!state.lastScoreSnapshot) return "";
  return `<button id="undo-last-score-btn" class="secondary-btn" type="button">Undo last score</button>`;
}

function endGameEarly() {
  if (!["between-turns", "running", "extra", "round-ended"].includes(state.phase)) return;

  const confirmed = window.confirm("Завершити гру зараз і показати фінальний результат?");
  if (!confirmed) return;

  stopTimer();
  state.isPaused = false;
  state.lastScoreSnapshot = null;
  state.phase = "game-ended";
  state.log.push("Гру завершено достроково.");
  renderGame();
}

function togglePause() {
  if (state.phase !== "running") return;

  if (state.isPaused) {
    state.isPaused = false;
    state.log.push("Паузу знято, таймер продовжено.");
    renderGame();
    startTimer(state.timeLeft, handleMainTimerFinished);
  } else {
    stopTimer();
    state.isPaused = true;
    state.log.push("Хід поставлено на паузу.");
    renderGame();
  }
}

function startTurn() {
  if (state.phase !== "between-turns") return;

  state.currentWordIndex = 0;
  state.lastScoreSnapshot = null;
  state.phase = "running";
  state.isPaused = false;
  state.log.push(`Старт ходу: ${logPlayer(getCurrentExplainer())}, Round ${state.currentRoundIndex + 1}.`);

  renderGame();
  startTimer(CONFIG.mainSeconds, handleMainTimerFinished);
}

function startNewRound() {
  if (state.phase !== "round-ended") return;

  state.currentRoundIndex += 1;
  state.currentTurnIndex = 0;
  state.currentWordIndex = 0;
  state.lastScoreSnapshot = null;
  state.phase = "between-turns";
  state.log.push(`Старт Round ${state.currentRoundIndex + 1}.`);

  renderGame();
}

function handleGuess(guesserId) {
  if (!["running", "extra"].includes(state.phase) || state.isPaused) return;

  const explainer = getCurrentExplainer();
  const guesser = getPlayerById(guesserId);

  if (!explainer || !guesser || guesser.id === explainer.id) return;

  const snapshot = takeSnapshot();

  explainer.score += 2;
  guesser.score += 1;
  state.lastScoreSnapshot = snapshot;

  const word = getCurrentWord();
  state.log.push(
    `${logPlayer(guesser)} відгадав “${escapeHtml(word)}”. ${logPlayer(explainer)} +2, ${logPlayer(guesser)} +1.`
  );

  if (state.phase === "extra") {
    stopTimer();
    advanceAfterTurn({ keepUndo: true });
    return;
  }

  state.currentWordIndex += 1;

  if (state.currentWordIndex >= CONFIG.wordsPerPlayerPerRound) {
    stopTimer();
    advanceAfterTurn({ keepUndo: true });
    return;
  }

  renderGame();
}

function skipWord() {
  if (!["running", "extra"].includes(state.phase) || state.isPaused) return;

  const skippedWord = getCurrentWord();
  state.log.push(`Слово “${escapeHtml(skippedWord)}” пропущено.`);
  state.lastScoreSnapshot = null;

  if (state.phase === "extra") {
    advanceAfterTurn({ keepUndo: false });
    return;
  }

  state.currentWordIndex += 1;

  if (state.currentWordIndex >= CONFIG.wordsPerPlayerPerRound) {
    advanceAfterTurn({ keepUndo: false });
    return;
  }

  renderGame();
}

function undoLastScore() {
  if (!state.lastScoreSnapshot) return;

  const snapshot = state.lastScoreSnapshot;
  restoreSnapshot(snapshot);
  state.lastScoreSnapshot = null;
  state.log.push("Останнє нарахування балів скасовано.");
  renderGame();

  if (state.isPaused) return;

  if (state.phase === "running") {
    startTimer(state.timeLeft, handleMainTimerFinished);
  }

  if (state.phase === "extra") {
    startTimer(state.timeLeft, handleExtraTimerFinished);
  }
}

function advanceAfterTurn({ keepUndo }) {
  stopTimer();
  state.isPaused = false;

  if (!keepUndo) {
    state.lastScoreSnapshot = null;
  }

  const finishedPlayer = getCurrentExplainer();
  if (finishedPlayer) {
    state.log.push(`Хід завершено: ${logPlayer(finishedPlayer)}.`);
  }

  state.currentTurnIndex += 1;
  state.currentWordIndex = 0;

  if (state.currentTurnIndex >= state.order.length) {
    if (state.currentRoundIndex >= state.roundsCount - 1) {
      state.phase = "game-ended";
      state.log.push("Гру завершено.");
    } else {
      state.phase = "round-ended";
      state.log.push(`Round ${state.currentRoundIndex + 1} завершено.`);
    }
  } else {
    state.phase = "between-turns";
  }

  renderGame();
}

function handleMainTimerFinished() {
  if (state.phase !== "running") return;

  const startExtra = window.confirm("Почати додаткову хвилину для поточного слова?");

  if (startExtra) {
    state.phase = "extra";
    state.lastScoreSnapshot = null;
    state.log.push("Запущено додаткову хвилину для поточного слова.");
    renderGame();
    startTimer(CONFIG.extraSeconds, handleExtraTimerFinished);
  } else {
    state.log.push("Основний час завершено. Додаткову хвилину не запущено.");
    advanceAfterTurn({ keepUndo: false });
  }
}

function handleExtraTimerFinished() {
  if (state.phase !== "extra") return;

  state.log.push("Додаткова хвилина завершилась. Слово не зараховано.");
  advanceAfterTurn({ keepUndo: false });
}

let timerDeadline = 0;

function startTimer(seconds, onFinish) {
  stopTimer();
  state.timeLeft = seconds;
  // The deadline is wall-clock based, so the countdown stays correct even when
  // setInterval drifts or the browser throttles timers in a background tab.
  timerDeadline = Date.now() + seconds * 1000;
  updateTimerDisplay();

  state.timerId = window.setInterval(() => {
    const remaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));

    if (remaining !== state.timeLeft) {
      state.timeLeft = remaining;
      updateTimerDisplay();
      saveState();
    }

    if (remaining <= 0) {
      stopTimer();
      onFinish();
    }
  }, 250);
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function updateTimerDisplay() {
  const timerDisplay = document.getElementById("timer-display");
  if (timerDisplay) {
    timerDisplay.textContent = formatTime(Math.max(0, state.timeLeft));
  }
}

function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function takeSnapshot() {
  return {
    scores: Object.fromEntries(state.players.map(player => [player.id, player.score])),
    currentRoundIndex: state.currentRoundIndex,
    currentTurnIndex: state.currentTurnIndex,
    currentWordIndex: state.currentWordIndex,
    phase: state.phase,
    timeLeft: state.timeLeft,
    log: [...state.log]
  };
}

function restoreSnapshot(snapshot) {
  stopTimer();

  state.players.forEach(player => {
    player.score = snapshot.scores[player.id] ?? player.score;
  });

  state.currentRoundIndex = snapshot.currentRoundIndex;
  state.currentTurnIndex = snapshot.currentTurnIndex;
  state.currentWordIndex = snapshot.currentWordIndex;
  state.phase = snapshot.phase;
  state.timeLeft = snapshot.timeLeft;
  state.log = [...snapshot.log];
}

function getCurrentExplainer() {
  if (!state.order.length) return null;
  return getPlayerById(state.order[state.currentTurnIndex]);
}

function getCurrentWord() {
  const explainer = getCurrentExplainer();
  if (!explainer) return null;

  return state.wordSets[state.currentRoundIndex]?.[explainer.id]?.[state.currentWordIndex] || null;
}

function getPlayerById(id, players = state.players) {
  return players.find(player => player.id === id) || null;
}

function getRankedPlayers() {
  const sorted = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let previousScore = null;
  let previousPlace = 0;

  return sorted.map((player, index) => {
    const place = player.score === previousScore ? previousPlace : index + 1;
    previousScore = player.score;
    previousPlace = place;

    return { player, place };
  });
}

function showValidationSummary(errors) {
  dom.validationSummary.classList.remove("hidden");
  dom.validationSummary.innerHTML = `
    <strong>Потрібно виправити:</strong>
    <ul>${errors.map(error => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
  `;
}

function hideValidationSummary() {
  dom.validationSummary.classList.add("hidden");
  dom.validationSummary.innerHTML = "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

init();
