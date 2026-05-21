const state = {
  monaco: null,

  // 단일 비교
  diffEditor: null,
  leftModel: null,
  rightModel: null,
  leftEditor: null,
  rightEditor: null,
  singleDiffs: [],
  activeSingleDiffIndex: -1,
  leftDecorationIds: [],
  rightDecorationIds: [],
  aiMergeResult: null,
  aiResultModel: null,
  aiResultEditor: null,

  // 폴더 비교
  folderFilesMap: new Map(),

  // 폴더 상세 모달
  folderDiffEditor: null,
  folderLeftModel: null,
  folderRightModel: null,
  folderModalDiffs: [],
  folderModalIndex: -1,
  folderModalLeftDecorations: [],
  folderModalRightDecorations: []
};

document.addEventListener("DOMContentLoaded", async () => {
  bindTabs();
  bindFolderCompare();
  bindFolderModal();

  try {
    await initMonaco();
    bindSingleCompareUI();
    refreshSingleDiffState();
    document.getElementById("editorLoadNotice").textContent = "에디터 준비 완료";
  } catch (err) {
    document.getElementById("editorLoadNotice").textContent = `에디터 로딩 실패: ${err.message}`;
  }
});

/* ------------------------------
   탭
------------------------------ */
function bindTabs() {
  const buttons = document.querySelectorAll(".tab-button");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

/* ------------------------------
   Monaco 초기화
------------------------------ */
function loadMonaco() {
  return new Promise((resolve, reject) => {
    if (window.monaco?.editor) {
      resolve(window.monaco);
      return;
    }

    if (typeof window.require === "undefined") {
      reject(new Error("Monaco loader를 찾지 못했습니다."));
      return;
    }

    window.MonacoEnvironment = {
      getWorkerUrl: function () {
        const workerCode = `
self.MonacoEnvironment = { baseUrl: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/' };
importScripts('https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/base/worker/workerMain.js');
`;
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(workerCode)}`;
      }
    };

    window.require.config({
      paths: {
        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs"
      }
    });

    window.require(["vs/editor/editor.main"], () => {
      resolve(window.monaco);
    }, reject);
  });
}

async function initMonaco() {
  const monaco = await loadMonaco();
  state.monaco = monaco;

  const leftInitial = [
    "class Example:",
    "    def add(self, a, b):",
    "        return a + b",
    "",
    "def greet(name):",
    "    return f'Hello, {name}'"
  ].join("\n");

  const rightInitial = [
    "class Example:",
    "    def add(self, a, b):",
    "        result = a + b",
    "        return result",
    "",
    "def greet(username):",
    "    return f'Hello, {username}!'"
  ].join("\n");

  state.leftModel = monaco.editor.createModel(leftInitial, "python");
  state.rightModel = monaco.editor.createModel(rightInitial, "python");

  state.diffEditor = monaco.editor.createDiffEditor(
    document.getElementById("diffEditorContainer"),
    {
      theme: "vs",
      automaticLayout: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      originalEditable: true,
      readOnly: false,
      renderOverviewRuler: true,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      ignoreTrimWhitespace: false,
      minimap: { enabled: true },
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "off",
      fontSize: 14,
      glyphMargin: true
    }
  );

  state.diffEditor.setModel({
    original: state.leftModel,
    modified: state.rightModel
  });

  state.leftEditor = state.diffEditor.getOriginalEditor();
  state.rightEditor = state.diffEditor.getModifiedEditor();

  [state.leftEditor, state.rightEditor].forEach((editor) => {
    editor.updateOptions({
      lineNumbers: "on",
      glyphMargin: true,
      folding: true,
      minimap: { enabled: true },
      fontSize: 14
    });
  });

  const debouncedRefresh = debounce(() => {
    refreshSingleDiffState();
  }, 180);

  state.leftModel.onDidChangeContent(debouncedRefresh);
  state.rightModel.onDidChangeContent(debouncedRefresh);

  state.leftEditor.onDidChangeCursorPosition((e) => {
    syncActiveDiffFromEditor("left", e.position.lineNumber);
  });

  state.rightEditor.onDidChangeCursorPosition((e) => {
    syncActiveDiffFromEditor("right", e.position.lineNumber);
  });
}

/* ------------------------------
   단일 비교 UI 바인딩
------------------------------ */
function bindSingleCompareUI() {
  document.getElementById("leftFileInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.leftModel.setValue(normalizeNewlines(await file.text()));
  });

  document.getElementById("rightFileInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.rightModel.setValue(normalizeNewlines(await file.text()));
  });

  document.getElementById("swapInputsBtn").addEventListener("click", () => {
    const left = state.leftModel.getValue();
    const right = state.rightModel.getValue();
    state.leftModel.setValue(right);
    state.rightModel.setValue(left);
    refreshSingleDiffState();
  });

  document.getElementById("refreshDiffBtn").addEventListener("click", () => {
    refreshSingleDiffState();
  });

  document.getElementById("prevChangeBtn").addEventListener("click", () => {
    moveSingleDiff(-1);
  });

  document.getElementById("nextChangeBtn").addEventListener("click", () => {
    moveSingleDiff(1);
  });

  document.getElementById("applyRightToLeftBtn").addEventListener("click", () => {
    applyCurrentSingleDiff("left-from-right");
  });

  document.getElementById("applyLeftToRightBtn").addEventListener("click", () => {
    applyCurrentSingleDiff("right-from-left");
  });

  document.getElementById("aiMergeAllBtn").addEventListener("click", async () => {
    await runAIWholeMerge();
  });

  document.getElementById("changeList").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-change-index]");
    if (!btn) return;
    const index = Number(btn.dataset.changeIndex);
    setActiveSingleDiff(index, true);
  });

  document.getElementById("aiMergePanel").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-ai-apply]");
    if (!btn || !state.aiMergeResult) return;
    applyAIMergedCodeToSide(btn.dataset.aiApply);
  });
}

/* ------------------------------
   단일 비교 로직
------------------------------ */
function refreshSingleDiffState() {
  if (!state.leftModel || !state.rightModel) return;

  const left = state.leftModel.getValue();
  const right = state.rightModel.getValue();
  state.singleDiffs = buildLineDiffBlocks(left, right);

  const meta = document.getElementById("singleCompareMeta");
  if (!state.singleDiffs.length) {
    meta.textContent = "차이 없음";
    state.activeSingleDiffIndex = -1;
  } else {
    if (state.activeSingleDiffIndex < 0 || state.activeSingleDiffIndex >= state.singleDiffs.length) {
      state.activeSingleDiffIndex = 0;
    }
    meta.textContent = `줄/단어 diff 기반 비교: 차이 ${state.singleDiffs.length}개`;
  }

  renderSingleChangeList();
  updateSingleToolbar();
  applySingleActiveDecorations();
  updateCurrentChangeHint();

  if (state.activeSingleDiffIndex >= 0) {
    revealSingleDiff(state.activeSingleDiffIndex, false);
  }
}

function renderSingleChangeList() {
  const changeList = document.getElementById("changeList");

  if (!state.singleDiffs.length) {
    changeList.className = "change-list empty-state-list";
    changeList.textContent = "변경점이 없습니다.";
    return;
  }

  changeList.className = "change-list";
  changeList.innerHTML = state.singleDiffs
    .map((diff, index) => {
      const active = index === state.activeSingleDiffIndex ? "active" : "";
      return `
        <button class="change-chip ${active}" data-change-index="${index}">
          ${index + 1}. L ${escapeHtml(formatRange(diff.leftStart, diff.leftEnd))}
          / R ${escapeHtml(formatRange(diff.rightStart, diff.rightEnd))}
        </button>
      `;
    })
    .join("");
}

function updateSingleToolbar() {
  const countText = document.getElementById("changeCounterText");
  const prevBtn = document.getElementById("prevChangeBtn");
  const nextBtn = document.getElementById("nextChangeBtn");
  const applyRTL = document.getElementById("applyRightToLeftBtn");
  const applyLTR = document.getElementById("applyLeftToRightBtn");
  const aiBtn = document.getElementById("aiMergeAllBtn");

  const total = state.singleDiffs.length;
  const hasDiff = total > 0;
  const current = hasDiff ? state.activeSingleDiffIndex + 1 : 0;

  countText.textContent = `${current} of ${total}`;
  prevBtn.disabled = !hasDiff;
  nextBtn.disabled = !hasDiff;
  applyRTL.disabled = !hasDiff;
  applyLTR.disabled = !hasDiff;
  aiBtn.disabled = false;
}

function updateCurrentChangeHint() {
  const el = document.getElementById("currentChangeHint");
  const diff = state.singleDiffs[state.activeSingleDiffIndex];
  if (!diff) {
    el.textContent = "현재 선택된 변경 없음";
    return;
  }
  el.textContent = `현재 변경: 왼쪽 ${formatRange(diff.leftStart, diff.leftEnd)} / 오른쪽 ${formatRange(diff.rightStart, diff.rightEnd)}`;
}

function moveSingleDiff(delta) {
  if (!state.singleDiffs.length) return;
  const total = state.singleDiffs.length;
  let next = state.activeSingleDiffIndex + delta;
  if (next < 0) next = total - 1;
  if (next >= total) next = 0;
  setActiveSingleDiff(next, true);
}

function setActiveSingleDiff(index, reveal = true) {
  if (!state.singleDiffs.length) {
    state.activeSingleDiffIndex = -1;
    updateSingleToolbar();
    renderSingleChangeList();
    applySingleActiveDecorations();
    updateCurrentChangeHint();
    return;
  }

  const safe = Math.max(0, Math.min(index, state.singleDiffs.length - 1));
  state.activeSingleDiffIndex = safe;
  updateSingleToolbar();
  renderSingleChangeList();
  applySingleActiveDecorations();
  updateCurrentChangeHint();

  if (reveal) revealSingleDiff(safe, true);
}

function revealSingleDiff(index, focus = true) {
  const diff = state.singleDiffs[index];
  if (!diff) return;

  revealRangeInEditor(state.leftEditor, state.leftModel, diff.leftStart, diff.leftEnd, focus);
  revealRangeInEditor(state.rightEditor, state.rightModel, diff.rightStart, diff.rightEnd, focus);
}

function revealRangeInEditor(editor, model, startLine, endLine, focus) {
  const lineCount = model.getLineCount();
  if (!lineCount) return;

  let targetLine;
  if (endLine >= startLine && startLine >= 1) {
    targetLine = startLine;
  } else {
    targetLine = Math.max(1, Math.min(startLine || 1, lineCount));
  }

  editor.revealLineInCenter(targetLine);
  if (focus) editor.setPosition({ lineNumber: targetLine, column: 1 });
}

function syncActiveDiffFromEditor(side, lineNumber) {
  if (!state.singleDiffs.length) return;
  const index = findNearestDiffIndex(state.singleDiffs, side, lineNumber);
  if (index !== state.activeSingleDiffIndex) {
    setActiveSingleDiff(index, false);
  }
}

function findNearestDiffIndex(diffs, side, lineNumber) {
  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  diffs.forEach((diff, index) => {
    const start = side === "left" ? diff.leftStart : diff.rightStart;
    const end = side === "left" ? diff.leftEnd : diff.rightEnd;

    let score;
    if (end >= start && lineNumber >= start && lineNumber <= end) {
      score = -1000 + (end - start);
    } else if (end >= start) {
      score = Math.min(Math.abs(lineNumber - start), Math.abs(lineNumber - end));
    } else {
      score = Math.abs(lineNumber - start) + 0.5;
    }

    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function applySingleActiveDecorations() {
  if (!state.monaco || !state.leftEditor || !state.rightEditor) return;

  const monaco = state.monaco;
  const diff = state.singleDiffs[state.activeSingleDiffIndex];
  const leftDecs = [];
  const rightDecs = [];

  if (diff) {
    const leftRange = createHighlightRange(state.leftModel, diff.leftStart, diff.leftEnd, monaco);
    const rightRange = createHighlightRange(state.rightModel, diff.rightStart, diff.rightEnd, monaco);

    if (leftRange) {
      leftDecs.push({
        range: leftRange,
        options: {
          isWholeLine: true,
          className: "active-diff-left",
          linesDecorationsClassName: "active-diff-gutter-left"
        }
      });
    }

    if (rightRange) {
      rightDecs.push({
        range: rightRange,
        options: {
          isWholeLine: true,
          className: "active-diff-right",
          linesDecorationsClassName: "active-diff-gutter-right"
        }
      });
    }
  }

  state.leftDecorationIds = state.leftEditor.deltaDecorations(state.leftDecorationIds, leftDecs);
  state.rightDecorationIds = state.rightEditor.deltaDecorations(state.rightDecorationIds, rightDecs);
}

function createHighlightRange(model, startLine, endLine, monaco) {
  const lineCount = model.getLineCount();
  if (!lineCount) return null;

  if (endLine >= startLine && startLine >= 1) {
    const safeStart = Math.max(1, Math.min(startLine, lineCount));
    const safeEnd = Math.max(1, Math.min(endLine, lineCount));
    return new monaco.Range(safeStart, 1, safeEnd, model.getLineMaxColumn(safeEnd));
  }

  const anchor = Math.max(1, Math.min(startLine || 1, lineCount));
  return new monaco.Range(anchor, 1, anchor, model.getLineMaxColumn(anchor));
}

function applyCurrentSingleDiff(mode) {
  const diff = state.singleDiffs[state.activeSingleDiffIndex];
  if (!diff) return;

  if (mode === "left-from-right") {
    const updated = replaceLineRange(
      state.leftModel.getValue(),
      diff.leftStart,
      diff.leftEnd,
      diff.rightText || ""
    );
    state.leftModel.setValue(updated);
  } else {
    const updated = replaceLineRange(
      state.rightModel.getValue(),
      diff.rightStart,
      diff.rightEnd,
      diff.leftText || ""
    );
    state.rightModel.setValue(updated);
  }

  refreshSingleDiffState();
}

/* ------------------------------
   AI 전체 병합
------------------------------ */
async function runAIWholeMerge() {
  const apiKey = document.getElementById("apiKeyInput").value.trim();
  const model = document.getElementById("modelInput").value.trim() || "gpt-4o-mini";
  const reasoningEffort = document.getElementById("reasoningEffortSelect").value;
  const extraInstruction = document.getElementById("mergeInstruction").value.trim();
  const aiPanel = document.getElementById("aiMergePanel");

  const leftCode = state.leftModel.getValue();
  const rightCode = state.rightModel.getValue();

  if (!apiKey) {
    alert("OpenAI API Key를 입력하세요.");
    return;
  }

  if (!leftCode.trim() && !rightCode.trim()) {
    alert("왼쪽과 오른쪽 코드가 모두 비어 있습니다.");
    return;
  }

  aiPanel.className = "ai-merge-panel";
  const resultContent = document.getElementById("aiResultContent");
  const emptyText = document.getElementById("aiFillText");
  if (resultContent) resultContent.classList.add("hidden");
  if (emptyText) {
    emptyText.classList.remove("hidden");
    emptyText.textContent = "AI 전체 융합 중...";
  }

  const systemPrompt = buildWholeMergeSystemPrompt();
  const userPrompt = buildWholeMergeUserPrompt(leftCode, rightCode, extraInstruction);

  try {
    const merged = await callOpenAIResponsesAPI({
      apiKey,
      model,
      reasoningEffort,
      systemPrompt,
      userPrompt
    });

    state.aiMergeResult = {
      content: stripCodeFence(merged).trim()
    };

    renderAIMergePanel();
  } catch (err) {
    const resultContent = document.getElementById("aiResultContent");
    const emptyText = document.getElementById("aiFillText");
    if (resultContent) resultContent.classList.add("hidden");
    if (emptyText) {
      emptyText.classList.remove("hidden");
      emptyText.textContent = `AI 전체 융합 실패: ${err.message}`;
    }
    aiPanel.className = "ai-merge-panel empty-state";
  }
}

function buildWholeMergeSystemPrompt() {
  return [
    "You are a meticulous Python file merge engine.",
    "You will receive two full Python files.",
    "Your task is to produce one final merged full Python file.",
    "Return ONLY the final merged Python code.",
    "Do NOT return explanations.",
    "Do NOT return markdown fences.",
    "Do NOT return a patch or diff.",
    "Do NOT return partial snippets.",
    "Do NOT omit unchanged sections.",
    "The output must be a complete standalone Python file from the first line to the last line.",
    "Preserve valid Python syntax, indentation, imports, globals, classes, functions, comments, and executable behavior as appropriate.",
    "When both sides contain useful logic, integrate both into one coherent final file rather than choosing a tiny subset."
  ].join(" ");
}

function buildWholeMergeUserPrompt(leftCode, rightCode, extraInstruction) {
  return `
다음 두 개의 Python 전체 파일을 하나의 최종 Python 전체 파일로 융합하라.

매우 중요:
1. 응답은 오직 최종 Python 코드 전체만 반환하라.
2. 설명, 요약, 마크다운 코드펜스(\`\`\`)를 절대 넣지 마라.
3. 일부 함수만 반환하거나 일부 변경 부분만 반환하면 안 된다.
4. 첫 줄부터 마지막 줄까지, 완성된 "전체 파일"을 반환하라.
5. import, 상수, 전역 변수, 클래스, 함수, 주석, 보조 함수 등 파일 구성 요소를 빠뜨리지 마라.
6. 양쪽 코드에 각각 유용한 로직이 있으면 가능한 한 통합하라.
7. 한쪽에만 있는 기능도 충돌하지 않는다면 유지하라.
8. 결과는 바로 파일 전체를 덮어쓸 수 있는 완성 코드여야 한다.

[왼쪽 전체 코드]
${leftCode || "(비어 있음)"}

[오른쪽 전체 코드]
${rightCode || "(비어 있음)"}

[추가 지시]
${extraInstruction || "(없음)"}

다시 강조:
- 전체 파일을 반환하라.
- 일부 조각만 반환하지 마라.
- diff 형식으로 반환하지 마라.
- 반드시 완성된 최종 Python 전체 코드만 출력하라.
`.trim();
}

async function callOpenAIResponsesAPI({ apiKey, model, reasoningEffort, systemPrompt, userPrompt }) {
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemPrompt
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: userPrompt
          }
        ]
      }
    ]
  };

  const maybeReasoning = getReasoningPayload(model, reasoningEffort);
  if (maybeReasoning) {
    body.reasoning = maybeReasoning;
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} / ${text}`);
  }

  const data = await res.json();
  const text = extractResponseText(data);

  if (!text.trim()) {
    throw new Error("응답 본문에서 텍스트 코드를 추출하지 못했습니다.");
  }

  return text;
}

function getReasoningPayload(model, effort) {
  if (!effort || effort === "none") return null;

  const normalized = (model || "").toLowerCase().trim();
  const looksReasoningCapable =
    /^o\d/.test(normalized) ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.startsWith("gpt-5");

  if (!looksReasoningCapable) {
    return null;
  }

  return { effort };
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const output = Array.isArray(data.output) ? data.output : [];
  let combined = "";

  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if ((part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
        combined += part.text;
      }
    }
  }

  return combined;
}

function ensureAIResultEditor() {
  if (!state.monaco) return;
  if (state.aiResultEditor) return;

  const container = document.getElementById("aiResultEditorContainer");
  if (!container) return;

  state.aiResultModel = state.monaco.editor.createModel("", "python");
  state.aiResultEditor = state.monaco.editor.create(container, {
    model: state.aiResultModel,
    theme: "vs",
    automaticLayout: true,
    readOnly: false,
    language: "python",
    minimap: { enabled: false },
    lineNumbers: "on",
    wordWrap: "off",
    fontSize: 14,
    glyphMargin: false,
    scrollBeyondLastLine: false,
    renderLineHighlight: "all"
  });
}

function renderAIMergePanel() {
  const panel = document.getElementById("aiMergePanel");
  const contentWrap = document.getElementById("aiResultContent");
  const emptyText = document.getElementById("aiFillText");

  if (!state.aiMergeResult) {
    panel.className = "ai-merge-panel empty-state";
    if (contentWrap) contentWrap.classList.add("hidden");
    if (emptyText) {
      emptyText.classList.remove("hidden");
      emptyText.textContent = "아직 AI 전체 융합 결과가 없습니다.";
    }
    return;
  }

  panel.className = "ai-merge-panel";
  if (contentWrap) contentWrap.classList.remove("hidden");
  if (emptyText) emptyText.classList.add("hidden");

  ensureAIResultEditor();
  if (state.aiResultModel) {
    state.aiResultModel.setValue(state.aiMergeResult.content);
  }
  if (state.aiResultEditor) {
    state.aiResultEditor.layout();
  }
}

function applyAIMergedCodeToSide(target) {
  const result = state.aiMergeResult;
  if (!result || !state.aiResultEditor) return;

  const merged = state.aiResultEditor.getValue();

  if (target === "left") {
    state.leftModel.setValue(merged);
  } else {
    state.rightModel.setValue(merged);
  }

  refreshSingleDiffState();
}

/* ------------------------------
   폴더 비교
------------------------------ */
function bindFolderCompare() {
  const leftFolderInput = document.getElementById("leftFolderInput");
  const rightFolderInput = document.getElementById("rightFolderInput");
  const leftFolderInfo = document.getElementById("leftFolderInfo");
  const rightFolderInfo = document.getElementById("rightFolderInfo");
  const compareFolderBtn = document.getElementById("compareFolderBtn");
  const folderResults = document.getElementById("folderResults");

  leftFolderInput.addEventListener("change", () => {
    leftFolderInfo.textContent = folderSelectionInfo(leftFolderInput.files);
  });

  rightFolderInput.addEventListener("change", () => {
    rightFolderInfo.textContent = folderSelectionInfo(rightFolderInput.files);
  });

  compareFolderBtn.addEventListener("click", compareFolders);

  folderResults.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-open-path]");
    if (!btn) return;
    const path = decodeURIComponent(btn.dataset.openPath);
    await openFolderDiffModal(path);
  });
}

function folderSelectionInfo(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return "선택된 폴더 없음";
  const pyCount = files.filter((f) => f.name.toLowerCase().endsWith(".py")).length;
  const first = files[0]?.webkitRelativePath?.split("/")[0] || "폴더";
  return `${first} / 전체 ${files.length}개 파일 / Python ${pyCount}개`;
}

async function compareFolders() {
  const leftInput = document.getElementById("leftFolderInput");
  const rightInput = document.getElementById("rightFolderInput");
  const leftOnlyList = document.getElementById("leftOnlyList");
  const rightOnlyList = document.getElementById("rightOnlyList");
  const folderResults = document.getElementById("folderResults");
  const folderMeta = document.getElementById("folderCompareMeta");

  const leftFiles = Array.from(leftInput.files || []).filter((f) => f.name.toLowerCase().endsWith(".py"));
  const rightFiles = Array.from(rightInput.files || []).filter((f) => f.name.toLowerCase().endsWith(".py"));

  if (!leftFiles.length && !rightFiles.length) {
    alert("비교할 Python 폴더 파일이 없습니다.");
    return;
  }

  folderResults.className = "folder-results-grid";
  folderResults.innerHTML = `<div class="loading">폴더 비교 중...</div>`;
  folderMeta.textContent = "비교 중...";
  leftOnlyList.innerHTML = "";
  rightOnlyList.innerHTML = "";
  state.folderFilesMap = new Map();

  const leftMap = buildFileMap(leftFiles);
  const rightMap = buildFileMap(rightFiles);

  const leftPaths = new Set(Object.keys(leftMap));
  const rightPaths = new Set(Object.keys(rightMap));
  const allPaths = Array.from(new Set([...leftPaths, ...rightPaths])).sort();

  const leftOnly = allPaths.filter((p) => leftPaths.has(p) && !rightPaths.has(p));
  const rightOnly = allPaths.filter((p) => !leftPaths.has(p) && rightPaths.has(p));
  const common = allPaths.filter((p) => leftPaths.has(p) && rightPaths.has(p));

  leftOnlyList.innerHTML = leftOnly.length
    ? leftOnly.map((p) => `<li>${escapeHtml(p)}</li>`).join("")
    : "<li>없음</li>";

  rightOnlyList.innerHTML = rightOnly.length
    ? rightOnly.map((p) => `<li>${escapeHtml(p)}</li>`).join("")
    : "<li>없음</li>";

  const results = await Promise.all(
    common.map(async (path) => {
      const [leftText, rightText] = await Promise.all([
        leftMap[path].text(),
        rightMap[path].text()
      ]);

      const result = compareCode(leftText, rightText);
      const item = {
        path,
        leftText: normalizeNewlines(leftText),
        rightText: normalizeNewlines(rightText),
        result
      };
      state.folderFilesMap.set(path, item);
      return item;
    })
  );

  const sameCount = results.filter((x) => x.result.identical).length;
  const diffCount = results.length - sameCount;

  folderMeta.textContent =
    `공통 Python 파일 ${common.length}개 / 동일 ${sameCount}개 / 차이 ${diffCount}개 / 왼쪽 전용 ${leftOnly.length}개 / 오른쪽 전용 ${rightOnly.length}개`;

  if (!results.length) {
    folderResults.className = "folder-results-grid empty-state";
    folderResults.textContent = "공통 Python 파일이 없습니다.";
    return;
  }

  folderResults.className = "folder-results-grid";
  folderResults.innerHTML = results
    .sort((a, b) => {
      if (a.result.identical === b.result.identical) return a.path.localeCompare(b.path);
      return a.result.identical ? 1 : -1;
    })
    .map(renderFolderFileCard)
    .join("");
}

function buildFileMap(files) {
  const map = {};
  for (const file of files) {
    map[getInnerRelativePath(file)] = file;
  }
  return map;
}

function getInnerRelativePath(file) {
  const raw = file.webkitRelativePath || file.name;
  const parts = raw.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : raw;
}

function renderFolderFileCard(item) {
  const { path, result } = item;
  const cls = result.identical ? "same" : "diff";
  const status = result.identical ? "동일" : "차이 있음";
  const modeLabel = result.mode === "chunk" ? "함수/클래스 블록" : "줄 단위";
  const detailItems = summarizeDiffItems(result);

  return `
    <div class="file-card ${cls}">
      <div class="file-card-header">
        <h4>${escapeHtml(path)}</h4>
        <span class="status-pill ${cls}">${status}</span>
      </div>

      <div class="file-card-body">
        <div class="summary-tags">
          <span class="summary-tag">비교 모드: ${escapeHtml(modeLabel)}</span>
          <span class="summary-tag">차이 블록: ${result.diffs.length}</span>
        </div>

        ${
          result.identical
            ? `<div>두 파일의 내용이 동일합니다.</div>`
            : `<ul class="inline-list">${detailItems.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
        }

        <button class="action-btn" data-open-path="${encodeURIComponent(path)}">
          상세 diff 열기
        </button>
      </div>
    </div>
  `;
}

function summarizeDiffItems(result) {
  if (result.identical) return [];
  if (result.mode === "chunk") {
    return result.diffs.slice(0, 6).map((d) => d.label);
  }
  return result.diffs.slice(0, 6).map((d) => {
    return `${d.label}: 왼쪽 ${formatRange(d.leftStart, d.leftEnd)} / 오른쪽 ${formatRange(d.rightStart, d.rightEnd)}`;
  });
}

/* ------------------------------
   폴더 상세 모달
------------------------------ */
function bindFolderModal() {
  const modal = document.getElementById("folderDiffModal");

  document.getElementById("closeFolderDiffModalBtn").addEventListener("click", closeFolderDiffModal);
  document.getElementById("folderModalPrevBtn").addEventListener("click", () => moveFolderModalDiff(-1));
  document.getElementById("folderModalNextBtn").addEventListener("click", () => moveFolderModalDiff(1));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFolderDiffModal();
  });
}

async function ensureFolderDiffEditor() {
  if (state.folderDiffEditor) return;

  const monaco = state.monaco || await loadMonaco();

  state.folderLeftModel = monaco.editor.createModel("", "python");
  state.folderRightModel = monaco.editor.createModel("", "python");

  state.folderDiffEditor = monaco.editor.createDiffEditor(
    document.getElementById("folderDiffEditorContainer"),
    {
      theme: "vs",
      automaticLayout: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      originalEditable: false,
      readOnly: true,
      renderOverviewRuler: true,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      ignoreTrimWhitespace: false,
      minimap: { enabled: true },
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "off",
      fontSize: 14,
      glyphMargin: true
    }
  );

  state.folderDiffEditor.setModel({
    original: state.folderLeftModel,
    modified: state.folderRightModel
  });
}

async function openFolderDiffModal(path) {
  const item = state.folderFilesMap.get(path);
  if (!item) return;

  await ensureFolderDiffEditor();

  state.folderLeftModel.setValue(item.leftText);
  state.folderRightModel.setValue(item.rightText);
  state.folderModalDiffs = buildLineDiffBlocks(item.leftText, item.rightText);
  state.folderModalIndex = state.folderModalDiffs.length ? 0 : -1;

  document.getElementById("folderModalTitle").textContent = path;
  document.getElementById("folderModalMeta").textContent =
    state.folderModalDiffs.length
      ? `줄/단어 diff 기준 차이 ${state.folderModalDiffs.length}개`
      : "차이 없음";

  document.getElementById("folderDiffModal").classList.remove("hidden");
  setTimeout(() => {
    state.folderDiffEditor.layout();
    applyFolderModalDecorations();
    if (state.folderModalIndex >= 0) revealFolderModalDiff(state.folderModalIndex);
  }, 0);
}

function closeFolderDiffModal() {
  document.getElementById("folderDiffModal").classList.add("hidden");
}

function moveFolderModalDiff(delta) {
  if (!state.folderModalDiffs.length) return;
  const total = state.folderModalDiffs.length;
  let next = state.folderModalIndex + delta;
  if (next < 0) next = total - 1;
  if (next >= total) next = 0;
  state.folderModalIndex = next;
  applyFolderModalDecorations();
  revealFolderModalDiff(next);
}

function revealFolderModalDiff(index) {
  const diff = state.folderModalDiffs[index];
  if (!diff || !state.folderDiffEditor) return;

  const leftEditor = state.folderDiffEditor.getOriginalEditor();
  const rightEditor = state.folderDiffEditor.getModifiedEditor();

  revealRangeInEditor(leftEditor, state.folderLeftModel, diff.leftStart, diff.leftEnd, true);
  revealRangeInEditor(rightEditor, state.folderRightModel, diff.rightStart, diff.rightEnd, true);
}

function applyFolderModalDecorations() {
  if (!state.folderDiffEditor || !state.monaco) return;

  const leftEditor = state.folderDiffEditor.getOriginalEditor();
  const rightEditor = state.folderDiffEditor.getModifiedEditor();
  const monaco = state.monaco;
  const diff = state.folderModalDiffs[state.folderModalIndex];

  const leftDecs = [];
  const rightDecs = [];

  if (diff) {
    const leftRange = createHighlightRange(state.folderLeftModel, diff.leftStart, diff.leftEnd, monaco);
    const rightRange = createHighlightRange(state.folderRightModel, diff.rightStart, diff.rightEnd, monaco);

    if (leftRange) {
      leftDecs.push({
        range: leftRange,
        options: {
          isWholeLine: true,
          className: "active-diff-left",
          linesDecorationsClassName: "active-diff-gutter-left"
        }
      });
    }
    if (rightRange) {
      rightDecs.push({
        range: rightRange,
        options: {
          isWholeLine: true,
          className: "active-diff-right",
          linesDecorationsClassName: "active-diff-gutter-right"
        }
      });
    }
  }

  state.folderModalLeftDecorations = leftEditor.deltaDecorations(state.folderModalLeftDecorations, leftDecs);
  state.folderModalRightDecorations = rightEditor.deltaDecorations(state.folderModalRightDecorations, rightDecs);
}

/* ------------------------------
   비교 유틸
------------------------------ */
function normalizeNewlines(text) {
  return (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitLines(text) {
  const normalized = normalizeNewlines(text);
  if (normalized === "") return [];
  return normalized.split("\n");
}

function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatRange(start, end) {
  if (start == null || end == null) return "없음";
  if (end < start) return `${start} 앞 삽입`;
  return `${start}-${end}`;
}

function replaceLineRange(sourceText, startLine, endLine, newContent) {
  const lines = splitLines(sourceText);
  const replacement = newContent === "" ? [] : splitLines(newContent);

  const start = Math.max(1, startLine || 1);
  const from = Math.max(0, start - 1);

  if (endLine >= startLine) {
    const before = lines.slice(0, from);
    const after = lines.slice(endLine);
    return [...before, ...replacement, ...after].join("\n");
  }

  const before = lines.slice(0, from);
  const after = lines.slice(from);
  return [...before, ...replacement, ...after].join("\n");
}

function stripCodeFence(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\n?/, "");
    t = t.replace(/```$/, "");
  }
  return t.trim();
}

function debounce(fn, delay = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ------------------------------
   라인 diff
------------------------------ */
function buildLineDiffBlocks(leftText, rightText) {
  const A = splitLines(leftText);
  const B = splitLines(rightText);
  const n = A.length;
  const m = B.length;

  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (A[i] === B[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push({ type: "equal", left: A[i], right: B[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", left: A[i] });
      i++;
    } else {
      ops.push({ type: "insert", right: B[j] });
      j++;
    }
  }

  while (i < n) ops.push({ type: "delete", left: A[i++] });
  while (j < m) ops.push({ type: "insert", right: B[j++] });

  const blocks = [];
  let leftLine = 1;
  let rightLine = 1;
  let current = null;

  const closeBlock = () => {
    if (!current) return;
    current.leftEnd = current.leftLines.length
      ? current.leftStart + current.leftLines.length - 1
      : current.leftStart - 1;
    current.rightEnd = current.rightLines.length
      ? current.rightStart + current.rightLines.length - 1
      : current.rightStart - 1;
    current.leftText = current.leftLines.join("\n");
    current.rightText = current.rightLines.join("\n");
    current.label = `줄 차이 ${blocks.length + 1}`;
    blocks.push(current);
    current = null;
  };

  for (const op of ops) {
    if (op.type === "equal") {
      closeBlock();
      leftLine++;
      rightLine++;
      continue;
    }

    if (!current) {
      current = {
        leftStart: leftLine,
        rightStart: rightLine,
        leftLines: [],
        rightLines: []
      };
    }

    if (op.type === "delete") {
      current.leftLines.push(op.left);
      leftLine++;
    } else {
      current.rightLines.push(op.right);
      rightLine++;
    }
  }

  closeBlock();
  return blocks;
}

/* ------------------------------
   폴더 비교용 블록 비교
------------------------------ */
function compareCode(left, right) {
  const leftChunks = parsePythonChunks(left);
  const rightChunks = parsePythonChunks(right);
  const namedCount =
    leftChunks.filter((c) => c.named).length + rightChunks.filter((c) => c.named).length;

  if (namedCount > 0) {
    const diffs = compareByChunks(leftChunks, rightChunks);
    return {
      mode: "chunk",
      diffs,
      identical: diffs.length === 0
    };
  }

  const diffs = buildLineDiffBlocks(left, right);
  return {
    mode: "line",
    diffs,
    identical: diffs.length === 0
  };
}

function parsePythonChunks(code) {
  const lines = splitLines(code);
  if (!lines.length) return [];

  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(async\s+def|def|class)\s+([A-Za-z_]\w*)\b/);
    if (match) {
      let start = i;
      while (start > 0 && lines[start - 1].trim().startsWith("@")) {
        start--;
      }
      defs.push({
        start,
        declLine: i,
        kind: match[1],
        name: match[2]
      });
    }
  }

  const uniqueDefs = defs.filter((d, idx, arr) => idx === 0 || d.start !== arr[idx - 1].start);
  if (!uniqueDefs.length) {
    return [{
      id: "top_1",
      label: "전체 코드",
      named: false,
      order: 0,
      startLine: 1,
      endLine: lines.length,
      content: lines.join("\n")
    }];
  }

  const chunks = [];
  let cursor = 0;
  let unnamedIndex = 1;
  let order = 0;

  for (let i = 0; i < uniqueDefs.length; i++) {
    const def = uniqueDefs[i];
    const nextDef = uniqueDefs[i + 1];
    const blockEnd = nextDef ? nextDef.start - 1 : lines.length - 1;

    if (def.start > cursor) {
      const unnamedLines = lines.slice(cursor, def.start);
      if (unnamedLines.join("\n").trim() !== "") {
        chunks.push({
          id: `unnamed_${unnamedIndex}`,
          label: `Top-level block ${unnamedIndex}`,
          named: false,
          order: order++,
          startLine: cursor + 1,
          endLine: def.start,
          content: unnamedLines.join("\n")
        });
        unnamedIndex++;
      }
    }

    chunks.push({
      id: `named_${def.name}_${i}`,
      label: `${def.kind} ${def.name}`,
      name: def.name,
      kind: def.kind,
      named: true,
      order: order++,
      startLine: def.start + 1,
      endLine: blockEnd + 1,
      content: lines.slice(def.start, blockEnd + 1).join("\n")
    });

    cursor = blockEnd + 1;
  }

  if (cursor < lines.length) {
    const tail = lines.slice(cursor);
    if (tail.join("\n").trim() !== "") {
      chunks.push({
        id: `unnamed_${unnamedIndex}`,
        label: `Top-level block ${unnamedIndex}`,
        named: false,
        order: order++,
        startLine: cursor + 1,
        endLine: lines.length,
        content: tail.join("\n")
      });
    }
  }

  return chunks;
}

function compareByChunks(leftChunks, rightChunks) {
  const diffs = [];
  const usedLeft = new Set();
  const usedRight = new Set();

  const leftNamed = groupByName(leftChunks.filter((c) => c.named));
  const rightNamed = groupByName(rightChunks.filter((c) => c.named));

  const allNames = Array.from(new Set([...Object.keys(leftNamed), ...Object.keys(rightNamed)]));
  const pairs = [];

  allNames.forEach((name) => {
    const a = leftNamed[name] || [];
    const b = rightNamed[name] || [];
    const max = Math.max(a.length, b.length);

    for (let i = 0; i < max; i++) {
      const left = a[i] || null;
      const right = b[i] || null;
      if (left) usedLeft.add(left.id);
      if (right) usedRight.add(right.id);

      pairs.push({
        left,
        right,
        sortA: left?.order ?? Number.MAX_SAFE_INTEGER,
        sortB: right?.order ?? Number.MAX_SAFE_INTEGER
      });
    }
  });

  const leftUnnamed = leftChunks.filter((c) => !usedLeft.has(c.id));
  const rightUnnamed = rightChunks.filter((c) => !usedRight.has(c.id));
  const maxUnnamed = Math.max(leftUnnamed.length, rightUnnamed.length);

  for (let i = 0; i < maxUnnamed; i++) {
    pairs.push({
      left: leftUnnamed[i] || null,
      right: rightUnnamed[i] || null,
      sortA: leftUnnamed[i]?.order ?? Number.MAX_SAFE_INTEGER,
      sortB: rightUnnamed[i]?.order ?? Number.MAX_SAFE_INTEGER
    });
  }

  pairs.sort((p1, p2) => {
    const a = Math.min(p1.sortA, p1.sortB);
    const b = Math.min(p2.sortA, p2.sortB);
    return a - b;
  });

  for (const pair of pairs) {
    const left = pair.left;
    const right = pair.right;

    if (left && right) {
      if (left.content !== right.content) {
        diffs.push({
          label: left.label === right.label ? left.label : `${left.label} ↔ ${right.label}`,
          leftChunk: left,
          rightChunk: right
        });
      }
    } else if (left || right) {
      diffs.push({
        label: left?.label || right?.label || "블록 차이",
        leftChunk: left,
        rightChunk: right
      });
    }
  }

  return diffs;
}

function groupByName(chunks) {
  const map = {};
  for (const chunk of chunks) {
    if (!map[chunk.name]) map[chunk.name] = [];
    map[chunk.name].push(chunk);
  }
  return map;
}