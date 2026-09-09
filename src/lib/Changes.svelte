<script>
  import Icon from "./Icon.svelte";

  let data = $state(null);
  let loading = $state(true);
  let refreshTrigger = $state(0);
  let expandedOption = $state(null);
  let revertingOptionKey = $state(null);

  function formatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString();
  }

  function openPackage(pkg, source) {
    if (source === 'live') {
      window.dispatchEvent(new CustomEvent('select-package', { detail: { pkg, source } }));
    } else {
      window.dispatchEvent(new CustomEvent('select-package', { detail: pkg }));
    }
  }

  function formatRelative(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 0) return 'just now';
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  function summarizeOptionChange(change) {
    if (!change) return '';
    if (change.action === 'added') return 'added';
    if (change.action === 'removed') return 'removed';
    if (change.action === 'reverted') return 'reverted';
    if (change.oldValue == null && change.newValue != null) return 'set';
    return 'updated';
  }

  function optionChangeKey(change, idx) {
    return `${change.optionPath}:${change.file}:${idx}`;
  }

  async function revertOptionChange(change, idx) {
    if (!change || change.oldValue == null || change.action !== 'set') return;
    const key = optionChangeKey(change, idx);
    revertingOptionKey = key;
    try {
      const result = change.source === 'git'
        ? await window.electronAPI.revertOptionFromGit({
            optionPath: change.optionPath,
            filePath: change.file,
            fallbackValue: change.oldValue != null ? String(change.oldValue) : undefined
          })
        : await window.electronAPI.setOptionValue({
            optionPath: change.optionPath,
            newValue: String(change.oldValue),
            filePath: change.file,
            allowCreate: false
          });
      if (!result?.success) {
        alert(result?.error || 'Failed to revert option');
        return;
      }
      window.dispatchEvent(new CustomEvent('history-updated'));
      window.dispatchEvent(new CustomEvent('pending-changes'));
      window.dispatchEvent(new CustomEvent('packages-changed'));
      await loadChanges();
    } catch (e) {
      alert(e.message || 'Failed to revert option');
    } finally {
      revertingOptionKey = null;
    }
  }

  function previewValue(value) {
    if (value == null) return 'not set';
    const text = String(value).trim();
    if (!text) return 'empty';
    const oneLine = text.replace(/\s+/g, ' ');
    return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
  }

  function isMultilineValue(value) {
    return typeof value === 'string' && value.includes('\n');
  }

  function getChangedLinePairs(oldValue, newValue, max = 12) {
    const oldLines = String(oldValue || '').split('\n');
    const newLines = String(newValue || '').split('\n');
    const pairs = [];
    const total = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < total; i++) {
      const from = oldLines[i] ?? '';
      const to = newLines[i] ?? '';
      if (from !== to) {
        pairs.push({ line: i + 1, from, to });
        if (pairs.length >= max) break;
      }
    }
    return { pairs, hidden: Math.max(0, total - pairs.length) };
  }

  async function loadChanges() {
    loading = true;
    try {
      data = await window.electronAPI.getPendingChanges();
    } catch (e) {
      console.error('Failed to load changes:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const handler = () => { refreshTrigger++; };
    window.addEventListener('pending-changes', handler);
    window.addEventListener('packages-changed', handler);
    return () => {
      window.removeEventListener('pending-changes', handler);
      window.removeEventListener('packages-changed', handler);
    };
  });

  $effect(() => {
    refreshTrigger;
    loadChanges();
  });
</script>

<div class="changes-page">
  <div class="page-header">
    <div class="header-top">
      <div>
        <h1>Changes</h1>
        <p class="subtitle">
          Pending configuration changes awaiting a system rebuild
        </p>
      </div>
      <button class="refresh-btn" onclick={loadChanges} disabled={loading}>
        {loading ? '...' : 'Refresh'}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <span>Checking for changes...</span>
    </div>
  {:else if !data}
    <div class="empty">
      <Icon name="AlertTriangle" size={32} />
      <p>Unable to load change status</p>
    </div>
  {:else if !data.hasDrift}
    <div class="empty">
      <div class="all-clear-icon">
        <Icon name="CheckCircle" size={32} />
      </div>
      <p>All changes applied</p>
      <p class="empty-hint">
        {#if data.lastRebuild}
          Last rebuild: {formatRelative(data.lastRebuild)}
        {/if}
      </p>
    </div>
  {:else}
    <div class="changes-content">
      <!-- Drift status card -->
      <div class="drift-card">
        <div class="drift-icon">
          <Icon name="AlertTriangle" size={20} />
        </div>
        <div class="drift-info">
          <h2>Unapplied changes detected</h2>
          <p>Your configuration files have been modified since the last system rebuild.</p>
        </div>
      </div>

      <!-- Timestamps -->
      <div class="timestamps">
        <div class="timestamp-item">
          <span class="ts-label">Last Rebuild</span>
          <span class="ts-value">{formatTime(data.lastRebuild)}</span>
          <span class="ts-relative">({formatRelative(data.lastRebuild)})</span>
        </div>
        <div class="timestamp-item">
          <span class="ts-label">Config Modified</span>
          <span class="ts-value">{formatTime(data.lastConfigChange)}</span>
          <span class="ts-relative">({formatRelative(data.lastConfigChange)})</span>
        </div>
      </div>

      <!-- Pending packages -->
      {#if data.pendingInstall.length > 0}
        <div class="section">
          <h3>
            <Icon name="Plus" size={14} />
            Pending to Install
          </h3>
          <div class="pkg-grid">
            {#each data.pendingInstall as pkg}
              <button class="pkg-chip add" onclick={() => openPackage(pkg)}>{pkg}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if data.pendingRemove.length > 0}
        <div class="section">
          <h3>
            <Icon name="Minus" size={14} />
            Pending to Remove
          </h3>
          <div class="pkg-grid">
            {#each data.pendingRemove as pkg}
              <button class="pkg-chip remove" onclick={() => openPackage(pkg, 'live')}>{pkg}</button>
            {/each}
          </div>
        </div>
      {/if}

      {#if data.pendingInstall.length === 0 && data.pendingRemove.length === 0}
        <div class="no-pkgs-hint">
          <p>No specific packages tracked. Changes may include manual edits to config files.</p>
        </div>
      {/if}

      {#if data.optionChanges && data.optionChanges.length > 0}
        <div class="section">
          <h3>
            <Icon name="SlidersHorizontal" size={14} />
            Pending Option Changes
          </h3>
          <div class="option-change-list">
            {#each data.optionChanges as change, idx}
              {@const rowKey = optionChangeKey(change, idx)}
              {@const isOpen = expandedOption === rowKey}
              <button class="option-change-row" onclick={() => expandedOption = isOpen ? null : rowKey}>
                <div class="option-main">
                  <span class="option-path">{change.optionPath}</span>
                  <span class="option-action">{summarizeOptionChange(change)}{change.edits > 1 ? ` (${change.edits} edits)` : ''}</span>
                  <span class="source-badge" class:git={change.source === 'git'} class:sqlite={change.source === 'sqlite'}>
                    {change.source === 'git' ? 'git' : 'app'}
                  </span>
                </div>
                <span class="option-expand">{isOpen ? '▾' : '▸'}</span>
              </button>
              {#if isOpen}
                <div class="option-change-detail">
                  <div class="change-col">
                    <span class="change-label">File</span>
                    <span class="change-inline">{change.file}</span>
                  </div>
                  {#if change.action === 'set' && change.oldValue != null}
                    <div class="option-actions">
                      <button class="revert-btn" onclick={() => revertOptionChange(change, idx)} disabled={revertingOptionKey === rowKey}>
                        <Icon name="ArrowDownToLine" size={12} />
                        {revertingOptionKey === rowKey ? 'Reverting...' : 'Revert to previous value'}
                      </button>
                    </div>
                  {/if}
                  <div class="change-col">
                    <span class="change-label old">Old value</span>
                    {#if isMultilineValue(change.oldValue)}
                      {@const d = getChangedLinePairs(change.oldValue, change.newValue)}
                      {#if d.pairs.length > 0}
                        <div class="line-diff-list">
                          {#each d.pairs as p}
                            <div class="line-diff-row old">
                              <span class="line-no">L{p.line}</span>
                              <code class="line-text">{p.from || '∅'}</code>
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <pre class="change-block old">{previewValue(change.oldValue)}</pre>
                      {/if}
                    {:else}
                      <span class="change-inline old">{previewValue(change.oldValue)}</span>
                    {/if}
                  </div>
                  <div class="change-col">
                    <span class="change-label new">New value</span>
                    {#if isMultilineValue(change.newValue)}
                      {@const d = getChangedLinePairs(change.oldValue, change.newValue)}
                      {#if d.pairs.length > 0}
                        <div class="line-diff-list">
                          {#each d.pairs as p}
                            <div class="line-diff-row new">
                              <span class="line-no">L{p.line}</span>
                              <code class="line-text">{p.to || '∅'}</code>
                            </div>
                          {/each}
                        </div>
                        {#if d.hidden > 0}
                          <span class="line-diff-more">+ {d.hidden} unchanged lines hidden</span>
                        {/if}
                      {:else}
                        <pre class="change-block new">{previewValue(change.newValue)}</pre>
                      {/if}
                    {:else}
                      <span class="change-inline new">{previewValue(change.newValue)}</span>
                    {/if}
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      {#if data.optionDiffSummary && (data.optionDiffSummary.added.length > 0 || data.optionDiffSummary.removed.length > 0 || data.optionDiffSummary.changed.length > 0)}
        <div class="section">
          <h3>
            <Icon name="History" size={14} />
            Option Diffs (Git)
          </h3>
          <div class="diff-summary-grid">
            <span class="diff-pill add">+ {data.optionDiffSummary.added.length} added</span>
            <span class="diff-pill remove">- {data.optionDiffSummary.removed.length} removed</span>
            <span class="diff-pill change">~ {data.optionDiffSummary.changed.length} changed</span>
          </div>
        </div>
      {/if}

      {#if data.changedFiles && data.changedFiles.length > 0}
        <div class="section">
          <h3>
            <Icon name="FileText" size={14} />
            Modified Nix Files
          </h3>
          <div class="changed-files">
            {#each data.changedFiles as file}
              <span class="file-chip">{file}</span>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .changes-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 24px;
    overflow: hidden;
  }

  .page-header {
    margin-bottom: 16px;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
  }

  .page-header h1 {
    font-size: 24px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0 0 4px 0;
  }

  .subtitle {
    font-size: 14px;
    color: #6c7086;
    margin: 0;
  }

  .refresh-btn {
    flex-shrink: 0;
    padding: 8px 16px;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 8px;
    color: #cdd6f4;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: rgba(49, 50, 68, 0.8);
    border-color: rgba(137, 180, 250, 0.3);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #6c7086;
    font-size: 14px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #6c7086;
  }

  .empty p {
    margin: 0;
    font-size: 15px;
  }

  .empty-hint {
    font-size: 13px !important;
    color: #585b70;
  }

  .all-clear-icon {
    color: #a6e3a1;
    margin-bottom: 4px;
  }

  .changes-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-right: 8px;
  }

  .changes-content::-webkit-scrollbar {
    width: 8px;
  }
  .changes-content::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }
  .changes-content::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }
  .changes-content::-webkit-scrollbar-thumb:hover {
    background: rgba(88, 91, 112, 0.8);
  }

  .drift-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    background: rgba(249, 226, 175, 0.05);
    border: 1px solid rgba(249, 226, 175, 0.2);
    border-radius: 10px;
  }

  .drift-icon {
    color: #f9e2af;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .drift-info {
    flex: 1;
  }

  .drift-info h2 {
    font-size: 15px;
    font-weight: 600;
    color: #f9e2af;
    margin: 0 0 4px 0;
  }

  .drift-info p {
    font-size: 13px;
    color: #a6adc8;
    margin: 0;
  }

  .drift-actions {
    flex-shrink: 0;
  }

  .rebuild-btn {
    padding: 8px 16px;
    background: rgba(249, 226, 175, 0.1);
    border: 1px solid rgba(249, 226, 175, 0.3);
    border-radius: 8px;
    color: #f9e2af;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .rebuild-btn:hover {
    background: rgba(249, 226, 175, 0.2);
    border-color: rgba(249, 226, 175, 0.5);
  }

  .timestamps {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .timestamp-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 16px;
    background: rgba(49, 50, 68, 0.3);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 8px;
  }

  .ts-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6c7086;
  }

  .ts-value {
    font-size: 13px;
    color: #cdd6f4;
    font-weight: 500;
  }

  .ts-relative {
    font-size: 12px;
    color: #585b70;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: #a6adc8;
    margin: 0;
  }

  .pkg-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .pkg-chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    cursor: pointer;
    transition: all 0.15s;
  }

  .pkg-chip.add:hover {
    background: rgba(166, 227, 161, 0.2);
    border-color: rgba(166, 227, 161, 0.5);
  }

  .pkg-chip.remove:hover {
    background: rgba(243, 139, 168, 0.2);
    border-color: rgba(243, 139, 168, 0.5);
  }

  .pkg-chip.add {
    background: rgba(166, 227, 161, 0.1);
    border: 1px solid rgba(166, 227, 161, 0.25);
    color: #a6e3a1;
  }

  .pkg-chip.remove {
    background: rgba(243, 139, 168, 0.1);
    border: 1px solid rgba(243, 139, 168, 0.25);
    color: #f38ba8;
  }

  .no-pkgs-hint {
    padding: 16px;
    background: rgba(49, 50, 68, 0.2);
    border: 1px solid rgba(69, 71, 90, 0.2);
    border-radius: 8px;
  }

  .no-pkgs-hint p {
    font-size: 13px;
    color: #6c7086;
    margin: 0;
  }

  .option-change-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option-change-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    background: rgba(49, 50, 68, 0.25);
    border: 1px solid rgba(69, 71, 90, 0.25);
    border-radius: 6px;
    width: 100%;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }

  .option-change-row:hover {
    background: rgba(49, 50, 68, 0.4);
    border-color: rgba(137, 180, 250, 0.25);
  }

  .option-main {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .option-path {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
    color: #cdd6f4;
  }

  .option-action {
    font-size: 11px;
    color: #89b4fa;
    background: rgba(137, 180, 250, 0.12);
    border: 1px solid rgba(137, 180, 250, 0.22);
    padding: 1px 6px;
    border-radius: 10px;
    white-space: nowrap;
  }

  .source-badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 8px;
    border: 1px solid rgba(166, 173, 200, 0.35);
    color: #a6adc8;
    background: rgba(166, 173, 200, 0.1);
    white-space: nowrap;
  }

  .source-badge.git {
    color: #89b4fa;
    border-color: rgba(137, 180, 250, 0.35);
    background: rgba(137, 180, 250, 0.1);
  }

  .source-badge.sqlite {
    color: #cba6f7;
    border-color: rgba(203, 166, 247, 0.35);
    background: rgba(203, 166, 247, 0.1);
  }

  .option-file {
    font-size: 11px;
    color: #6c7086;
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  .option-expand {
    color: #6c7086;
    font-size: 12px;
  }

  .option-change-detail {
    margin-top: 4px;
    margin-bottom: 6px;
    margin-left: 8px;
    border-left: 2px solid rgba(137, 180, 250, 0.2);
    padding-left: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .change-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .change-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #a6adc8;
  }

  .change-label.old { color: #f9e2af; }
  .change-label.new { color: #a6e3a1; }

  .change-inline {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
    line-height: 1.4;
  }

  .change-inline.old { color: #f9e2af; }
  .change-inline.new { color: #a6e3a1; }

  .change-block {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 11px;
    line-height: 1.45;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid rgba(69, 71, 90, 0.35);
    background: rgba(30, 30, 46, 0.65);
    max-height: 180px;
    overflow: auto;
  }

  .change-block.old {
    color: #f9e2af;
    border-color: rgba(249, 226, 175, 0.25);
  }

  .change-block.new {
    color: #a6e3a1;
    border-color: rgba(166, 227, 161, 0.25);
  }

  .changed-files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .file-chip {
    display: inline-flex;
    padding: 3px 8px;
    background: rgba(166, 173, 200, 0.08);
    border: 1px solid rgba(166, 173, 200, 0.2);
    color: #a6adc8;
    border-radius: 6px;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 11px;
  }

  .diff-summary-grid {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .diff-pill {
    display: inline-flex;
    align-items: center;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid transparent;
  }

  .diff-pill.add {
    color: #a6e3a1;
    background: rgba(166, 227, 161, 0.1);
    border-color: rgba(166, 227, 161, 0.3);
  }

  .diff-pill.remove {
    color: #f38ba8;
    background: rgba(243, 139, 168, 0.1);
    border-color: rgba(243, 139, 168, 0.3);
  }

  .diff-pill.change {
    color: #89b4fa;
    background: rgba(137, 180, 250, 0.1);
    border-color: rgba(137, 180, 250, 0.3);
  }

  .line-diff-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .line-diff-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid rgba(69, 71, 90, 0.35);
    background: rgba(30, 30, 46, 0.6);
  }

  .line-diff-row.old {
    border-color: rgba(249, 226, 175, 0.25);
    background: rgba(249, 226, 175, 0.06);
  }

  .line-diff-row.new {
    border-color: rgba(166, 227, 161, 0.25);
    background: rgba(166, 227, 161, 0.06);
  }

  .line-no {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 10px;
    color: #6c7086;
    min-width: 34px;
    padding-top: 1px;
  }

  .line-text {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    color: #cdd6f4;
    flex: 1;
  }

  .line-diff-more {
    font-size: 11px;
    color: #6c7086;
    margin-top: 3px;
  }

  .option-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .revert-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid rgba(137, 180, 250, 0.35);
    background: rgba(137, 180, 250, 0.12);
    color: #89b4fa;
    font-size: 12px;
    cursor: pointer;
  }

  .revert-btn:hover:not(:disabled) {
    background: rgba(137, 180, 250, 0.2);
  }

  .revert-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
