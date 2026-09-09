<script>
  import Icon from "./Icon.svelte";

  let entries = $state([]);
  let loading = $state(true);
  let selectedId = $state(null);
  let refreshTrigger = $state(0);
  let searchQuery = $state('');
  let typeFilter = $state('all');
  let lastSearchQuery = $state('');

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

  function isSubsequence(text, query) {
    if (!text || !query) return false;
    let pos = 0;
    for (const ch of query) {
      pos = text.indexOf(ch, pos);
      if (pos === -1) return false;
      pos += 1;
    }
    return true;
  }

  function entryMatches(entry, q) {
    if (!q) return true;
    const subject = String(entry.subject || '').toLowerCase();
    const type = String(entry.entry_type || '').toLowerCase();
    const action = String(entry.action || '').toLowerCase();
    const file = String(entry.file || '').toLowerCase();
    const oldValue = String(entry.old_value || '').toLowerCase();
    const newValue = String(entry.new_value || '').toLowerCase();

    if (subject.includes(q) || type.includes(q) || action.includes(q) || file.includes(q)) return true;
    if (oldValue.includes(q) || newValue.includes(q)) return true;
    return isSubsequence(subject, q);
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

  let filteredEntries = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter(entry => {
      const entryType = String(entry.entry_type || '').toLowerCase();
      if (typeFilter !== 'all' && entryType !== typeFilter) return false;
      return entryMatches(entry, q);
    });
  });

  let searchCounts = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    let all = 0;
    let packages = 0;
    let options = 0;
    for (const entry of entries) {
      if (!entryMatches(entry, q)) continue;
      all += 1;
      if (entry.entry_type === 'package') packages += 1;
      if (entry.entry_type === 'option') options += 1;
    }
    return { all, packages, options };
  });

  $effect(() => {
    const q = searchQuery.trim();
    if (!q) {
      if (lastSearchQuery) {
        typeFilter = 'all';
      }
      lastSearchQuery = '';
      return;
    }
    lastSearchQuery = q;
    if (typeFilter === 'all') return;

    if (typeFilter === 'package' && searchCounts.packages === 0 && searchCounts.options > 0) {
      typeFilter = 'option';
    } else if (typeFilter === 'option' && searchCounts.options === 0 && searchCounts.packages > 0) {
      typeFilter = 'package';
    }
  });

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
          Package and option changes made to your NixOS configuration
        </p>
      </div>
      <button class="refresh-btn" onclick={loadHistory} disabled={loading}>
        {loading ? '...' : 'Refresh'}
      </button>
    </div>
  </div>

  <div class="search-bar">
    <span class="search-icon"><Icon name="Search" size={15} /></span>
    <input
      type="text"
      placeholder="Search history..."
      bind:value={searchQuery}
    />
    {#if searchQuery}
      <button class="clear-btn" onclick={() => searchQuery = ''}>×</button>
    {/if}
  </div>

  <div class="type-filters">
    <button class="type-chip" class:active={typeFilter === 'all'} onclick={() => typeFilter = 'all'}>
      All
      {#if searchQuery.trim()}
        <span class="count">{searchCounts.all}</span>
      {/if}
    </button>
    {#if !searchQuery.trim() || searchCounts.packages > 0}
      <button class="type-chip" class:active={typeFilter === 'package'} onclick={() => typeFilter = 'package'}>
        Packages
        {#if searchQuery.trim()}
          <span class="count">{searchCounts.packages}</span>
        {/if}
      </button>
    {/if}
    {#if !searchQuery.trim() || searchCounts.options > 0}
      <button class="type-chip" class:active={typeFilter === 'option'} onclick={() => typeFilter = 'option'}>
        Options
        {#if searchQuery.trim()}
          <span class="count">{searchCounts.options}</span>
        {/if}
      </button>
    {/if}
  </div>

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <span>Loading history...</span>
    </div>
   {:else if filteredEntries.length === 0}
    <div class="empty">
      <Icon name="ScrollText" size={32} />
      <p>{searchQuery ? 'No matching history entries' : 'No changes recorded yet'}</p>
      <p class="empty-hint">{searchQuery ? 'Try a broader filter' : 'Add or remove packages from the Discover page to see them here'}</p>
    </div>
  {:else}
    <div class="history-list">
      {#each filteredEntries as entry, i}
        {@const isSelected = selectedId === i}
        <div class="entry-wrapper">
          <button
            class="entry-item"
            class:selected={isSelected}
            class:added={entry.action === 'added'}
            class:removed={entry.action === 'removed'}
            class:reverted={entry.action === 'reverted'}
            class:option={entry.entry_type === 'option'}
            onclick={() => selectEntry(i)}
          >
            <div class="entry-indicator"></div>
            <div class="entry-main">
              <span class="entry-pkg">{entry.subject}</span>
              <span class="entry-action">
                {#if entry.entry_type === 'option'}
                  {entry.action}
                {:else}
                  {entry.action === 'added' ? 'added' : 'removed'}
                {/if}
              </span>
              <span class="entry-kind" class:option={entry.entry_type === 'option'}>
                {entry.entry_type === 'option' ? 'option' : 'package'}
              </span>
            </div>
            <span class="entry-time">{formatTime(entry.timestamp)}</span>
            <span class="entry-expand">{isSelected ? '▾' : '›'}</span>
          </button>

          {#if isSelected}
            <div class="entry-detail">
              <div class="detail-row">
                <span class="detail-label">Action</span>
                <span class="detail-value" class:added={entry.action === 'added'} class:removed={entry.action === 'removed'}>
                  {#if entry.entry_type === 'option'}
                    Option {entry.action}
                  {:else}
                    {entry.action === 'added' ? 'Package added' : 'Package removed'}
                  {/if}
                </span>
              </div>
              {#if entry.entry_type === 'option'}
                <div class="detail-row">
                  <span class="detail-label">Old</span>
                  {#if isMultilineValue(entry.old_value) || isMultilineValue(entry.new_value)}
                    {@const d = getChangedLinePairs(entry.old_value, entry.new_value)}
                    <div class="line-diff-group">
                      <div class="line-diff-list">
                        {#each d.pairs as p}
                          <div class="line-diff-row old">
                            <span class="line-no">L{p.line}</span>
                            <code class="line-text">{p.from || '∅'}</code>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {:else}
                    <div class="value-bubble old">
                      <code class="value-bubble-text old-value">{previewValue(entry.old_value)}</code>
                    </div>
                  {/if}
                </div>
                <div class="detail-row">
                  <span class="detail-label">New</span>
                  {#if isMultilineValue(entry.old_value) || isMultilineValue(entry.new_value)}
                    {@const d = getChangedLinePairs(entry.old_value, entry.new_value)}
                    <div class="line-diff-group">
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
                    </div>
                  {:else}
                    <div class="value-bubble new">
                      <code class="value-bubble-text new-value">{previewValue(entry.new_value)}</code>
                    </div>
                  {/if}
                </div>
              {/if}
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

  .search-bar {
    display: flex;
    align-items: center;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 12px;
    padding: 0 14px;
    margin-bottom: 12px;
  }

  .search-icon {
    margin-right: 10px;
    opacity: 0.65;
    display: flex;
    align-items: center;
  }

  .search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #cdd6f4;
    font-size: 13px;
    padding: 10px 0;
  }

  .search-bar input::placeholder {
    color: #6c7086;
  }

  .clear-btn {
    background: rgba(243, 139, 168, 0.2);
    border: none;
    color: #f38ba8;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 15px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .clear-btn:hover {
    background: rgba(243, 139, 168, 0.32);
  }

  .type-filters {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    align-items: center;
  }

  .type-chip {
    background: rgba(49, 50, 68, 0.4);
    border: 1px solid rgba(69, 71, 90, 0.3);
    color: #a6adc8;
    font-size: 13px;
    font-weight: 500;
    padding: 10px 16px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .type-chip:hover {
    background: rgba(49, 50, 68, 0.6);
    color: #cdd6f4;
  }

  .type-chip.active {
    background: linear-gradient(135deg, rgba(137, 180, 250, 0.2) 0%, rgba(180, 190, 254, 0.2) 100%);
    border-color: rgba(137, 180, 250, 0.4);
    color: #89b4fa;
  }

  .count {
    background: rgba(0, 0, 0, 0.2);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .type-chip.active .count {
    background: rgba(137, 180, 250, 0.2);
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

  .entry-item.reverted {
    border-left: 3px solid #89b4fa;
  }

  .entry-item.option {
    border-left: 3px solid #cba6f7;
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

  .entry-item.reverted .entry-indicator {
    background: #89b4fa;
  }

  .entry-item.option .entry-indicator {
    background: #cba6f7;
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

  .entry-kind {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(137, 180, 250, 0.12);
    color: #89b4fa;
  }

  .entry-kind.option {
    background: rgba(203, 166, 247, 0.14);
    color: #cba6f7;
  }

  .entry-item.added .entry-action {
    background: rgba(166, 227, 161, 0.15);
    color: #a6e3a1;
  }

  .entry-item.removed .entry-action {
    background: rgba(243, 139, 168, 0.15);
    color: #f38ba8;
  }

  .entry-item.reverted .entry-action {
    background: rgba(137, 180, 250, 0.15);
    color: #89b4fa;
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

  .detail-value.old-value {
    color: #f9e2af;
  }

  .detail-value.new-value {
    color: #a6e3a1;
  }

  .value-bubble {
    display: flex;
    align-items: center;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid rgba(69, 71, 90, 0.35);
    background: rgba(30, 30, 46, 0.6);
    width: 100%;
  }

  .value-bubble.old {
    border-color: rgba(249, 226, 175, 0.25);
    background: rgba(249, 226, 175, 0.06);
  }

  .value-bubble.new {
    border-color: rgba(166, 227, 161, 0.25);
    background: rgba(166, 227, 161, 0.06);
  }

  .value-bubble-text {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .line-diff-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .line-diff-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
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
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 10px;
    color: #6c7086;
    min-width: 34px;
    padding-top: 1px;
  }

  .line-text {
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    color: #cdd6f4;
    flex: 1;
  }

  .line-diff-more {
    font-size: 11px;
    color: #6c7086;
  }
</style>
