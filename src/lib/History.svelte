<script>
  import Icon from "./Icon.svelte";

  let entries = $state([]);
  let loading = $state(true);
  let selectedId = $state(null);
  let refreshTrigger = $state(0);

  function formatTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  function formatFullDate(ts) {
    return new Date(ts).toLocaleString();
  }

  function formatFile(file) {
    return file.replace(/^.*[/]/, '…/');
  }

  function selectEntry(id) {
    selectedId = selectedId === id ? null : id;
  }

  async function loadHistory() {
    loading = true;
    try {
      const result = await window.electronAPI.historyGet();
      if (result.success) {
        entries = result.entries;
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const handler = () => { refreshTrigger++; };
    window.addEventListener('history-updated', handler);
    return () => window.removeEventListener('history-updated', handler);
  });

  $effect(() => {
    refreshTrigger;
    loadHistory();
  });
</script>

<div class="history-page">
  <div class="page-header">
    <div class="header-top">
      <div>
        <h1>Change History</h1>
        <p class="subtitle">
          Package additions and removals made to your NixOS configuration
        </p>
      </div>
      <button class="refresh-btn" onclick={loadHistory} disabled={loading}>
        {loading ? '...' : 'Refresh'}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading history...</span>
    </div>
  {:else if entries.length === 0}
    <div class="empty">
      <Icon name="ScrollText" size={32} />
      <p>No changes recorded yet</p>
      <p class="empty-hint">Add or remove packages from the Discover page to see them here</p>
    </div>
  {:else}
    <div class="history-list">
      {#each entries as entry, i}
        {@const isSelected = selectedId === i}
        <div class="entry-wrapper">
          <button
            class="entry-item"
            class:selected={isSelected}
            class:added={entry.action === 'added'}
            class:removed={entry.action === 'removed'}
            onclick={() => selectEntry(i)}
          >
            <div class="entry-indicator"></div>
            <div class="entry-main">
              <span class="entry-pkg">{entry.pkgname}</span>
              <span class="entry-action">{entry.action === 'added' ? 'added' : 'removed'}</span>
            </div>
            <span class="entry-time">{formatTime(entry.timestamp)}</span>
            <span class="entry-expand">{isSelected ? '▾' : '›'}</span>
          </button>

          {#if isSelected}
            <div class="entry-detail">
              <div class="detail-row">
                <span class="detail-label">Action</span>
                <span class="detail-value" class:added={entry.action === 'added'} class:removed={entry.action === 'removed'}>
                  {entry.action === 'added' ? 'Package added' : 'Package removed'}
                </span>
              </div>
              <div class="detail-row">
                <span class="detail-label">File</span>
                <span class="detail-value mono">{entry.file}</span>
              </div>
              {#if entry.type}
                <div class="detail-row">
                  <span class="detail-label">Type</span>
                  <span class="detail-value">
                    {entry.type === 'system' ? 'System' : entry.type === 'homeManager' ? 'Home Manager' : `User (${entry.user_name})`}
                  </span>
                </div>
              {/if}
              <div class="detail-row">
                <span class="detail-label">Time</span>
                <span class="detail-value">{formatFullDate(entry.timestamp)}</span>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .history-page {
    flex: 1;
    display: flex;
    flex-direction: column;
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
    align-items: center;
    justify-content: center;
    gap: 10px;
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

  .history-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-right: 8px;
  }

  .history-list::-webkit-scrollbar {
    width: 8px;
  }
  .history-list::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }
  .history-list::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }
  .history-list::-webkit-scrollbar-thumb:hover {
    background: rgba(88, 91, 112, 0.8);
  }

  .entry-wrapper {
    display: flex;
    flex-direction: column;
  }

  .entry-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    background: rgba(49, 50, 68, 0.3);
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font-family: inherit;
    transition: all 0.15s;
  }

  .entry-item:hover {
    background: rgba(49, 50, 68, 0.5);
  }

  .entry-item.selected {
    background: rgba(137, 180, 250, 0.1);
    border-color: rgba(137, 180, 250, 0.25);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .entry-item.added {
    border-left: 3px solid #a6e3a1;
  }

  .entry-item.removed {
    border-left: 3px solid #f38ba8;
  }

  .entry-indicator {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .entry-item.added .entry-indicator {
    background: #a6e3a1;
  }

  .entry-item.removed .entry-indicator {
    background: #f38ba8;
  }

  .entry-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .entry-pkg {
    font-size: 13px;
    font-weight: 500;
    color: #cdd6f4;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-action {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .entry-item.added .entry-action {
    background: rgba(166, 227, 161, 0.15);
    color: #a6e3a1;
  }

  .entry-item.removed .entry-action {
    background: rgba(243, 139, 168, 0.15);
    color: #f38ba8;
  }

  .entry-time {
    font-size: 11px;
    color: #6c7086;
    flex-shrink: 0;
  }

  .entry-expand {
    font-size: 14px;
    color: #6c7086;
    flex-shrink: 0;
    transition: transform 0.2s;
  }

  .entry-item.selected .entry-expand {
    color: #89b4fa;
  }

  .entry-detail {
    padding: 10px 14px 12px 31px;
    background: rgba(30, 30, 46, 0.4);
    border: 1px solid transparent;
    border-top: none;
    border-radius: 0 0 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: slideDown 0.15s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .detail-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .detail-label {
    font-size: 11px;
    color: #6c7086;
    min-width: 50px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;
  }

  .detail-value {
    font-size: 12px;
    color: #cdd6f4;
    word-break: break-all;
  }

  .detail-value.mono {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: #a6adc8;
  }

  .detail-value.added {
    color: #a6e3a1;
  }

  .detail-value.removed {
    color: #f38ba8;
  }
</style>
