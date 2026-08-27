(() => {
  "use strict";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  const state = {
    fileName: "",
    originalRows: [],
    rows: [],
    columns: [],
    profiles: {},
    history: [],
    historySnapshots: [],
    filteredRows: null,
    activeFilter: null,
    searchQuery: "",
    page: 1,
    pageSize: 20,
    activeView: "overview",
    selectedColumn: null,
    chart: null,
    chartConfig: null
  };

  const els = {
    startView: $("#start-view"),
    workspace: $("#analysis-workspace"),
    dropCard: $("#drop-card"),
    dropTitle: $("#drop-title"),
    dropCopy: $("#drop-copy"),
    fileInput: $("#file-input"),
    chooseFile: $("#choose-file-button"),
    sampleData: $("#sample-data-button"),

    headerFileName: $("#header-file-name"),
    sidebarDataset: $("#sidebar-dataset"),
    sidebarFileName: $("#sidebar-file-name"),
    sidebarFileMeta: $("#sidebar-file-meta"),
    sidebarHealth: $("#sidebar-health"),
    sidebarHealthBar: $("#sidebar-health-bar"),

    summaryRows: $("#summary-rows"),
    summaryColumns: $("#summary-columns"),
    summaryMissing: $("#summary-missing"),
    summaryDuplicates: $("#summary-duplicates"),

    healthScore: $("#health-score"),
    healthMeter: $("#health-meter-fill"),
    healthCompleteness: $("#health-completeness"),
    healthDuplicates: $("#health-duplicates"),
    healthTypes: $("#health-types"),

    insightList: $("#insight-list"),
    previewTable: $("#preview-table"),

    dataTable: $("#data-table"),
    tableSearch: $("#table-search"),
    tableShowingCount: $("#table-showing-count"),
    filterColumn: $("#filter-column"),
    filterOperator: $("#filter-operator"),
    filterValue: $("#filter-value"),
    applyFilter: $("#apply-filter-button"),
    clearFilter: $("#clear-filter-button"),
    activeFilter: $("#active-filter"),
    prevPage: $("#prev-page-button"),
    nextPage: $("#next-page-button"),
    pageIndicator: $("#page-indicator"),

    columnsGrid: $("#columns-grid"),

    chartType: $("#chart-type"),
    chartX: $("#chart-x-column"),
    chartY: $("#chart-y-column"),
    generateChart: $("#generate-chart-button"),
    chartSuggestions: $("#chart-suggestions"),
    chartCanvas: $("#main-chart"),
    chartEmpty: $("#chart-empty"),
    chartTitle: $("#chart-title"),
    chartRecordCount: $("#chart-record-count"),

    missingList: $("#missing-list"),
    duplicateCount: $("#duplicate-count"),
    removeDuplicates: $("#remove-duplicates-button"),
    historyList: $("#history-list"),
    undo: $("#undo-button"),

    drawer: $("#column-drawer"),
    drawerName: $("#drawer-column-name"),
    drawerContent: $("#drawer-content"),

    cleanModal: $("#clean-modal"),
    cleanModalTitle: $("#clean-modal-title"),

    toast: $("#toast")
  };

  const isMissing = (value) =>
    value === null ||
    value === undefined ||
    String(value).trim() === "";

  const toNumber = (value) => {
    if (isMissing(value)) return null;
    const n = Number(String(value).replaceAll(",", ""));
    return Number.isFinite(n) ? n : null;
  };

  const escapeHTML = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 2400);
  }

  function countMissing(rows = state.rows) {
    return rows.reduce(
      (sum, row) =>
        sum + state.columns.filter((column) => isMissing(row[column])).length,
      0
    );
  }

  function rowKey(row) {
    return state.columns.map((column) => String(row[column] ?? "")).join("\u241f");
  }

  function countDuplicates(rows = state.rows) {
    const seen = new Set();
    let duplicates = 0;

    rows.forEach((row) => {
      const key = rowKey(row);
      if (seen.has(key)) duplicates += 1;
      else seen.add(key);
    });

    return duplicates;
  }

  function detectType(values) {
    const present = values.filter((value) => !isMissing(value));
    if (!present.length) return { type: "empty", confidence: 1 };

    const numeric = present.filter((value) => toNumber(value) !== null).length;
    const boolean = present.filter((value) =>
      /^(true|false|yes|no|0|1)$/i.test(String(value).trim())
    ).length;
    const date = present.filter((value) => {
      const str = String(value).trim();
      return /[-/]/.test(str) && !Number.isNaN(Date.parse(str));
    }).length;

    const numericRatio = numeric / present.length;
    const booleanRatio = boolean / present.length;
    const dateRatio = date / present.length;

    if (numericRatio >= 0.88) return { type: "numeric", confidence: numericRatio };
    if (booleanRatio >= 0.88) return { type: "boolean", confidence: booleanRatio };
    if (dateRatio >= 0.82) return { type: "date", confidence: dateRatio };

    const unique = new Set(present.map(String)).size;
    if (unique <= Math.min(24, Math.max(6, Math.ceil(present.length * 0.25)))) {
      return { type: "categorical", confidence: 0.9 };
    }

    return { type: "text", confidence: 0.88 };
  }

  function median(numbers) {
    if (!numbers.length) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function mode(values) {
    const counts = new Map();
    values
      .filter((value) => !isMissing(value))
      .forEach((value) => {
        const key = String(value);
        counts.set(key, (counts.get(key) || 0) + 1);
      });

    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }

  function profileColumn(column) {
    const values = state.rows.map((row) => row[column]);
    const present = values.filter((value) => !isMissing(value));
    const missing = values.length - present.length;
    const typeInfo = detectType(values);
    const unique = new Set(present.map(String)).size;

    const profile = {
      name: column,
      type: typeInfo.type,
      confidence: typeInfo.confidence,
      count: values.length,
      valid: present.length,
      missing,
      unique,
      mode: mode(present),
      frequencies: {}
    };

    present.forEach((value) => {
      const key = String(value);
      profile.frequencies[key] = (profile.frequencies[key] || 0) + 1;
    });

    if (typeInfo.type === "numeric") {
      const nums = present
        .map(toNumber)
        .filter((value) => value !== null);

      profile.min = Math.min(...nums);
      profile.max = Math.max(...nums);
      profile.mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
      profile.median = median(nums);

      const variance =
        nums.reduce((sum, value) => sum + Math.pow(value - profile.mean, 2), 0) /
        nums.length;

      profile.std = Math.sqrt(variance);
    }

    return profile;
  }

  function analyze() {
    state.columns = state.rows.length ? Object.keys(state.rows[0]) : [];
    state.profiles = {};

    state.columns.forEach((column) => {
      state.profiles[column] = profileColumn(column);
    });

    renderAll();
  }

  function computeHealth() {
    const totalCells = Math.max(1, state.rows.length * state.columns.length);
    const missing = countMissing();
    const duplicates = countDuplicates();
    const completeness = Math.max(0, 100 - (missing / totalCells) * 100);
    const duplicateHealth = Math.max(
      0,
      100 - (duplicates / Math.max(1, state.rows.length)) * 100
    );

    const avgConfidence =
      state.columns.length
        ? (state.columns.reduce(
            (sum, column) => sum + state.profiles[column].confidence,
            0
          ) /
            state.columns.length) *
          100
        : 0;

    const score = Math.round(
      completeness * 0.5 + duplicateHealth * 0.3 + avgConfidence * 0.2
    );

    return {
      score,
      completeness: Math.round(completeness),
      duplicateHealth: Math.round(duplicateHealth),
      typeConfidence: Math.round(avgConfidence)
    };
  }

  function parseCSVText(text, fileName = "dataset.csv") {
    if (!window.Papa) {
      showToast("CSV parser failed to load. Check your internet connection.");
      return;
    }

    window.Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (result) => {
        const rows = result.data.filter((row) =>
          Object.values(row).some((value) => !isMissing(value))
        );

        loadDataset(rows, fileName);
      },
      error: () => showToast("Could not read this CSV file.")
    });
  }

  function loadFile(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      showToast("Please choose a CSV file.");
      return;
    }

    els.dropTitle.textContent = "Reading dataset…";
    els.dropCopy.textContent = file.name;

    const reader = new FileReader();

    reader.onload = () => {
      parseCSVText(reader.result, file.name);
    };

    reader.onerror = () => showToast("Could not read this file.");
    reader.readAsText(file);
  }

  function loadDataset(rows, fileName) {
    if (!rows.length) {
      showToast("No data rows were found.");
      return;
    }

    state.fileName = fileName;
    state.originalRows = rows.map((row) => ({ ...row }));
    state.rows = rows.map((row) => ({ ...row }));
    state.history = [];
    state.historySnapshots = [];
    state.filteredRows = null;
    state.activeFilter = null;
    state.searchQuery = "";
    state.page = 1;

    els.startView.hidden = true;
    els.workspace.hidden = false;

    els.headerFileName.textContent = fileName;
    els.sidebarDataset.hidden = false;
    els.sidebarFileName.textContent = fileName;

    analyze();
    switchView("overview");

    showToast(`${rows.length.toLocaleString()} rows loaded.`);
  }

  async function loadSample() {
    try {
      const response = await fetch("sample/students.csv");
      if (!response.ok) throw new Error("sample failed");
      const text = await response.text();
      parseCSVText(text, "students.csv");
    } catch {
      const fallback = `ID,Name,Course,Year,GPA,Age,City,Status
001,Maria Santos,BSCS,3,1.42,20,Cagayan de Oro,Active
002,John Lim,BSIT,2,1.87,19,Iligan,Active
003,Lea Cruz,BSCS,4,,22,Cagayan de Oro,Active
004,Marco Diaz,BSEE,3,2.10,21,Valencia,Active
005,Ana Reyes,BSCS,2,1.55,19,Cagayan de Oro,Active`;
      parseCSVText(fallback, "students.csv");
    }
  }

  function renderAll() {
    renderSummary();
    renderOverview();
    renderPreviewTable();
    renderDataTable();
    renderColumns();
    renderChartControls();
    renderCleaning();
    renderHistory();
    renderSidebar();
  }

  function renderSidebar() {
    const health = computeHealth();

    els.sidebarFileMeta.textContent =
      `${state.rows.length.toLocaleString()} rows · ${state.columns.length} columns`;

    els.sidebarHealth.textContent = `${health.score}%`;
    els.sidebarHealthBar.style.width = `${health.score}%`;
  }

  function renderSummary() {
    els.summaryRows.textContent = state.rows.length.toLocaleString();
    els.summaryColumns.textContent = state.columns.length.toLocaleString();
    els.summaryMissing.textContent = countMissing().toLocaleString();
    els.summaryDuplicates.textContent = countDuplicates().toLocaleString();
  }

  function renderOverview() {
    const health = computeHealth();

    els.healthScore.textContent = health.score;
    els.healthMeter.style.width = `${health.score}%`;
    els.healthCompleteness.textContent = `${health.completeness}%`;
    els.healthDuplicates.textContent = `${health.duplicateHealth}%`;
    els.healthTypes.textContent = `${health.typeConfidence}%`;

    const missingColumns = state.columns
      .map((column) => state.profiles[column])
      .filter((profile) => profile.missing > 0)
      .sort((a, b) => b.missing - a.missing);

    const numericColumns = state.columns.filter(
      (column) => state.profiles[column].type === "numeric"
    );

    const categoricalColumns = state.columns.filter(
      (column) => state.profiles[column].type === "categorical"
    );

    const insights = [];

    if (missingColumns.length) {
      insights.push({
        title: `${missingColumns[0].name} has the most missing values`,
        detail: `${missingColumns[0].missing} empty cells detected in this column.`
      });
    } else {
      insights.push({
        title: "No missing values detected",
        detail: "Every cell in the current dataset contains a value."
      });
    }

    if (countDuplicates() > 0) {
      insights.push({
        title: `${countDuplicates()} duplicate rows found`,
        detail: "You can remove them from the Clean section."
      });
    } else {
      insights.push({
        title: "No duplicate rows",
        detail: "Every row is currently unique."
      });
    }

    if (numericColumns.length) {
      const column = numericColumns[0];
      insights.push({
        title: `${column} is numeric`,
        detail: `Mean ${formatNumber(state.profiles[column].mean)} · median ${formatNumber(
          state.profiles[column].median
        )}.`
      });
    } else if (categoricalColumns.length) {
      const column = categoricalColumns[0];
      insights.push({
        title: `${column} is categorical`,
        detail: `Most common value: ${state.profiles[column].mode || "—"}.`
      });
    }

    els.insightList.innerHTML = insights
      .slice(0, 4)
      .map(
        (item, index) => `
          <div class="insight">
            <span class="insight__index">${String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>${escapeHTML(item.title)}</strong>
              <small>${escapeHTML(item.detail)}</small>
            </div>
          </div>
        `
      )
      .join("");
  }

  function renderTable(table, rows, limit = null) {
    const data = limit ? rows.slice(0, limit) : rows;

    if (!data.length) {
      table.innerHTML = `
        <tbody>
          <tr><td>No rows to display.</td></tr>
        </tbody>
      `;
      return;
    }

    table.innerHTML = `
      <thead>
        <tr>
          ${state.columns
            .map((column) => `<th>${escapeHTML(column)}</th>`)
            .join("")}
        </tr>
      </thead>
      <tbody>
        ${data
          .map(
            (row) => `
              <tr>
                ${state.columns
                  .map((column) => {
                    const value = row[column];

                    return isMissing(value)
                      ? `<td class="is-missing">MISSING</td>`
                      : `<td title="${escapeHTML(value)}">${escapeHTML(value)}</td>`;
                  })
                  .join("")}
              </tr>
            `
          )
          .join("")}
      </tbody>
    `;
  }

  function renderPreviewTable() {
    renderTable(els.previewTable, state.rows, 6);
  }

  function getWorkingRows() {
    let rows = state.filteredRows ? [...state.filteredRows] : [...state.rows];

    const query = state.searchQuery.trim().toLowerCase();

    if (query) {
      rows = rows.filter((row) =>
        state.columns.some((column) =>
          String(row[column] ?? "").toLowerCase().includes(query)
        )
      );
    }

    return rows;
  }

  function renderDataTable() {
    const rows = getWorkingRows();
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));

    state.page = Math.min(Math.max(1, state.page), pages);

    const start = (state.page - 1) * state.pageSize;
    const pageRows = rows.slice(start, start + state.pageSize);

    renderTable(els.dataTable, pageRows);

    els.tableShowingCount.textContent = `${rows.length.toLocaleString()} rows`;
    els.pageIndicator.textContent = `Page ${state.page} / ${pages}`;

    els.prevPage.disabled = state.page <= 1;
    els.nextPage.disabled = state.page >= pages;
  }

  function renderColumns() {
    els.columnsGrid.innerHTML = state.columns
      .map((column, index) => {
        const profile = state.profiles[column];

        return `
          <button
            class="column-card"
            type="button"
            data-column="${escapeHTML(column)}"
          >
            <div class="column-card__top">
              <span class="column-card__type">${escapeHTML(profile.type)}</span>
              <span class="column-card__type">${String(index + 1).padStart(2, "0")}</span>
            </div>

            <h3>${escapeHTML(column)}</h3>

            <div class="column-card__stats">
              <div>
                <span>Valid</span>
                <strong>${profile.valid.toLocaleString()}</strong>
              </div>
              <div>
                <span>Missing</span>
                <strong>${profile.missing.toLocaleString()}</strong>
              </div>
              <div>
                <span>Unique</span>
                <strong>${profile.unique.toLocaleString()}</strong>
              </div>
            </div>
          </button>
        `;
      })
      .join("");
  }

  function renderChartControls() {
    const options = state.columns
      .map((column) => `<option value="${escapeHTML(column)}">${escapeHTML(column)}</option>`)
      .join("");

    els.chartX.innerHTML = options;
    els.filterColumn.innerHTML = options;

    els.chartY.innerHTML = `
      <option value="__count__">Count</option>
      ${state.columns
        .filter((column) => state.profiles[column].type === "numeric")
        .map((column) => `<option value="${escapeHTML(column)}">${escapeHTML(column)}</option>`)
        .join("")}
    `;

    const categorical = state.columns.find(
      (column) => state.profiles[column].type === "categorical"
    );

    const numeric = state.columns.find(
      (column) => state.profiles[column].type === "numeric"
    );

    if (categorical) els.chartX.value = categorical;
    if (numeric) els.chartY.value = numeric;

    const suggestions = [];

    if (categorical) {
      suggestions.push({
        label: `${categorical} distribution`,
        type: "bar",
        x: categorical,
        y: "__count__"
      });

      suggestions.push({
        label: `${categorical} share`,
        type: "doughnut",
        x: categorical,
        y: "__count__"
      });
    }

    if (categorical && numeric) {
      suggestions.push({
        label: `Average ${numeric} by ${categorical}`,
        type: "bar",
        x: categorical,
        y: numeric
      });
    }

    const numerics = state.columns.filter(
      (column) => state.profiles[column].type === "numeric"
    );

    if (numerics.length >= 2) {
      suggestions.push({
        label: `${numerics[1]} vs ${numerics[0]}`,
        type: "scatter",
        x: numerics[0],
        y: numerics[1]
      });
    }

    els.chartSuggestions.innerHTML = suggestions
      .slice(0, 4)
      .map(
        (suggestion) => `
          <button
            class="suggestion-button"
            type="button"
            data-chart-suggestion='${escapeHTML(JSON.stringify(suggestion))}'
          >
            ${escapeHTML(suggestion.label)}
          </button>
        `
      )
      .join("");
  }

  function generateChart() {
    if (!window.Chart) {
      showToast("Chart library failed to load. Check your internet connection.");
      return;
    }

    const type = els.chartType.value;
    const xColumn = els.chartX.value;
    const yColumn = els.chartY.value;

    if (!xColumn) return;

    const rows = getWorkingRows();

    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }

    const config = buildChartConfig(type, xColumn, yColumn, rows);

    if (!config) {
      showToast("This chart combination does not have enough valid data.");
      return;
    }

    els.chartEmpty.hidden = true;
    els.chartTitle.textContent = config.title;
    els.chartRecordCount.textContent = `${rows.length.toLocaleString()} rows`;

    state.chart = new window.Chart(els.chartCanvas, config.chart);
    state.chartConfig = { type, xColumn, yColumn };
  }

  function buildChartConfig(type, xColumn, yColumn, rows) {
    const cleanRows = rows.filter((row) => !isMissing(row[xColumn]));

    if (!cleanRows.length) return null;

    if (type === "scatter") {
      if (yColumn === "__count__") return null;

      const points = cleanRows
        .map((row) => ({
          x: toNumber(row[xColumn]),
          y: toNumber(row[yColumn])
        }))
        .filter((point) => point.x !== null && point.y !== null)
        .slice(0, 500);

      if (!points.length) return null;

      return {
        title: `${yColumn} vs ${xColumn}`,
        chart: {
          type: "scatter",
          data: {
            datasets: [
              {
                label: `${yColumn} vs ${xColumn}`,
                data: points,
                pointRadius: 4,
                pointHoverRadius: 6,
                backgroundColor: "rgba(49, 87, 255, 0.68)"
              }
            ]
          },
          options: chartOptions()
        }
      };
    }

    const grouped = new Map();

    cleanRows.forEach((row) => {
      const key = String(row[xColumn]);

      if (!grouped.has(key)) {
        grouped.set(key, { count: 0, values: [] });
      }

      const bucket = grouped.get(key);
      bucket.count += 1;

      if (yColumn !== "__count__") {
        const numeric = toNumber(row[yColumn]);
        if (numeric !== null) bucket.values.push(numeric);
      }
    });

    const entries = [...grouped.entries()]
      .map(([label, bucket]) => ({
        label,
        value:
          yColumn === "__count__"
            ? bucket.count
            : bucket.values.length
              ? bucket.values.reduce((a, b) => a + b, 0) / bucket.values.length
              : 0
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 16);

    const labels = entries.map((item) => item.label);
    const values = entries.map((item) => Number(item.value.toFixed(3)));

    const dataset = {
      label: yColumn === "__count__" ? "Count" : `Average ${yColumn}`,
      data: values,
      borderWidth: type === "line" ? 2 : 0,
      borderColor: "#3157ff",
      backgroundColor:
        type === "doughnut"
          ? [
              "#3157ff",
              "#00a58e",
              "#f2a93b",
              "#e95858",
              "#6b7fd7",
              "#5bb9a7",
              "#f5c66d",
              "#ee8d8d"
            ]
          : type === "line"
            ? "rgba(49,87,255,.18)"
            : "rgba(49,87,255,.78)",
      tension: 0.32,
      fill: type === "line"
    };

    return {
      title:
        yColumn === "__count__"
          ? `${xColumn} distribution`
          : `Average ${yColumn} by ${xColumn}`,
      chart: {
        type,
        data: {
          labels,
          datasets: [dataset]
        },
        options: chartOptions(type === "doughnut")
      }
    };
  }

  function chartOptions(isDoughnut = false) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 650
      },
      plugins: {
        legend: {
          display: isDoughnut,
          position: "bottom",
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            color: "#667085",
            font: {
              family: "Manrope",
              size: 10
            }
          }
        },
        tooltip: {
          backgroundColor: "#101828",
          padding: 10,
          cornerRadius: 9
        }
      },
      scales: isDoughnut
        ? {}
        : {
            x: {
              grid: {
                display: false
              },
              ticks: {
                color: "#667085",
                font: {
                  family: "DM Mono",
                  size: 8
                }
              }
            },
            y: {
              beginAtZero: true,
              grid: {
                color: "#edf0f3"
              },
              ticks: {
                color: "#667085",
                font: {
                  family: "DM Mono",
                  size: 8
                }
              }
            }
          }
    };
  }

  function renderCleaning() {
    const missingProfiles = state.columns
      .map((column) => state.profiles[column])
      .filter((profile) => profile.missing > 0)
      .sort((a, b) => b.missing - a.missing);

    if (!missingProfiles.length) {
      els.missingList.innerHTML = `
        <div class="empty-state">No missing values detected.</div>
      `;
    } else {
      els.missingList.innerHTML = missingProfiles
        .map((profile) => {
          const percent = (profile.missing / Math.max(1, state.rows.length)) * 100;

          return `
            <div class="issue-row">
              <div class="issue-row__name">
                <strong>${escapeHTML(profile.name)}</strong>
                <span>${profile.missing} missing · ${percent.toFixed(1)}%</span>
              </div>
              <div class="issue-row__bar">
                <i style="width:${Math.max(2, percent)}%"></i>
              </div>
              <button type="button" data-clean-column="${escapeHTML(profile.name)}">
                Clean
              </button>
            </div>
          `;
        })
        .join("");
    }

    const duplicates = countDuplicates();

    els.duplicateCount.textContent = duplicates.toLocaleString();
    els.removeDuplicates.disabled = duplicates === 0;
  }

  function renderHistory() {
    els.undo.disabled = !state.history.length;

    if (!state.history.length) {
      els.historyList.innerHTML = `
        <div class="empty-state">
          No changes yet. Cleaning actions will appear here.
        </div>
      `;
      return;
    }

    els.historyList.innerHTML = state.history
      .map(
        (item, index) => `
          <div class="history-item">
            <span class="history-item__index">${String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>${escapeHTML(item.label)}</strong>
              <small>${escapeHTML(item.detail)}</small>
            </div>
            <time>${escapeHTML(item.time)}</time>
          </div>
        `
      )
      .join("");
  }

  function pushHistory(label, detail) {
    state.historySnapshots.push(state.rows.map((row) => ({ ...row })));

    state.history.push({
      label,
      detail,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    });
  }

  function undoLast() {
    if (!state.history.length || !state.historySnapshots.length) return;

    state.rows = state.historySnapshots.pop();
    state.history.pop();
    state.filteredRows = null;
    state.activeFilter = null;
    state.page = 1;

    analyze();
    showToast("Last change undone.");
  }

  function removeDuplicates() {
    const duplicateTotal = countDuplicates();
    if (!duplicateTotal) return;

    pushHistory(
      "Removed duplicate rows",
      `${duplicateTotal} repeated row${duplicateTotal === 1 ? "" : "s"} removed.`
    );

    const seen = new Set();

    state.rows = state.rows.filter((row) => {
      const key = rowKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    analyze();
    showToast(`${duplicateTotal} duplicate row${duplicateTotal === 1 ? "" : "s"} removed.`);
  }

  function openCleanModal(column) {
    state.selectedColumn = column;
    els.cleanModalTitle.textContent = column;
    els.cleanModal.classList.add("is-open");
    els.cleanModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    const numeric = state.profiles[column]?.type === "numeric";

    $$('[data-clean-action="mean"], [data-clean-action="median"]').forEach((button) => {
      button.disabled = !numeric;
      button.style.opacity = numeric ? "1" : "0.42";
    });
  }

  function closeCleanModal() {
    els.cleanModal.classList.remove("is-open");
    els.cleanModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function cleanColumn(action) {
    const column = state.selectedColumn;
    const profile = state.profiles[column];

    if (!column || !profile || profile.missing === 0) {
      closeCleanModal();
      return;
    }

    if (action === "remove") {
      pushHistory(
        `Removed missing ${column} rows`,
        `${profile.missing} row${profile.missing === 1 ? "" : "s"} removed.`
      );

      state.rows = state.rows.filter((row) => !isMissing(row[column]));
    } else {
      let replacement = "";

      if (action === "mean") replacement = formatNumber(profile.mean, 3);
      if (action === "median") replacement = formatNumber(profile.median, 3);
      if (action === "mode") replacement = profile.mode;

      if (replacement === "" || replacement === null || replacement === undefined) {
        showToast("A replacement value could not be calculated.");
        return;
      }

      pushHistory(
        `Filled missing ${column}`,
        `${profile.missing} value${profile.missing === 1 ? "" : "s"} replaced with ${replacement}.`
      );

      state.rows = state.rows.map((row) => ({
        ...row,
        [column]: isMissing(row[column]) ? replacement : row[column]
      }));
    }

    closeCleanModal();
    analyze();
    showToast(`${column} cleaned.`);
  }

  function openColumnDrawer(column) {
    const profile = state.profiles[column];
    if (!profile) return;

    state.selectedColumn = column;
    els.drawerName.textContent = column;

    const stats = [
      ["Type", profile.type],
      ["Valid", profile.valid.toLocaleString()],
      ["Missing", profile.missing.toLocaleString()],
      ["Unique", profile.unique.toLocaleString()]
    ];

    if (profile.type === "numeric") {
      stats.push(
        ["Minimum", formatNumber(profile.min)],
        ["Maximum", formatNumber(profile.max)],
        ["Mean", formatNumber(profile.mean)],
        ["Median", formatNumber(profile.median)],
        ["Std. dev.", formatNumber(profile.std)]
      );
    } else {
      stats.push(["Most common", profile.mode || "—"]);
    }

    const frequencies = Object.entries(profile.frequencies)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const topCount = frequencies[0]?.[1] || 1;

    els.drawerContent.innerHTML = `
      <div class="drawer-stats">
        ${stats
          .map(
            ([label, value]) => `
              <div class="drawer-stat">
                <span>${escapeHTML(label)}</span>
                <strong>${escapeHTML(value)}</strong>
              </div>
            `
          )
          .join("")}
      </div>

      <div class="value-frequency">
        <h3>Most common values</h3>

        ${
          frequencies.length
            ? frequencies
                .map(
                  ([value, count]) => `
                    <div class="frequency-row">
                      <span title="${escapeHTML(value)}">${escapeHTML(value)}</span>
                      <i style="--freq:${(count / topCount) * 100}%"></i>
                      <strong>${count}</strong>
                    </div>
                  `
                )
                .join("")
            : `<div class="empty-state">No values available.</div>`
        }
      </div>
    `;

    els.drawer.classList.add("is-open");
    els.drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    els.drawer.classList.remove("is-open");
    els.drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function applyFilter() {
    const column = els.filterColumn.value;
    const operator = els.filterOperator.value;
    const value = els.filterValue.value;

    if (!column) return;

    const filtered = state.rows.filter((row) => {
      const cell = row[column];
      const cellString = String(cell ?? "");
      const lowerCell = cellString.toLowerCase();
      const lowerValue = value.toLowerCase();

      switch (operator) {
        case "contains":
          return lowerCell.includes(lowerValue);
        case "equals":
          return lowerCell === lowerValue;
        case "not-equals":
          return lowerCell !== lowerValue;
        case "gt": {
          const a = toNumber(cell);
          const b = toNumber(value);
          return a !== null && b !== null && a > b;
        }
        case "lt": {
          const a = toNumber(cell);
          const b = toNumber(value);
          return a !== null && b !== null && a < b;
        }
        case "missing":
          return isMissing(cell);
        case "not-missing":
          return !isMissing(cell);
        default:
          return true;
      }
    });

    state.filteredRows = filtered;
    state.activeFilter = { column, operator, value };
    state.page = 1;

    els.activeFilter.hidden = false;
    els.activeFilter.textContent = `${column} ${operator.replaceAll("-", " ")} ${
      ["missing", "not-missing"].includes(operator) ? "" : value
    } · ${filtered.length} rows`;

    renderDataTable();
    showToast(`${filtered.length} rows match this filter.`);
  }

  function clearFilter() {
    state.filteredRows = null;
    state.activeFilter = null;
    state.page = 1;
    els.filterValue.value = "";
    els.activeFilter.hidden = true;
    renderDataTable();
  }

  function switchView(view) {
    state.activeView = view;

    $$("[data-view-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
    });

    $$("[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === view);
    });

    const titles = {
      overview: ["Dataset overview", state.fileName || "Analysis"],
      data: ["Rows & filters", "Explore data"],
      columns: ["Column profiles", "Understand fields"],
      charts: ["Visual analysis", "Build charts"],
      clean: ["Data quality", "Clean dataset"]
    };

    $("#workspace-eyebrow").textContent = titles[view]?.[0] || "Workspace";
    $("#workspace-title").textContent = titles[view]?.[1] || "Analysis";

    if (view === "charts" && state.chart) {
      setTimeout(() => state.chart.resize(), 80);
    }

    if (window.innerWidth <= 860) {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth"
      });
    }
  }

  function exportCSV() {
    if (!state.rows.length || !window.Papa) return;

    const csv = window.Papa.unparse(state.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const base = state.fileName.replace(/\.csv$/i, "") || "dataset";

    link.href = url;
    link.download = `${base}-cleaned.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    showToast("Cleaned CSV exported.");
  }

  function resetAnalysis() {
    state.fileName = "";
    state.originalRows = [];
    state.rows = [];
    state.columns = [];
    state.profiles = {};
    state.history = [];
    state.historySnapshots = [];
    state.filteredRows = null;
    state.activeFilter = null;
    state.page = 1;

    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }

    els.fileInput.value = "";
    els.workspace.hidden = true;
    els.startView.hidden = false;
    els.sidebarDataset.hidden = true;
    els.headerFileName.textContent = "New analysis";
    els.dropTitle.textContent = "Drop CSV here";
    els.dropCopy.textContent = "or choose a file from your device";

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function formatNumber(value, decimals = 2) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";

    if (Number.isInteger(Number(value))) {
      return Number(value).toLocaleString();
    }

    return Number(value).toLocaleString(undefined, {
      maximumFractionDigits: decimals
    });
  }

  function bindEvents() {
    els.chooseFile.addEventListener("click", () => els.fileInput.click());
    els.sampleData.addEventListener("click", loadSample);
    els.fileInput.addEventListener("change", () => loadFile(els.fileInput.files[0]));

    ["dragenter", "dragover"].forEach((eventName) => {
      els.dropCard.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropCard.classList.add("is-dragging");
        els.dropTitle.textContent = "Release to analyze";
        els.dropCopy.textContent = "DataLens is ready for your CSV";
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      els.dropCard.addEventListener(eventName, (event) => {
        event.preventDefault();
        els.dropCard.classList.remove("is-dragging");

        if (eventName === "drop") {
          loadFile(event.dataTransfer.files[0]);
        } else {
          els.dropTitle.textContent = "Drop CSV here";
          els.dropCopy.textContent = "or choose a file from your device";
        }
      });
    });

    $$("[data-view]").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.view));
    });

    $$("[data-jump-view]").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.jumpView));
    });

    els.tableSearch.addEventListener("input", () => {
      state.searchQuery = els.tableSearch.value;
      state.page = 1;
      renderDataTable();
    });

    els.applyFilter.addEventListener("click", applyFilter);
    els.clearFilter.addEventListener("click", clearFilter);

    els.prevPage.addEventListener("click", () => {
      state.page -= 1;
      renderDataTable();
    });

    els.nextPage.addEventListener("click", () => {
      state.page += 1;
      renderDataTable();
    });

    els.columnsGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-column]");
      if (card) openColumnDrawer(card.dataset.column);
    });

    $$("[data-close-drawer]").forEach((button) => {
      button.addEventListener("click", closeDrawer);
    });

    els.generateChart.addEventListener("click", generateChart);

    els.chartSuggestions.addEventListener("click", (event) => {
      const button = event.target.closest("[data-chart-suggestion]");
      if (!button) return;

      const suggestion = JSON.parse(button.dataset.chartSuggestion);

      els.chartType.value = suggestion.type;
      els.chartX.value = suggestion.x;
      els.chartY.value = suggestion.y;

      generateChart();
    });

    els.missingList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-clean-column]");
      if (button) openCleanModal(button.dataset.cleanColumn);
    });

    $$("[data-close-clean-modal]").forEach((button) => {
      button.addEventListener("click", closeCleanModal);
    });

    $$(".modal__options [data-clean-action]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!button.disabled) cleanColumn(button.dataset.cleanAction);
      });
    });

    els.removeDuplicates.addEventListener("click", removeDuplicates);
    els.undo.addEventListener("click", undoLast);

    [
      "#header-export-button",
      "#workspace-export-button"
    ].forEach((selector) => {
      $(selector).addEventListener("click", exportCSV);
    });

    [
      "#new-analysis-button",
      "#workspace-new-button"
    ].forEach((selector) => {
      $(selector).addEventListener("click", resetAnalysis);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeDrawer();
        closeCleanModal();
      }
    });
  }

  function initializeLenis() {
    if (
      !window.Lenis ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const lenis = new window.Lenis({
      smoothWheel: true,
      duration: 0.85
    });

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);
  }

  function initialize() {
    bindEvents();
    initializeLenis();

    const exportButtons = [
      $("#header-export-button")
    ];

    const observer = new MutationObserver(() => {
      const hasData = state.rows.length > 0;
      exportButtons.forEach((button) => (button.disabled = !hasData));
    });

    observer.observe(els.workspace, {
      attributes: true,
      attributeFilter: ["hidden"]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
