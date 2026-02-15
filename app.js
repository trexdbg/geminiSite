const DECISIONS_FILE = "./paper_decisions.jsonl";
const PORTFOLIO_FILE = "./paper_portfolio.json";
const REFRESH_INTERVAL_MS = 120000;

const ACTION_STYLE = {
  BUY: { label: "ACHAT", badgeClass: "badge-buy", color: "#12c48b" },
  SELL: { label: "VENTE", badgeClass: "badge-sell", color: "#ff6262" },
  HOLD: { label: "ATTENTE", badgeClass: "badge-hold", color: "#f6a928" }
};

const palette = ["#3ad0ff", "#12c48b", "#f6a928", "#ff6262", "#8cc3ff", "#ff9f6f"];
const VALUE_RANGE_DAYS = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
  "1y": 365
};

let valueChart = null;
let exposureChart = null;
let inspectTradeChart = null;
let selectedDecisionId = null;
let activeMainView = "dashboard";
let activeValueRange = "1m";
let latestValueSeries = [];
let activeInspectorEntry = null;

const INSPECT_INDICATOR_META = {
  ema20: { label: "EMA20", color: "#3ad0ff", axis: "y" },
  ema50: { label: "EMA50", color: "#f6a928", axis: "y" },
  ema200: { label: "EMA200", color: "#8cc3ff", axis: "y" },
  rsi: { label: "RSI", color: "#73e4bd", axis: "yRsi" },
  atr_pct: { label: "ATR%", color: "#ff9f6f", axis: "yPct" }
};

const el = {
  statusMessage: document.getElementById("statusMessage"),
  updatedAt: document.getElementById("updatedAt"),
  kpiTotalValue: document.getElementById("kpiTotalValue"),
  kpiTotalPnl: document.getElementById("kpiTotalPnl"),
  kpiCash: document.getElementById("kpiCash"),
  kpiTrades: document.getElementById("kpiTrades"),
  kpiFees: document.getElementById("kpiFees"),
  kpiOpenPositions: document.getElementById("kpiOpenPositions"),
  kpiExposure: document.getElementById("kpiExposure"),
  latestActionBadge: document.getElementById("latestActionBadge"),
  latestSymbol: document.getElementById("latestSymbol"),
  latestPrice: document.getElementById("latestPrice"),
  latestConfidence: document.getElementById("latestConfidence"),
  latestSentiment: document.getElementById("latestSentiment"),
  latestModel: document.getElementById("latestModel"),
  latestReason: document.getElementById("latestReason"),
  latestRisk: document.getElementById("latestRisk"),
  latestError: document.getElementById("latestError"),
  newsSummary: document.getElementById("newsSummary"),
  newsList: document.getElementById("newsList"),
  inspectTime: document.getElementById("inspectTime"),
  inspectSymbol: document.getElementById("inspectSymbol"),
  inspectActionBadge: document.getElementById("inspectActionBadge"),
  inspectConfidence: document.getElementById("inspectConfidence"),
  inspectPrice: document.getElementById("inspectPrice"),
  inspectSentiment: document.getElementById("inspectSentiment"),
  inspectModel: document.getElementById("inspectModel"),
  inspectReason: document.getElementById("inspectReason"),
  inspectRisk: document.getElementById("inspectRisk"),
  inspectExecution: document.getElementById("inspectExecution"),
  inspectHeadline: document.getElementById("inspectHeadline"),
  inspectHeadlineLink: document.getElementById("inspectHeadlineLink"),
  inspectError: document.getElementById("inspectError"),
  inspectTradeChart: document.getElementById("inspectTradeChart"),
  inspectChartNote: document.getElementById("inspectChartNote"),
  inspectIndicatorInputs: Array.from(document.querySelectorAll("[data-inspect-indicator]")),
  viewBtnDashboard: document.getElementById("viewBtnDashboard"),
  viewBtnHistory: document.getElementById("viewBtnHistory"),
  viewPanelDashboard: document.getElementById("viewPanelDashboard"),
  viewPanelHistory: document.getElementById("viewPanelHistory"),
  valueRangeButtons: Array.from(document.querySelectorAll("[data-value-range]")),
  decisionsTableBody: document.getElementById("decisionsTableBody"),
  positionsTableBody: document.getElementById("positionsTableBody"),
  tradesTableBody: document.getElementById("tradesTableBody"),
  valueChart: document.getElementById("valueChart"),
  exposureChart: document.getElementById("exposureChart")
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function maybeFixText(value) {
  if (typeof value !== "string") {
    return "";
  }
  const clean = value.trim();
  if (!clean) {
    return "";
  }
  if (!/[Ãâ€™â€œâ€�]/.test(clean)) {
    return clean;
  }
  try {
    const bytes = Uint8Array.from(clean, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return clean;
  }
}

function truncateText(value, maxLength = 180) {
  const text = maybeFixText(value);
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatDate(value, withSeconds = false) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) {
    return "-";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: withSeconds ? "medium" : "short",
    hour12: false
  }).format(date);
}

function formatQty(value) {
  const qty = toNumber(value);
  if (qty === null) {
    return "-";
  }
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }).format(qty);
}

function getDecisionSymbol(entry) {
  return entry?.symbol || entry?.decision?.symbol || entry?.execution?.symbol || "-";
}

function getDecisionId(entry) {
  if (!entry) {
    return "";
  }
  if (entry.__scope_id) {
    return entry.__scope_id;
  }
  const timestamp = entry.timestamp_utc || "";
  const symbol = getDecisionSymbol(entry);
  const action = getAction(entry);
  return `${timestamp}|${symbol}|${action}`;
}

function getEntryDecisionBlocks(entry) {
  const blocks = [];

  if (Array.isArray(entry?.decisions)) {
    blocks.push(...entry.decisions.filter((item) => item && typeof item === "object"));
  }

  if (entry?.decision && typeof entry.decision === "object") {
    blocks.push(entry.decision);
  }

  if (!blocks.length) {
    return [];
  }

  const deduped = [];
  const seenSymbols = new Set();

  for (const block of blocks) {
    const symbolKey = normalizeSymbolLookupKey(block?.symbol || entry?.symbol || "");
    if (symbolKey) {
      if (seenSymbols.has(symbolKey)) {
        continue;
      }
      seenSymbols.add(symbolKey);
    }
    deduped.push(block);
  }

  return deduped;
}

function getEntryExecutionBlocks(entry) {
  const blocks = [];

  if (Array.isArray(entry?.executions)) {
    blocks.push(...entry.executions.filter((item) => item && typeof item === "object"));
  }

  if (entry?.execution && typeof entry.execution === "object") {
    blocks.push(entry.execution);
  }

  if (!blocks.length) {
    return [];
  }

  const deduped = [];
  const seen = new Set();

  for (const block of blocks) {
    const symbolKey = normalizeSymbolLookupKey(block?.symbol || entry?.symbol || "");
    const actionKey = normalizeAction(block?.action_fr || block?.action || block?.status_fr || block?.status);
    const statusKey = maybeFixText(block?.status || block?.status_fr || "");
    const qtyKey = toNumber(block?.executed_qty) ?? "";
    const notionalKey = toNumber(block?.executed_notional_usdt) ?? "";
    const dedupeKey = `${symbolKey}|${actionKey}|${statusKey}|${qtyKey}|${notionalKey}`;

    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    deduped.push(block);
  }

  return deduped;
}

function createScopedDecisionEntry(entry, decision, execution, scopeIndex = 0, symbolHint = "") {
  const symbol =
    maybeFixText(decision?.symbol || execution?.symbol || symbolHint || entry?.symbol || "-") || "-";
  const scopedDecision = decision && typeof decision === "object" ? decision : null;
  const scopedExecution = execution && typeof execution === "object" ? execution : null;
  const scoped = {
    ...entry,
    symbol,
    decision: scopedDecision,
    execution: scopedExecution
  };

  const timestamp = scoped.timestamp_utc || "";
  const action = getAction(scoped);
  scoped.__scope_index = scopeIndex;
  scoped.__scope_id = `${timestamp}|${symbol}|${action}|${scopeIndex}`;

  return scoped;
}

function getScopedDecisionEntries(entry) {
  if (!entry || typeof entry !== "object") {
    return [];
  }

  const decisions = getEntryDecisionBlocks(entry);
  const executions = getEntryExecutionBlocks(entry);

  const executionBySymbol = new Map();
  for (const execution of executions) {
    const symbolKey = normalizeSymbolLookupKey(execution?.symbol || "");
    if (symbolKey && !executionBySymbol.has(symbolKey)) {
      executionBySymbol.set(symbolKey, execution);
    }
  }

  if (decisions.length) {
    return decisions.map((decision, index) => {
      const symbol = decision?.symbol || entry?.symbol || executions[index]?.symbol || "-";
      const symbolKey = normalizeSymbolLookupKey(symbol);
      const execution = symbolKey ? executionBySymbol.get(symbolKey) || executions[index] || null : executions[index] || null;
      return createScopedDecisionEntry(entry, decision, execution, index, symbol);
    });
  }

  if (executions.length) {
    return executions.map((execution, index) =>
      createScopedDecisionEntry(entry, null, execution, index, execution?.symbol || entry?.symbol || "-")
    );
  }

  return [createScopedDecisionEntry(entry, entry?.decision || null, entry?.execution || null, 0, entry?.symbol || "-")];
}

function collectRecentScopedDecisions(decisions, limit = 40) {
  const scoped = [];
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const scopedEntries = getScopedDecisionEntries(decisions[index]);
    for (const scopedEntry of scopedEntries) {
      scoped.push(scopedEntry);
      if (scoped.length >= limit) {
        return scoped;
      }
    }
  }
  return scoped;
}

function getLatestScopedDecisionEntry(decisions) {
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const scopedEntries = getScopedDecisionEntries(decisions[index]);
    if (scopedEntries.length) {
      return scopedEntries[0];
    }
  }
  return null;
}

function getMostImpactfulHeadline(entry) {
  const sentiment = entry?.news_sentiment || {};
  if (sentiment?.most_impactful_headline && typeof sentiment.most_impactful_headline === "object") {
    return sentiment.most_impactful_headline;
  }
  if (Array.isArray(sentiment.top_headlines_used) && sentiment.top_headlines_used.length) {
    return sentiment.top_headlines_used[0];
  }
  return null;
}

function getEntryHeadlines(entry) {
  const sentiment = entry?.news_sentiment || {};
  const list = [];
  const impactful = getMostImpactfulHeadline(entry);
  if (impactful) {
    list.push(impactful);
  }

  if (Array.isArray(sentiment.top_headlines_used)) {
    list.push(...sentiment.top_headlines_used);
  }

  return list;
}

function normalizeHeadline(rawHeadline, fallbackTimestamp, symbol) {
  if (!rawHeadline || typeof rawHeadline !== "object") {
    return null;
  }

  const title = maybeFixText(rawHeadline.title);
  if (!title) {
    return null;
  }

  const publishedAt =
    parseDate(rawHeadline.published_utc || rawHeadline.published_at || rawHeadline.date) ||
    parseDate(fallbackTimestamp);

  return {
    title,
    source: maybeFixText(rawHeadline.source || "Source inconnue"),
    excerpt: maybeFixText(rawHeadline.excerpt || ""),
    link: maybeFixText(rawHeadline.link || ""),
    sentimentScore: toNumber(rawHeadline.sentiment_score),
    publishedAt,
    symbol: symbol || "-"
  };
}

function collectLatestHeadlines(decisions, limit = 8) {
  const dedup = new Map();

  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const entry = decisions[index];
    const symbol = getDecisionSymbol(entry);
    const entryHeadlines = getEntryHeadlines(entry);

    for (const headline of entryHeadlines) {
      const normalized = normalizeHeadline(headline, entry?.timestamp_utc, symbol);
      if (!normalized) {
        continue;
      }

      const key = normalized.link || `${normalized.source}|${normalized.title}`;
      const existing = dedup.get(key);
      const existingTime = existing?.publishedAt?.getTime() || 0;
      const candidateTime = normalized?.publishedAt?.getTime() || 0;

      if (!existing || candidateTime > existingTime) {
        dedup.set(key, normalized);
      }
    }
  }

  return Array.from(dedup.values())
    .sort((a, b) => (b?.publishedAt?.getTime() || 0) - (a?.publishedAt?.getTime() || 0))
    .slice(0, limit);
}

function formatUsdt(value, digits = 2) {
  const amount = toNumber(value);
  if (amount === null) {
    return "-";
  }
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(amount)} USDT`;
}

function formatPrice(value) {
  const price = toNumber(value);
  if (price === null) {
    return "-";
  }
  const abs = Math.abs(price);
  const digits = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
  return formatUsdt(price, digits);
}

function formatPriceNumber(value) {
  const price = toNumber(value);
  if (price === null) {
    return "-";
  }
  const abs = Math.abs(price);
  const digits = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(price);
}

function formatPct(value, digits = 2) {
  const pct = toNumber(value);
  if (pct === null) {
    return "-";
  }
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

function formatConfidence(value) {
  const confidence = toNumber(value);
  if (confidence === null) {
    return "-";
  }
  if (confidence <= 1) {
    return `${(confidence * 100).toFixed(0)}%`;
  }
  return `${confidence.toFixed(0)}%`;
}

function normalizeAction(rawAction) {
  const value = String(rawAction || "").toUpperCase();
  if (!value) {
    return "HOLD";
  }

  if (value.includes("BUY") || value.includes("ACHAT") || value.includes("OPEN")) {
    return "BUY";
  }

  if (value.includes("SELL") || value.includes("VENTE") || value.includes("CLOSE")) {
    return "SELL";
  }

  if (value.includes("HOLD") || value.includes("ATTENTE")) {
    return "HOLD";
  }

  return "HOLD";
}

function getAction(entry) {
  const candidates = [
    entry?.decision?.action_fr,
    entry?.decision?.action,
    entry?.execution?.action_fr,
    entry?.execution?.action,
    entry?.execution?.status_fr,
    entry?.execution?.status
  ];

  for (const item of candidates) {
    if (item) {
      return normalizeAction(item);
    }
  }

  return "HOLD";
}

function getSentiment(entry) {
  const sentiment = entry?.news_sentiment || {};
  const label = maybeFixText(sentiment.label_fr || sentiment.label || "N/A");
  const score = toNumber(sentiment.score);
  return { label, score };
}

function formatSentimentText(sentiment) {
  if (!sentiment) {
    return "-";
  }
  return sentiment.score === null ? sentiment.label : `${sentiment.label} (${sentiment.score.toFixed(2)})`;
}

function getSentimentTone(sentiment) {
  const label = String(sentiment?.label || "").toLowerCase();
  const score = toNumber(sentiment?.score);

  if (score !== null) {
    if (score > 0.2) {
      return "text-positive";
    }
    if (score < -0.2) {
      return "text-negative";
    }
    return "text-neutral";
  }

  if (label.includes("bull") || label.includes("pos")) {
    return "text-positive";
  }
  if (label.includes("bear") || label.includes("neg")) {
    return "text-negative";
  }
  return "text-neutral";
}

function parseJsonLines(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean) {
      continue;
    }
    try {
      entries.push(JSON.parse(clean));
    } catch (error) {
      console.warn("Ligne JSONL ignoree:", clean.slice(0, 140), error);
    }
  }
  return entries;
}

function setStatus(message, isError = false) {
  el.statusMessage.textContent = message;
  el.statusMessage.className = isError ? "text-negative" : "text-neutral";
}

function setActionBadge(element, action) {
  const style = ACTION_STYLE[action] || ACTION_STYLE.HOLD;
  element.textContent = style.label;
  element.classList.remove("badge-buy", "badge-sell", "badge-hold");
  element.classList.add(style.badgeClass);
}

function createBadge(action) {
  const span = document.createElement("span");
  span.className = "action-badge";
  setActionBadge(span, action);
  return span;
}

function getEntryTimestamp(entry) {
  return parseDate(entry?.timestamp_utc)?.getTime() || 0;
}

function computePositionRows(portfolio) {
  const positions = typeof portfolio?.positions === "object" && portfolio?.positions ? portfolio.positions : {};
  const lastPrices = typeof portfolio?.last_prices === "object" && portfolio?.last_prices ? portfolio.last_prices : {};

  const rows = Object.entries(positions)
    .map(([symbol, position]) => {
      const amount = toNumber(position?.asset_amount) || 0;
      const cost = toNumber(position?.position_cost_usdt) || 0;
      const spot = toNumber(lastPrices[symbol]);
      const value = spot !== null ? amount * spot : 0;
      const pnl = value - cost;
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : null;

      return {
        symbol,
        asset: position?.asset_symbol || symbol.replace("USDT", ""),
        amount,
        spot,
        value,
        cost,
        pnl,
        pnlPct
      };
    })
    .filter((row) => row.amount > 0 || row.cost > 0)
    .sort((a, b) => b.value - a.value);

  const totalExposure = rows.reduce((sum, row) => sum + row.value, 0);

  return { rows, totalExposure };
}

function extractTrades(decisions, portfolio) {
  const list = [];

  for (const entry of decisions) {
    const executionBlocks = getEntryExecutionBlocks(entry);
    const scopedEntries = getScopedDecisionEntries(entry);

    if (!executionBlocks.length) {
      continue;
    }

    for (let index = 0; index < executionBlocks.length; index += 1) {
      const execution = executionBlocks[index];
      const symbol = maybeFixText(execution?.symbol || entry?.symbol || "-") || "-";
      const symbolKey = normalizeSymbolLookupKey(symbol);
      const scopedForSymbol =
        scopedEntries.find((item) => normalizeSymbolLookupKey(getDecisionSymbol(item)) === symbolKey) ||
        scopedEntries[index] ||
        createScopedDecisionEntry(entry, null, execution, index, symbol);

      const action = getAction(scopedForSymbol);
      const qty = toNumber(execution.executed_qty) || 0;
      const notional = toNumber(execution.executed_notional_usdt) || 0;
      const fee = toNumber(execution.fee_usdt) || 0;
      const status = String(execution.status || "").toUpperCase();

      const isExecuted = qty > 0 || Math.abs(notional) > 0;
      const filledLike =
        status.includes("FILLED") || status.includes("EXEC") || status.includes("BUY") || status.includes("SELL");

      if (!isExecuted && !filledLike) {
        continue;
      }

      if (action === "HOLD" && !isExecuted) {
        continue;
      }

      list.push({
        timestamp: entry.timestamp_utc,
        symbol,
        action,
        qty,
        notional,
        fee
      });
    }
  }

  const history = Array.isArray(portfolio?.history) ? portfolio.history : [];

  for (const item of history) {
    list.push({
      timestamp: item.timestamp_utc || item.timestamp || item.time || item.created_at_utc,
      symbol: item.symbol || item.pair || item.market || "-",
      action: normalizeAction(item.side || item.action || item.type || item.status),
      qty: toNumber(item.qty ?? item.quantity ?? item.asset_amount ?? item.executed_qty) || 0,
      notional: toNumber(item.notional_usdt ?? item.notional ?? item.value_usdt ?? item.executed_notional_usdt) || 0,
      fee: toNumber(item.fee_usdt ?? item.fee) || 0
    });
  }

  const seen = new Set();
  const deduped = [];

  for (const trade of list) {
    const key = [trade.timestamp, trade.symbol, trade.action, trade.qty, trade.notional, trade.fee].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(trade);
  }

  deduped.sort((a, b) => (parseDate(b.timestamp)?.getTime() || 0) - (parseDate(a.timestamp)?.getTime() || 0));

  return deduped;
}

function buildSeries(decisions, portfolio) {
  const points = [];

  for (const entry of decisions) {
    const date = parseDate(entry?.timestamp_utc);
    const total = toNumber(entry?.portfolio_metrics?.total_value_usdt);
    if (!date || total === null) {
      continue;
    }

    points.push({
      date,
      total,
      action: getAction(entry),
      symbol: entry.symbol || entry?.execution?.symbol || entry?.decision?.symbol || "-",
      price: toNumber(entry?.price)
    });
  }

  if (!points.length) {
    const createdAt = parseDate(portfolio?.created_at_utc) || new Date();
    const cash = toNumber(portfolio?.cash_usdt) || 0;
    points.push({ date: createdAt, total: cash, action: "HOLD", symbol: "-", price: null });
  }

  return points;
}

function makeCell(text, className = "") {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) {
    td.className = className;
  }
  return td;
}

function makeEmptyRow(tbody, colSpan, message) {
  tbody.innerHTML = "";
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = colSpan;
  cell.textContent = message;
  cell.className = "text-neutral";
  row.appendChild(cell);
  tbody.appendChild(row);
}

function isMissingReasonText(text) {
  const clean = maybeFixText(text).toLowerCase();
  if (!clean) {
    return true;
  }

  if (clean === "-" || clean === "n/a") {
    return true;
  }

  return false;
}

function getDecisionModelUsed(entry) {
  return maybeFixText(
    entry?.gemini?.model_used ||
    entry?.gemini?.model ||
    entry?.gemini_model ||
    ""
  );
}

function getDecisionModelSummary(entry) {
  const modelUsed = getDecisionModelUsed(entry);
  return modelUsed || "-";
}

function getDecisionMarketScore(entry) {
  const symbol = getDecisionSymbol(entry);
  const marketScores = entry?.market_scores;
  if (!marketScores || typeof marketScores !== "object") {
    return null;
  }

  if (symbol && marketScores[symbol] !== undefined) {
    return toNumber(marketScores[symbol]);
  }

  const first = Object.values(marketScores)[0];
  return toNumber(first);
}

function getDecisionContextParts(entry) {
  const parts = [];
  const strategyMode = maybeFixText(entry?.decision?.strategy_mode || "");
  const regime = maybeFixText(entry?.decision?.regime_assessment || "");
  const timeframe = maybeFixText(entry?.timeframe || "");
  const score = getDecisionMarketScore(entry);
  const symbol = getDecisionSymbol(entry);
  const sentiment = entry?.news_sentiment || {};
  const sentimentLabel = maybeFixText(sentiment?.label_fr || sentiment?.label || "");
  const sentimentScore = toNumber(sentiment?.score);
  const biasHint = maybeFixText(sentiment?.bias_hint || "");
  const bullishCount = toNumber(sentiment?.bullish_headlines);
  const bearishCount = toNumber(sentiment?.bearish_headlines);
  const modelUsed = getDecisionModelUsed(entry);

  if (strategyMode) {
    parts.push(`strategie ${strategyMode}`);
  }
  if (regime) {
    parts.push(`regime ${regime}`);
  }
  if (score !== null) {
    parts.push(`score ${symbol}: ${score.toFixed(3)}`);
  }
  if (sentimentLabel || sentimentScore !== null) {
    const sentimentText = sentimentScore === null ? sentimentLabel : `${sentimentLabel} (${sentimentScore.toFixed(3)})`;
    parts.push(`sentiment ${sentimentText}`);
  }
  if (biasHint) {
    parts.push(`biais ${biasHint}`);
  }
  if (bullishCount !== null || bearishCount !== null) {
    const bullText = bullishCount === null ? "-" : String(bullishCount);
    const bearText = bearishCount === null ? "-" : String(bearishCount);
    parts.push(`headlines bull/bear ${bullText}/${bearText}`);
  }
  if (timeframe) {
    parts.push(`timeframe ${timeframe}`);
  }
  if (modelUsed) {
    parts.push(`modele ${modelUsed}`);
  }

  return parts;
}

function getDecisionReasonText(entry) {
  const reasonCandidates = [
    entry?.decision?.reason_fr,
    entry?.decision?.reason,
    entry?.decision?.rationale,
    entry?.decision?.explanation
  ];

  for (const candidate of reasonCandidates) {
    if (!isMissingReasonText(candidate)) {
      return maybeFixText(candidate);
    }
  }

  return "Aucune raison fournie par le modele.";
}

function getDecisionRiskText(entry) {
  const riskCandidates = [
    entry?.decision?.risk_note_fr,
    entry?.decision?.risk_note,
    entry?.decision?.risk,
    entry?.decision?.risk_comment
  ];

  for (const candidate of riskCandidates) {
    const clean = maybeFixText(candidate);
    if (clean) {
      return clean;
    }
  }

  const geminiError = maybeFixText(entry?.gemini_error || "");
  if (geminiError) {
    return `Risque non evalue (erreur modele): ${truncateText(geminiError, 180)}`;
  }

  const feedErrors = Array.isArray(entry?.news_sentiment?.feed_errors) ? entry.news_sentiment.feed_errors : [];
  const feedError = maybeFixText(feedErrors[0] || "");
  if (feedError) {
    return `Risque non evalue (erreur flux news): ${truncateText(feedError, 180)}`;
  }

  return "Aucune note de risque fournie.";
}

function setMainView(viewName) {
  const showDashboard = viewName !== "history";
  activeMainView = showDashboard ? "dashboard" : "history";

  if (!el.viewBtnDashboard || !el.viewBtnHistory || !el.viewPanelDashboard || !el.viewPanelHistory) {
    return;
  }

  el.viewBtnDashboard.classList.toggle("is-active", showDashboard);
  el.viewBtnHistory.classList.toggle("is-active", !showDashboard);
  el.viewBtnDashboard.setAttribute("aria-selected", String(showDashboard));
  el.viewBtnHistory.setAttribute("aria-selected", String(!showDashboard));

  el.viewPanelDashboard.classList.toggle("hidden", !showDashboard);
  el.viewPanelHistory.classList.toggle("hidden", showDashboard);
  el.viewPanelDashboard.classList.toggle("is-active", showDashboard);
  el.viewPanelHistory.classList.toggle("is-active", !showDashboard);
}

function initMainViewSwitch() {
  if (!el.viewBtnDashboard || !el.viewBtnHistory) {
    return;
  }

  el.viewBtnDashboard.addEventListener("click", () => {
    setMainView("dashboard");
  });

  el.viewBtnHistory.addEventListener("click", () => {
    setMainView("history");
  });

  setMainView(activeMainView);
}

function applyValueRangeButtonState() {
  for (const button of el.valueRangeButtons) {
    const range = button.dataset.valueRange;
    const isActive = range === activeValueRange;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function filterSeriesByRange(series, rangeKey) {
  if (!Array.isArray(series) || !series.length) {
    return [];
  }

  const days = VALUE_RANGE_DAYS[rangeKey];
  if (!days) {
    return series;
  }

  const lastDate = series.at(-1)?.date instanceof Date ? series.at(-1).date : parseDate(series.at(-1)?.date);
  if (!lastDate) {
    return series;
  }

  const cutoffMs = lastDate.getTime() - days * 24 * 60 * 60 * 1000;
  const firstIndex = series.findIndex((point) => point?.date instanceof Date && point.date.getTime() >= cutoffMs);

  if (firstIndex <= 0) {
    return series;
  }

  const ranged = series.slice(firstIndex);
  return [series[firstIndex - 1], ...ranged];
}

function renderValueChartByRange(series) {
  const filtered = filterSeriesByRange(series, activeValueRange);
  renderValueChart(filtered.length ? filtered : series);
}

function setValueRange(rangeKey) {
  if (!VALUE_RANGE_DAYS[rangeKey]) {
    return;
  }

  activeValueRange = rangeKey;
  applyValueRangeButtonState();

  if (latestValueSeries.length) {
    renderValueChartByRange(latestValueSeries);
  }
}

function initValueRangeSwitch() {
  if (!el.valueRangeButtons.length) {
    return;
  }

  for (const button of el.valueRangeButtons) {
    button.addEventListener("click", () => {
      const range = button.dataset.valueRange;
      setValueRange(range);
    });
  }

  applyValueRangeButtonState();
}

function getExecutionStatusInfo(entry) {
  const execution = entry?.execution || {};
  const action = getAction(entry);
  const qty = toNumber(execution.executed_qty) || 0;
  const notional = toNumber(execution.executed_notional_usdt) || 0;
  const isExecuted = qty > 0 || Math.abs(notional) > 0;

  const statusRaw = String(execution.status || "").toUpperCase();
  const statusFrRaw = maybeFixText(execution.status_fr || "").toUpperCase();
  const isIgnored = statusRaw.includes("SKIPPED") || statusFrRaw.includes("IGNORE");

  let ignoredReason = "";
  if (statusRaw.includes("TOO_SMALL") || statusFrRaw.includes("TROP_PETITE") || statusFrRaw.includes("TROP_PETIT")) {
    ignoredReason = "taille trop petite";
  } else if (statusRaw.includes("NO_POSITION") || statusFrRaw.includes("SANS_POSITION")) {
    ignoredReason = "aucune position ouverte";
  }

  const actionLabel = ACTION_STYLE[action]?.label || action || "ACTION";
  const fallbackStatus =
    maybeFixText(execution.status_fr || execution.status || execution.action_fr || execution.action) ||
    (isExecuted ? "EXECUTE" : "NON EXECUTE");
  const statusLabel = isIgnored
    ? `${actionLabel} IGNOREE${ignoredReason ? ` (${ignoredReason})` : ""}`
    : fallbackStatus;

  return {
    action,
    isExecuted,
    isIgnored,
    isIgnoredSell: action === "SELL" && isIgnored,
    statusLabel
  };
}

function getInspectorExecutionToneClass(entry) {
  const info = getExecutionStatusInfo(entry);
  if (info.isIgnoredSell) {
    return "text-neutral";
  }
  if (info.isExecuted) {
    if (info.action === "BUY") {
      return "text-positive";
    }
    if (info.action === "SELL") {
      return "text-negative";
    }
  }
  return "text-neutral";
}

function getDecisionExecutionSummary(entry, compact = false) {
  const execution = entry?.execution || {};
  const statusInfo = getExecutionStatusInfo(entry);
  const qty = toNumber(execution.executed_qty) || 0;
  const notional = toNumber(execution.executed_notional_usdt) || 0;
  const fee = toNumber(execution.fee_usdt) || 0;
  const allocation = toNumber(execution.allocation_pct ?? entry?.decision?.allocation_pct);

  if (compact) {
    if (statusInfo.isExecuted) {
      return `${statusInfo.statusLabel} | ${formatUsdt(notional)}`;
    }
    if (statusInfo.action === "HOLD") {
      return "Pas d'execution";
    }
    return `${statusInfo.statusLabel} | sans fill`;
  }

  const parts = [`Statut: ${statusInfo.statusLabel}`];
  if (allocation !== null) {
    parts.push(`Allocation cible: ${allocation.toFixed(1)}%`);
  }

  if (statusInfo.isExecuted) {
    parts.push(`Quantite: ${formatQty(qty)}`);
    parts.push(`Notional: ${formatUsdt(notional)}`);
    parts.push(`Fee: ${formatUsdt(fee, 4)}`);
  } else {
    parts.push(statusInfo.isIgnored ? "Execution ignoree par les garde-fous." : "Aucune execution detectee");
  }

  return parts.join(" | ");
}

function destroyInspectorTradeChart() {
  if (inspectTradeChart) {
    inspectTradeChart.destroy();
    inspectTradeChart = null;
  }
}

function setInspectorChartNote(message, toneClass = "text-neutral") {
  if (!el.inspectChartNote) {
    return;
  }
  el.inspectChartNote.textContent = message;
  el.inspectChartNote.className = `inspect-chart-note ${toneClass}`;
}

function setInspectorIndicatorAvailability(availableKeys = new Set()) {
  if (!Array.isArray(el.inspectIndicatorInputs) || !el.inspectIndicatorInputs.length) {
    return;
  }

  for (const input of el.inspectIndicatorInputs) {
    const isAvailable = availableKeys.has(input.value);
    input.disabled = !isAvailable;

    const label = input.closest("label");
    if (label) {
      label.classList.toggle("is-disabled", !isAvailable);
    }
  }
}

function getSelectedInspectorIndicatorKeys() {
  if (!Array.isArray(el.inspectIndicatorInputs) || !el.inspectIndicatorInputs.length) {
    return [];
  }

  return el.inspectIndicatorInputs
    .filter((input) => !input.disabled && input.checked && INSPECT_INDICATOR_META[input.value])
    .map((input) => input.value);
}

function normalizeSymbolLookupKey(symbol) {
  return String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getLastCandlesBlock(entry, symbol) {
  const lastCandles = entry?.last_candles;
  if (lastCandles && typeof lastCandles === "object") {
    const wanted = normalizeSymbolLookupKey(symbol || getDecisionSymbol(entry));

    if (wanted) {
      for (const [symbolKey, block] of Object.entries(lastCandles)) {
        if (normalizeSymbolLookupKey(symbolKey) === wanted) {
          return block;
        }
      }
    }

    for (const block of Object.values(lastCandles)) {
      if (!block || typeof block !== "object") {
        continue;
      }
      if (Array.isArray(block.candles) || block.last_candle || toNumber(block.t) !== null) {
        return block;
      }
    }
  }

  return entry?.last_candle || null;
}

function normalizeInspectorCandle(rawCandle) {
  if (!rawCandle || typeof rawCandle !== "object") {
    return null;
  }

  const timestamp =
    toNumber(rawCandle.t) ??
    parseDate(rawCandle.timestamp_utc)?.getTime() ??
    parseDate(rawCandle.timestamp)?.getTime();
  const close = toNumber(rawCandle.c ?? rawCandle.close ?? rawCandle.price);

  if (timestamp === null || close === null) {
    return null;
  }

  const indicators = rawCandle.indicators && typeof rawCandle.indicators === "object" ? rawCandle.indicators : {};

  return {
    t: timestamp,
    o: toNumber(rawCandle.o ?? rawCandle.open),
    h: toNumber(rawCandle.h ?? rawCandle.high),
    l: toNumber(rawCandle.l ?? rawCandle.low),
    c: close,
    indicators
  };
}

function extractInspectorCandles(entry, symbol) {
  const block = getLastCandlesBlock(entry, symbol);
  if (!block) {
    return [];
  }

  let source = [];
  if (Array.isArray(block.candles)) {
    source = block.candles;
  } else if (Array.isArray(block)) {
    source = block;
  } else if (block.last_candle && typeof block.last_candle === "object") {
    source = [block.last_candle];
  } else if (typeof block === "object") {
    source = [block];
  }

  const dedupByTime = new Map();
  for (const rawCandle of source) {
    const normalized = normalizeInspectorCandle(rawCandle);
    if (!normalized) {
      continue;
    }
    dedupByTime.set(normalized.t, normalized);
  }

  return Array.from(dedupByTime.values()).sort((a, b) => a.t - b.t);
}

function collectInspectorAvailableIndicators(candles) {
  const available = new Set();

  for (const candle of candles) {
    const indicators = candle?.indicators;
    if (!indicators || typeof indicators !== "object") {
      continue;
    }

    for (const indicatorKey of Object.keys(INSPECT_INDICATOR_META)) {
      if (toNumber(indicators[indicatorKey]) !== null) {
        available.add(indicatorKey);
      }
    }
  }

  return available;
}

function getInspectorTimeframe(entry, symbol) {
  const block = getLastCandlesBlock(entry, symbol);
  return maybeFixText(block?.timeframe || entry?.timeframe || "");
}

function buildInspectorIndicatorDataset(candles, indicatorKey) {
  const meta = INSPECT_INDICATOR_META[indicatorKey];
  if (!meta) {
    return null;
  }

  const values = candles.map((candle) => toNumber(candle?.indicators?.[indicatorKey]));
  if (!values.some((value) => value !== null)) {
    return null;
  }

  return {
    label: meta.label,
    data: values,
    yAxisID: meta.axis,
    borderColor: meta.color,
    backgroundColor: meta.color,
    borderWidth: meta.axis === "y" ? 1.8 : 1.6,
    borderDash: meta.axis === "y" ? [] : [6, 4],
    tension: 0.2,
    pointRadius: 0,
    spanGaps: true
  };
}

function renderInspectorTradeChart(entry) {
  if (!el.inspectTradeChart || !el.inspectChartNote) {
    return;
  }

  if (!window.Chart) {
    destroyInspectorTradeChart();
    setInspectorChartNote("Chart indisponible: Chart.js non charge.", "text-negative");
    return;
  }

  if (!entry) {
    destroyInspectorTradeChart();
    setInspectorIndicatorAvailability(new Set());
    setInspectorChartNote("Selectionne une decision pour afficher le chart.", "text-neutral");
    return;
  }

  const symbol = getDecisionSymbol(entry);
  const candles = extractInspectorCandles(entry, symbol);

  if (!candles.length) {
    destroyInspectorTradeChart();
    setInspectorIndicatorAvailability(new Set());
    setInspectorChartNote("Aucune serie candles disponible via last_candle/last_candles pour cette decision.", "text-negative");
    return;
  }

  const availableIndicators = collectInspectorAvailableIndicators(candles);
  setInspectorIndicatorAvailability(availableIndicators);

  const selectedIndicators = getSelectedInspectorIndicatorKeys();
  const labels = candles.map((candle) => formatDate(new Date(candle.t)));

  const datasets = [
    {
      label: `${symbol} close`,
      data: candles.map((candle) => candle.c),
      yAxisID: "y",
      borderColor: "#d9e8f1",
      backgroundColor: "rgba(217, 232, 241, 0.12)",
      borderWidth: 2.1,
      tension: 0.22,
      pointRadius: 0,
      spanGaps: true
    }
  ];

  for (const indicatorKey of selectedIndicators) {
    const dataset = buildInspectorIndicatorDataset(candles, indicatorKey);
    if (dataset) {
      datasets.push(dataset);
    }
  }

  destroyInspectorTradeChart();

  inspectTradeChart = new Chart(el.inspectTradeChart, {
    type: "line",
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#d9e8f1",
            boxWidth: 14
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = toNumber(context.raw);
              if (value === null) {
                return null;
              }

              if (context.dataset.yAxisID === "yPct") {
                return `${context.dataset.label}: ${value.toFixed(2)}%`;
              }

              if (context.dataset.yAxisID === "yRsi") {
                return `${context.dataset.label}: ${value.toFixed(2)}`;
              }

              return `${context.dataset.label}: ${formatPrice(value)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#a8c2d1",
            maxTicksLimit: 8,
            maxRotation: 0
          },
          grid: { color: "rgba(130, 168, 186, 0.18)" }
        },
        y: {
          position: "left",
          ticks: {
            color: "#a8c2d1",
            callback(value) {
              return formatPriceNumber(value);
            }
          },
          grid: { color: "rgba(130, 168, 186, 0.18)" }
        },
        yRsi: {
          display: selectedIndicators.includes("rsi"),
          position: "right",
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: {
            color: "#73e4bd",
            callback(value) {
              const numeric = toNumber(value);
              return numeric === null ? "-" : numeric.toFixed(0);
            }
          }
        },
        yPct: {
          display: selectedIndicators.includes("atr_pct"),
          position: "right",
          offset: true,
          grid: { drawOnChartArea: false },
          ticks: {
            color: "#ffb98c",
            callback(value) {
              const numeric = toNumber(value);
              return numeric === null ? "-" : `${numeric.toFixed(2)}%`;
            }
          }
        }
      }
    }
  });

  const timeframe = getInspectorTimeframe(entry, symbol);
  const lastClose = candles.at(-1)?.c;
  const timeframeText = timeframe ? ` | TF ${timeframe}` : "";
  setInspectorChartNote(
    `${symbol} | ${candles.length} bougies${timeframeText} | Derniere cloture ${formatPrice(lastClose)}`,
    "text-neutral"
  );
}

function initInspectorIndicatorControls() {
  if (!Array.isArray(el.inspectIndicatorInputs) || !el.inspectIndicatorInputs.length) {
    return;
  }

  for (const input of el.inspectIndicatorInputs) {
    input.addEventListener("change", () => {
      if (!activeInspectorEntry) {
        return;
      }
      renderInspectorTradeChart(activeInspectorEntry);
    });
  }
}

function renderDecisionInspector(entry) {
  const inspectorReady =
    el.inspectActionBadge &&
    el.inspectTime &&
    el.inspectSymbol &&
    el.inspectConfidence &&
    el.inspectPrice &&
    el.inspectSentiment &&
    el.inspectReason &&
    el.inspectRisk &&
    el.inspectExecution &&
    el.inspectHeadline &&
    el.inspectHeadlineLink &&
    el.inspectError;

  if (!inspectorReady) {
    return;
  }

  if (!entry) {
    activeInspectorEntry = null;
    setActionBadge(el.inspectActionBadge, "HOLD");
    el.inspectTime.textContent = "-";
    el.inspectSymbol.textContent = "-";
    el.inspectConfidence.textContent = "-";
    el.inspectPrice.textContent = "-";
    el.inspectSentiment.textContent = "-";
    el.inspectModel.textContent = "-";
    el.inspectSentiment.className = "";
    el.inspectReason.textContent = "Selectionne une decision pour voir le detail du pourquoi.";
    el.inspectRisk.textContent = "-";
    el.inspectExecution.className = "inspect-extra text-neutral";
    el.inspectExecution.textContent = "-";
    el.inspectHeadline.textContent = "-";
    el.inspectHeadlineLink.href = "#";
    el.inspectHeadlineLink.classList.add("hidden");
    el.inspectError.textContent = "";
    el.inspectError.classList.add("hidden");
    renderInspectorTradeChart(null);
    return;
  }

  activeInspectorEntry = entry;

  const action = getAction(entry);
  const sentiment = getSentiment(entry);
  const headline = normalizeHeadline(getMostImpactfulHeadline(entry), entry?.timestamp_utc, getDecisionSymbol(entry));
  const reason = getDecisionReasonText(entry);
  const risk = getDecisionRiskText(entry);

  setActionBadge(el.inspectActionBadge, action);
  el.inspectTime.textContent = formatDate(entry?.timestamp_utc, true);
  el.inspectSymbol.textContent = getDecisionSymbol(entry);
  el.inspectConfidence.textContent = formatConfidence(entry?.decision?.confidence);
  el.inspectPrice.textContent = formatPrice(entry?.price);
  el.inspectSentiment.textContent = formatSentimentText(sentiment);
  el.inspectModel.textContent = getDecisionModelSummary(entry);
  el.inspectSentiment.className = getSentimentTone(sentiment);
  el.inspectReason.textContent = reason;
  el.inspectRisk.textContent = risk;
  el.inspectExecution.className = `inspect-extra ${getInspectorExecutionToneClass(entry)}`;
  el.inspectExecution.textContent = getDecisionExecutionSummary(entry);
  renderInspectorTradeChart(entry);

  if (headline) {
    const scoreText = headline.sentimentScore === null ? "n/a" : headline.sentimentScore.toFixed(2);
    el.inspectHeadline.textContent = `Headline cle: ${headline.source} | ${formatDate(headline.publishedAt)} | score ${scoreText} | ${headline.title}`;
    if (headline.link) {
      el.inspectHeadlineLink.href = headline.link;
      el.inspectHeadlineLink.classList.remove("hidden");
    } else {
      el.inspectHeadlineLink.href = "#";
      el.inspectHeadlineLink.classList.add("hidden");
    }
  } else {
    el.inspectHeadline.textContent = "Aucune headline rattachee a cette decision.";
    el.inspectHeadlineLink.href = "#";
    el.inspectHeadlineLink.classList.add("hidden");
  }

  const feedErrors = Array.isArray(entry?.news_sentiment?.feed_errors) ? entry.news_sentiment.feed_errors : [];
  const geminiError = maybeFixText(entry?.gemini_error || "");
  const feedError = maybeFixText(feedErrors[0] || "");
  const inspectorError = geminiError || feedError;

  if (inspectorError) {
    el.inspectError.textContent = truncateText(inspectorError, 340);
    el.inspectError.classList.remove("hidden");
  } else {
    el.inspectError.textContent = "";
    el.inspectError.classList.add("hidden");
  }
}

function renderNewsPanel(decisions) {
  if (!el.newsSummary || !el.newsList) {
    return;
  }

  const latest = decisions.at(-1) || null;
  const list = el.newsList;
  list.innerHTML = "";

  if (!latest) {
    el.newsSummary.textContent = "Aucune news disponible.";
    const li = document.createElement("li");
    li.className = "news-item";
    li.textContent = "Le flux news sera visible des que les decisions contiendront les headlines.";
    list.appendChild(li);
    return;
  }

  const sentiment = latest?.news_sentiment || {};
  const label = maybeFixText(sentiment.label_fr || sentiment.label || "N/A");
  const score = toNumber(sentiment.score);
  const count = toNumber(sentiment.headline_count);

  const summaryParts = [`Sentiment global: ${score === null ? label : `${label} (${score.toFixed(2)})`}`];
  if (count !== null) {
    summaryParts.push(`${count} headlines analysees`);
  }
  el.newsSummary.textContent = summaryParts.join(" | ");

  const headlines = collectLatestHeadlines(decisions, 10);
  if (!headlines.length) {
    const li = document.createElement("li");
    li.className = "news-item";
    li.textContent = "Aucune headline remontee pour le moment.";
    list.appendChild(li);
    return;
  }

  for (const headline of headlines) {
    const li = document.createElement("li");
    li.className = "news-item";

    const titleEl = headline.link ? document.createElement("a") : document.createElement("p");
    titleEl.textContent = headline.title;
    titleEl.className = headline.link ? "news-link" : "news-title";
    if (headline.link) {
      titleEl.href = headline.link;
      titleEl.target = "_blank";
      titleEl.rel = "noopener noreferrer";
    }
    li.appendChild(titleEl);

    const scoreText = headline.sentimentScore === null ? "n/a" : headline.sentimentScore.toFixed(2);
    const meta = document.createElement("p");
    meta.className = "news-meta-line";
    meta.textContent = `${headline.source} | ${formatDate(headline.publishedAt)} | score ${scoreText} | ${headline.symbol}`;
    li.appendChild(meta);

    if (headline.excerpt) {
      const excerpt = document.createElement("p");
      excerpt.className = "news-excerpt";
      excerpt.textContent = truncateText(headline.excerpt, 160);
      li.appendChild(excerpt);
    }

    list.appendChild(li);
  }
}

function renderDecisionsTable(decisions) {
  const tbody = el.decisionsTableBody;
  tbody.innerHTML = "";

  const latest = collectRecentScopedDecisions(decisions, 40);
  if (!latest.length) {
    makeEmptyRow(tbody, 7, "Aucune decision disponible.");
    renderDecisionInspector(null);
    return;
  }

  const selectionStillVisible = latest.some((entry) => getDecisionId(entry) === selectedDecisionId);
  if (!selectionStillVisible) {
    selectedDecisionId = getDecisionId(latest[0]);
  }

  let selectedEntry = latest[0];

  for (const entry of latest) {
    const row = document.createElement("tr");
    row.className = "decision-row";

    const decisionId = getDecisionId(entry);
    if (decisionId === selectedDecisionId) {
      row.classList.add("is-selected");
      selectedEntry = entry;
    }

    row.addEventListener("click", () => {
      selectedDecisionId = decisionId;
      renderDecisionsTable(decisions);
    });

    const action = getAction(entry);
    const sentiment = getSentiment(entry);
    const reason = getDecisionReasonText(entry);
    const sentimentText = formatSentimentText(sentiment);

    row.appendChild(makeCell(formatDate(entry.timestamp_utc)));
    row.appendChild(makeCell(getDecisionSymbol(entry)));

    const actionCell = document.createElement("td");
    actionCell.appendChild(createBadge(action));
    row.appendChild(actionCell);

    row.appendChild(makeCell(formatConfidence(entry?.decision?.confidence)));
    row.appendChild(makeCell(formatPrice(entry?.price)));
    row.appendChild(makeCell(sentimentText, getSentimentTone(sentiment)));
    row.appendChild(makeCell(truncateText(reason, 120), "reason-snippet"));

    tbody.appendChild(row);
  }

  renderDecisionInspector(selectedEntry);
}

function renderPositionsTable(positionRows) {
  const tbody = el.positionsTableBody;
  tbody.innerHTML = "";

  if (!positionRows.length) {
    makeEmptyRow(tbody, 6, "Aucune position ouverte actuellement.");
    return;
  }

  for (const rowData of positionRows) {
    const row = document.createElement("tr");
    const pnlClass = rowData.pnl > 0 ? "text-positive" : rowData.pnl < 0 ? "text-negative" : "text-neutral";

    row.appendChild(makeCell(`${rowData.asset} (${rowData.symbol})`));
    row.appendChild(makeCell(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }).format(rowData.amount)));
    row.appendChild(makeCell(formatPrice(rowData.spot)));
    row.appendChild(makeCell(formatUsdt(rowData.value)));
    row.appendChild(makeCell(formatUsdt(rowData.cost)));

    const pnlText = `${formatUsdt(rowData.pnl)} | ${formatPct(rowData.pnlPct)}`;
    row.appendChild(makeCell(pnlText, pnlClass));

    tbody.appendChild(row);
  }
}

function renderTradesTable(trades) {
  const tbody = el.tradesTableBody;
  if (!tbody) {
    return;
  }
  tbody.innerHTML = "";

  if (!trades.length) {
    makeEmptyRow(tbody, 6, "Aucune execution de trade detectee.");
    return;
  }

  const recent = trades.slice(0, 30);
  for (const trade of recent) {
    const row = document.createElement("tr");
    row.appendChild(makeCell(formatDate(trade.timestamp)));
    row.appendChild(makeCell(trade.symbol || "-"));

    const actionCell = document.createElement("td");
    actionCell.appendChild(createBadge(trade.action));
    row.appendChild(actionCell);

    row.appendChild(makeCell(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }).format(trade.qty)));
    row.appendChild(makeCell(formatUsdt(trade.notional)));
    row.appendChild(makeCell(formatUsdt(trade.fee, 4)));

    tbody.appendChild(row);
  }
}

function renderLatestDecision(latest) {
  if (!latest) {
    setActionBadge(el.latestActionBadge, "HOLD");
    el.latestSymbol.textContent = "-";
    el.latestPrice.textContent = "-";
    el.latestConfidence.textContent = "-";
    el.latestSentiment.textContent = "-";
    el.latestModel.textContent = "-";
    el.latestReason.textContent = "Aucune donnee.";
    el.latestRisk.textContent = "-";
    el.latestError.textContent = "";
    el.latestError.classList.add("hidden");
    return;
  }

  const action = getAction(latest);
  const sentiment = getSentiment(latest);
  const sentimentText = formatSentimentText(sentiment);

  setActionBadge(el.latestActionBadge, action);
  el.latestSymbol.textContent = getDecisionSymbol(latest);
  el.latestPrice.textContent = formatPrice(latest.price);
  el.latestConfidence.textContent = formatConfidence(latest?.decision?.confidence);
  el.latestSentiment.textContent = sentimentText;
  el.latestModel.textContent = getDecisionModelSummary(latest);
  el.latestSentiment.className = getSentimentTone(sentiment);

  const reason = getDecisionReasonText(latest);
  const risk = getDecisionRiskText(latest);
  const error = maybeFixText(latest?.gemini_error || "");

  el.latestReason.textContent = reason;
  el.latestRisk.textContent = risk;

  if (error) {
    el.latestError.textContent = error;
    el.latestError.classList.remove("hidden");
  } else {
    el.latestError.textContent = "";
    el.latestError.classList.add("hidden");
  }
}

function renderKpis({ totalValue, totalPnlPct, cash, tradeCount, fees, openPositions, exposurePct }) {
  el.kpiTotalValue.textContent = formatUsdt(totalValue);
  el.kpiTotalPnl.textContent = `Performance: ${formatPct(totalPnlPct)}`;
  el.kpiTotalPnl.className = `kpi-sub ${
    totalPnlPct > 0 ? "text-positive" : totalPnlPct < 0 ? "text-negative" : "text-neutral"
  }`;

  el.kpiCash.textContent = formatUsdt(cash);
  el.kpiTrades.textContent = String(tradeCount);
  el.kpiFees.textContent = `Frais cumules: ${formatUsdt(fees, 4)}`;
  el.kpiOpenPositions.textContent = String(openPositions);
  el.kpiExposure.textContent = `Exposition: ${formatPct(exposurePct)}`;
}

function renderValueChart(series) {
  const labels = series.map((point) => formatDate(point.date));
  const totalData = series.map((point) => point.total);

  const buyPoints = series.map((point) => (point.action === "BUY" ? point.total : null));
  const sellPoints = series.map((point) => (point.action === "SELL" ? point.total : null));
  const holdPoints = series.map((point) => (point.action === "HOLD" ? point.total : null));

  if (valueChart) {
    valueChart.destroy();
  }

  valueChart = new Chart(el.valueChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Valeur portefeuille",
          data: totalData,
          borderColor: "#3ad0ff",
          borderWidth: 2.4,
          tension: 0.26,
          pointRadius: 0,
          fill: {
            target: "origin",
            above: "rgba(58, 208, 255, 0.15)"
          }
        },
        {
          label: "BUY",
          data: buyPoints,
          borderColor: ACTION_STYLE.BUY.color,
          backgroundColor: ACTION_STYLE.BUY.color,
          pointStyle: "triangle",
          pointRadius: 6,
          pointHoverRadius: 8,
          rotation: 0,
          showLine: false
        },
        {
          label: "SELL",
          data: sellPoints,
          borderColor: ACTION_STYLE.SELL.color,
          backgroundColor: ACTION_STYLE.SELL.color,
          pointStyle: "triangle",
          pointRadius: 6,
          pointHoverRadius: 8,
          rotation: 180,
          showLine: false
        },
        {
          label: "HOLD",
          data: holdPoints,
          borderColor: ACTION_STYLE.HOLD.color,
          backgroundColor: ACTION_STYLE.HOLD.color,
          pointStyle: "circle",
          pointRadius: 3,
          pointHoverRadius: 4,
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          labels: {
            color: "#d9e8f1"
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              if (context.raw === null || context.raw === undefined) {
                return null;
              }
              return `${context.dataset.label}: ${formatUsdt(context.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#b6cddd", maxRotation: 0, autoSkip: true },
          grid: { color: "rgba(138, 174, 192, 0.2)" }
        },
        y: {
          ticks: {
            color: "#b6cddd",
            callback(value) {
              return formatUsdt(value);
            }
          },
          grid: { color: "rgba(138, 174, 192, 0.2)" }
        }
      }
    }
  });
}

function renderExposureChart(positionRows, cash) {
  const labels = [];
  const values = [];
  const colors = [];

  if (positionRows.length) {
    positionRows.forEach((row, index) => {
      labels.push(row.asset);
      values.push(Math.max(row.value, 0));
      colors.push(palette[index % palette.length]);
    });

    if (cash > 0) {
      labels.push("Cash");
      values.push(cash);
      colors.push("#8aa8b8");
    }
  } else {
    labels.push("Cash");
    values.push(Math.max(cash, 0));
    colors.push("#8aa8b8");
  }

  if (exposureChart) {
    exposureChart.destroy();
  }

  exposureChart = new Chart(el.exposureChart, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderColor: "rgba(7, 19, 29, 0.9)",
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#d9e8f1" }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.label}: ${formatUsdt(context.raw)}`;
            }
          }
        }
      }
    }
  });
}

function computeDashboard(decisions, portfolio) {
  const sorted = decisions.slice().sort((a, b) => getEntryTimestamp(a) - getEntryTimestamp(b));
  const latest = sorted.at(-1) || null;
  const latestDecision = getLatestScopedDecisionEntry(sorted);

  const { rows: positionRows, totalExposure } = computePositionRows(portfolio);
  const trades = extractTrades(sorted, portfolio);
  const series = buildSeries(sorted, portfolio);
  const decisionCount = sorted.reduce((sum, entry) => sum + getScopedDecisionEntries(entry).length, 0);

  const cash = toNumber(portfolio?.cash_usdt) ?? toNumber(latest?.portfolio_metrics?.cash_usdt) ?? 0;
  const initial =
    toNumber(portfolio?.initial_cash_usdt) ?? toNumber(sorted[0]?.portfolio_metrics?.total_value_usdt) ?? toNumber(series[0]?.total) ?? 0;

  const totalValueFromLatest = toNumber(latest?.portfolio_metrics?.total_value_usdt);
  const totalValue = totalValueFromLatest ?? cash + totalExposure;

  const totalPnlPctFromLatest = toNumber(latest?.portfolio_metrics?.total_pnl_pct);
  const totalPnlPct =
    totalPnlPctFromLatest ?? (initial > 0 ? ((totalValue - initial) / initial) * 100 : 0);

  const fees =
    toNumber(portfolio?.fees_paid_usdt) ??
    sorted.reduce((sum, entry) => sum + (toNumber(entry?.execution?.fee_usdt) || 0), 0);

  const tradeCount =
    toNumber(portfolio?.trade_count) ??
    trades.length;

  const openPositions = positionRows.length;
  const exposurePct = totalValue > 0 ? (totalExposure / totalValue) * 100 : 0;

  return {
    sorted,
    latest,
    latestDecision,
    decisionCount,
    series,
    trades,
    positionRows,
    kpis: {
      totalValue,
      totalPnlPct,
      cash,
      tradeCount,
      fees,
      openPositions,
      exposurePct
    }
  };
}

async function fetchJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }
  return response.text();
}

async function loadDashboard(isRefresh = false) {
  try {
    setStatus(isRefresh ? "Actualisation des donnees..." : "Chargement des donnees...");

    const [decisionsText, portfolio] = await Promise.all([
      fetchText(DECISIONS_FILE),
      fetchJson(PORTFOLIO_FILE)
    ]);

    const decisions = parseJsonLines(decisionsText);
    const dashboard = computeDashboard(decisions, portfolio);

    renderKpis(dashboard.kpis);
    renderLatestDecision(dashboard.latestDecision || dashboard.latest);
    renderNewsPanel(dashboard.sorted);
    renderDecisionsTable(dashboard.sorted);
    renderPositionsTable(dashboard.positionRows);
    renderTradesTable(dashboard.trades);
    latestValueSeries = dashboard.series;
    renderValueChartByRange(dashboard.series);
    renderExposureChart(dashboard.positionRows, dashboard.kpis.cash);

    setStatus(`OK - ${dashboard.sorted.length} lignes JSON (${dashboard.decisionCount} decisions) chargees.`);
    el.updatedAt.textContent = formatDate(new Date(), true);
  } catch (error) {
    console.error(error);
    setStatus(`Erreur de chargement: ${error.message}`, true);
  }
}

function boot() {
  if (window.Chart) {
    Chart.defaults.font.family = "Space Grotesk, Segoe UI, sans-serif";
    Chart.defaults.color = "#d9e8f1";
  }

  initMainViewSwitch();
  initValueRangeSwitch();
  initInspectorIndicatorControls();
  loadDashboard();
  window.setInterval(() => loadDashboard(true), REFRESH_INTERVAL_MS);
}

boot();
