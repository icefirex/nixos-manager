<script>
  import Icon from "./Icon.svelte";

  let data = $state(null);
  let loading = $state(true);
  let refreshTrigger = $state(0);

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
</style>
