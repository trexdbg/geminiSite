const DECISIONS_FILE = "./paper_decisions.jsonl";
const PORTFOLIO_FILE = "./paper_portfolio.json";
const REFRESH_INTERVAL_MS = 120000;

const ACTION_STYLE = {
  BUY: { label: "ACHAT", badgeClass: "badge-buy", color: "#12c48b" },
  SELL: { label: "VENTE", badgeClass: "badge-sell", color: "#ff6262" },
  HOLD: { label: "ATTENTE", badgeClass: "badge-hold", color: "#f6a928" }
};

const palette = ["#3ad0ff", "#12c48b", "#f6a928", "#ff6262", "#8cc3ff", "#ff9f6f"];

let valueChart = null;
let exposureChart = null;

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
  latestReason: document.getElementById("latestReason"),
  latestRisk: document.getElementById("latestRisk"),
  latestError: document.getElementById("latestError"),
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
    const execution = entry?.execution || {};
    const action = getAction(entry);
    const qty = toNumber(execution.executed_qty) || 0;
    const notional = toNumber(execution.executed_notional_usdt) || 0;
    const fee = toNumber(execution.fee_usdt) || 0;
    const status = String(execution.status || "").toUpperCase();

    const isExecuted = qty > 0 || Math.abs(notional) > 0;
    const filledLike = status.includes("FILLED") || status.includes("EXEC") || status.includes("BUY") || status.includes("SELL");

    if (!isExecuted && !filledLike) {
      continue;
    }

    if (action === "HOLD" && !isExecuted) {
      continue;
    }

    list.push({
      timestamp: entry.timestamp_utc,
      symbol: execution.symbol || entry.symbol || entry?.decision?.symbol || "-",
      action,
      qty,
      notional,
      fee
    });
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

function renderDecisionsTable(decisions) {
  const tbody = el.decisionsTableBody;
  tbody.innerHTML = "";

  const latest = decisions.slice(-20).reverse();
  if (!latest.length) {
    makeEmptyRow(tbody, 6, "Aucune decision disponible.");
    return;
  }

  for (const entry of latest) {
    const row = document.createElement("tr");
    const action = getAction(entry);
    const sentiment = getSentiment(entry);
    const sentimentText = sentiment.score === null ? sentiment.label : `${sentiment.label} (${sentiment.score.toFixed(2)})`;

    row.appendChild(makeCell(formatDate(entry.timestamp_utc)));
    row.appendChild(makeCell(entry.symbol || entry?.decision?.symbol || entry?.execution?.symbol || "-"));

    const actionCell = document.createElement("td");
    actionCell.appendChild(createBadge(action));
    row.appendChild(actionCell);

    row.appendChild(makeCell(formatConfidence(entry?.decision?.confidence)));
    row.appendChild(makeCell(formatPrice(entry?.price)));
    row.appendChild(makeCell(sentimentText, getSentimentTone(sentiment)));

    tbody.appendChild(row);
  }
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
    el.latestReason.textContent = "Aucune donnee.";
    el.latestRisk.textContent = "-";
    el.latestError.textContent = "";
    el.latestError.classList.add("hidden");
    return;
  }

  const action = getAction(latest);
  const sentiment = getSentiment(latest);
  const sentimentText = sentiment.score === null ? sentiment.label : `${sentiment.label} (${sentiment.score.toFixed(2)})`;

  setActionBadge(el.latestActionBadge, action);
  el.latestSymbol.textContent = latest.symbol || latest?.decision?.symbol || latest?.execution?.symbol || "-";
  el.latestPrice.textContent = formatPrice(latest.price);
  el.latestConfidence.textContent = formatConfidence(latest?.decision?.confidence);
  el.latestSentiment.textContent = sentimentText;
  el.latestSentiment.className = getSentimentTone(sentiment);

  const reason = maybeFixText(latest?.decision?.reason) || "Aucune justification disponible.";
  const risk = maybeFixText(latest?.decision?.risk_note) || "Aucune note de risque.";
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

  const { rows: positionRows, totalExposure } = computePositionRows(portfolio);
  const trades = extractTrades(sorted, portfolio);
  const series = buildSeries(sorted, portfolio);

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
    renderLatestDecision(dashboard.latest);
    renderDecisionsTable(dashboard.sorted);
    renderPositionsTable(dashboard.positionRows);
    renderTradesTable(dashboard.trades);
    renderValueChart(dashboard.series);
    renderExposureChart(dashboard.positionRows, dashboard.kpis.cash);

    setStatus(`OK - ${dashboard.sorted.length} decisions chargees.`);
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

  loadDashboard();
  window.setInterval(() => loadDashboard(true), REFRESH_INTERVAL_MS);
}

boot();
