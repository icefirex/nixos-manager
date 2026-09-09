<script>
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import hljs from 'highlight.js/lib/core';
  import nix from 'highlight.js/lib/languages/nix';

  hljs.registerLanguage('nix', nix);

  let options = $state({
    services: [],
    programs: [],
    hardware: [],
    networking: [],
    boot: [],
    system: [],
    other: []
  });
  let loading = $state(true);
  let error = $state(null);
  let searchQuery = $state("");
  let activeTab = $state("services");
  let sourceMode = $state("config"); // "config" or "live"
  let savingOption = $state(false);
  let editingOptionKey = $state(null);
  let editDraftValue = $state("");
  let catalogSearching = $state(false);
  let catalogSearched = $state("");
  let catalogResults = $state([]);
  let catalogError = $state(null);

  // Option detail state
  let selectedOption = $state(null);
  let optionInfo = $state(null);
  let loadingInfo = $state(false);

  const tabs = [
    { id: "services", label: "Services" },
    { id: "programs", label: "Programs" },
    { id: "hardware", label: "Hardware" },
    { id: "networking", label: "Networking" },
    { id: "boot", label: "Boot" },
    { id: "system", label: "System" },
    { id: "other", label: "Other" }
  ];

  // Derived filtered options for each category - ensures reactivity
  let filteredByCategory = $derived.by(() => {
    const result = {};
    const q = searchQuery.trim().toLowerCase();
    for (const tab of tabs) {
      const list = options[tab.id] || [];
      if (!q) {
        result[tab.id] = list;
      } else {
        result[tab.id] = list.filter(opt =>
          opt.path.toLowerCase().includes(q) ||
          (opt.value && opt.value.toLowerCase().includes(q))
        );
      }
    }
    return result;
  });

  // Determine the best active tab (auto-switch if current becomes empty)
  let effectiveTab = $derived.by(() => {
    if (!searchQuery.trim()) return activeTab;

    // If current tab has results, stay there
    if (filteredByCategory[activeTab]?.length > 0) return activeTab;

    // Find first tab with results
    for (const tab of tabs) {
      if (filteredByCategory[tab.id]?.length > 0) return tab.id;
    }

    return activeTab;
  });

  async function loadOptions() {
    loading = true;
    error = null;
    selectedOption = null;
    optionInfo = null;
    try {
      if (sourceMode === "live") {
        options = await window.electronAPI.getLiveOptions();
      } else {
        options = await window.electronAPI.getOptions();
      }
    } catch (e) {
      error = e.message;
      console.error("Failed to load options:", e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadOptions();
  });

  function switchSource(mode) {
    if (mode !== sourceMode) {
      sourceMode = mode;
      loadOptions();
    }
  }

  async function selectOption(opt) {
    const optKey = `${opt.path}:${opt.file || opt.source}`;
    if (selectedOption === optKey) {
      selectedOption = null;
      optionInfo = null;
      return;
    }

    selectedOption = optKey;
    optionInfo = null;
    loadingInfo = true;

    await tick();

    try {
      const [info] = await Promise.all([
        window.electronAPI.getOptionInfo(opt.path),
        new Promise(resolve => setTimeout(resolve, 400))
      ]);
      if (selectedOption === optKey) {
        optionInfo = { ...info, currentValue: opt.value, currentFile: opt.file, currentLine: opt.line };
      }
    } catch (e) {
      console.error("Failed to load option info:", e);
      if (selectedOption === optKey) {
        optionInfo = { path: opt.path, error: e.message };
      }
    } finally {
      loadingInfo = false;
    }
  }

  function openUrl(url) {
    if (url) {
      window.open(url, '_blank');
    }
  }

  function getTabCount(tab) {
    return options[tab]?.length || 0;
  }

  function getFilteredCount(tab) {
    return filteredByCategory[tab]?.length || 0;
  }

  function getTotalFilteredCount() {
    let total = 0;
    for (const tab of tabs) {
      total += filteredByCategory[tab.id]?.length || 0;
    }
    return total;
  }

  function formatValue(value) {
    if (!value) return '';
    if (value.length > 60) return value.substring(0, 57) + '...';
    return value;
  }

  function stripHtml(value) {
    if (!value) return '';
    return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parseBoolValue(value) {
    const v = normalizeValue(value).toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  }

  function normalizeValue(value) {
    if (!value) return '';
    return String(value).trim().replace(/;$/, '').trim();
  }

  function isBooleanOption() {
    if (!optionInfo) return false;
    const t = (optionInfo.type || '').toLowerCase();
    if (t.includes('bool')) return true;
    return parseBoolValue(optionInfo.currentValue) !== null;
  }

  function canInlineEdit() {
    return !!optionInfo && sourceMode === 'config' && !savingOption;
  }

  function startInlineEdit() {
    if (!optionInfo) return;
    editingOptionKey = optionInfo.path;
    editDraftValue = isBlockValue(optionInfo.currentValue)
      ? String(optionInfo.currentValue || '')
      : normalizeValue(optionInfo.currentValue);
  }

  function cancelInlineEdit() {
    editingOptionKey = null;
    editDraftValue = '';
  }

  async function saveOptionValue(optionPath, newValue, filePath = null) {
    savingOption = true;
    try {
      const result = await window.electronAPI.setOptionValue({
        optionPath,
        newValue,
        filePath: filePath || undefined,
        preferredFile: filePath || undefined
      });
      if (!result.success) {
        alert(result.error || 'Failed to save option value');
        return false;
      }
      window.dispatchEvent(new CustomEvent('history-updated'));
      window.dispatchEvent(new CustomEvent('pending-changes'));
      window.dispatchEvent(new CustomEvent('packages-changed'));
      await loadOptions();
      return true;
    } catch (e) {
      alert(e.message || 'Failed to save option value');
      return false;
    } finally {
      savingOption = false;
    }
  }

  async function saveInlineEdit() {
    if (!optionInfo) return;
    const value = isBlockValue(optionInfo.currentValue)
      ? String(editDraftValue || '').trim()
      : normalizeValue(editDraftValue);
    if (!value) {
      alert('Value cannot be empty');
      return;
    }
    const ok = await saveOptionValue(optionInfo.path, value, optionInfo.currentFile || null);
    if (ok) {
      editingOptionKey = null;
      editDraftValue = '';
      await selectOption({
        path: optionInfo.path,
        file: optionInfo.currentFile || optionInfo.configLocations?.[0] || '',
        line: optionInfo.currentLine,
        value
      });
    }
  }

  async function toggleBooleanOption() {
    if (!optionInfo) return;
    const current = parseBoolValue(optionInfo.currentValue);
    if (current === null) return;
    const nextValue = current ? 'false' : 'true';
    const ok = await saveOptionValue(optionInfo.path, nextValue, optionInfo.currentFile || null);
    if (ok) {
      await selectOption({
        path: optionInfo.path,
        file: optionInfo.currentFile || optionInfo.configLocations?.[0] || '',
        line: optionInfo.currentLine,
        value: nextValue
      });
    }
  }

  function getSuggestedValue(result) {
    const type = (result?.type || '').toLowerCase();
    if (type.includes('bool')) return 'true';
    if (result?.example) return normalizeValue(stripHtml(result.example));
    if (result?.default) return normalizeValue(stripHtml(result.default));
    return 'null';
  }

  async function runCatalogSearch() {
    const q = searchQuery.trim();
    if (!q || sourceMode !== 'config') return;
    catalogSearching = true;
    catalogError = null;
    catalogSearched = q;
    catalogResults = [];
    try {
      const result = await window.electronAPI.searchOptionsCatalog(q, { limit: 25, channel: 'unstable' });
      if (!result.success) {
        catalogError = result.error || 'Search failed';
        return;
      }
      catalogResults = result.results || [];
    } catch (e) {
      catalogError = e.message || 'Search failed';
    } finally {
      catalogSearching = false;
    }
  }

  async function addOptionFromCatalog(result) {
    if (!result?.path) return;
    const value = getSuggestedValue(result);
    const ok = await saveOptionValue(result.path, value, null);
    if (ok) {
      searchQuery = result.path;
      catalogResults = [];
      catalogSearched = '';
    }
  }

  function isBlockValue(value) {
    if (!value) return false;
    // Any structured value (blocks, lists) or multi-line content
    if (value.startsWith('{') || value.startsWith('[') || value.includes('\n')) return true;
    return false;
  }

  function getOptionKey(opt) {
    return `${opt.path}:${opt.file || opt.source}`;
  }

  // Nix syntax highlighting using highlight.js
  function highlightNix(code) {
    if (!code) return '';
    try {
      return hljs.highlight(code, { language: 'nix' }).value;
    } catch {
      // Fallback to escaped plain text
      return code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }

</script>

<div class="options-page">
  <div class="page-header">
    <div class="header-top">
      <div>
        <h1>NixOS Options</h1>
        <p class="subtitle">
          {#if sourceMode === "config"}
            Options defined in your NixOS configuration files
          {:else}
            Options active on your running system
          {/if}
        </p>
      </div>
      <div class="source-toggle">
        <button
          class="source-btn"
          class:active={sourceMode === "config"}
          onclick={() => switchSource("config")}
        >
          <span class="source-icon"><Icon name="FileText" size={14} /></span>
          Config Files
        </button>
        <button
          class="source-btn"
          class:active={sourceMode === "live"}
          onclick={() => switchSource("live")}
        >
          <span class="source-icon"><Icon name="Zap" size={14} /></span>
          Live System
        </button>
      </div>
    </div>
  </div>

  <div class="search-bar">
    <span class="search-icon"><Icon name="Search" size={16} /></span>
    <input
      type="text"
      placeholder="Search options..."
      bind:value={searchQuery}
    />
    {#if searchQuery}
      <button class="clear-btn" onclick={() => searchQuery = ""}>×</button>
    {/if}
  </div>

  <div class="tabs">
    {#each tabs as tab}
      {@const total = getTabCount(tab.id)}
      {@const filtered = getFilteredCount(tab.id)}
      {#if total > 0}
        {#if !searchQuery.trim() || filtered > 0}
          <button
            class="tab"
            class:active={effectiveTab === tab.id}
            class:dimmed={searchQuery.trim() && filtered === 0}
            onclick={() => activeTab = tab.id}
          >
            {tab.label}
            <span class="count" class:filtered={searchQuery.trim() && filtered !== total}>
              {searchQuery.trim() ? filtered : total}
            </span>
          </button>
        {/if}
      {/if}
    {/each}
    <button class="refresh-btn" onclick={loadOptions} disabled={loading}>
      {#if loading}<Icon name="Loader" size={14} />{:else}<Icon name="RefreshCw" size={14} />{/if}
    </button>
  </div>

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Scanning configuration...</p>
    </div>
  {:else if error}
    <div class="error">
      <span class="error-icon"><Icon name="AlertTriangle" size={32} /></span>
      <p>{error}</p>
      <button onclick={loadOptions}>Retry</button>
    </div>
  {:else}
    <div class="options-content">
      <div class="section-header">
        <h2>{tabs.find(t => t.id === effectiveTab)?.label || effectiveTab}</h2>
        <span class="info">
          {#if searchQuery.trim()}
            {getFilteredCount(effectiveTab)} of {getTabCount(effectiveTab)} options
          {:else}
            {getTabCount(effectiveTab)} options
          {/if}
        </span>
      </div>
      <div class="option-list">
        {#each filteredByCategory[effectiveTab] || [] as opt (getOptionKey(opt))}
          <div class="option-item-wrapper">
            <button
              class="option-item"
              class:selected={selectedOption === getOptionKey(opt)}
              onclick={() => selectOption(opt)}
            >
              <div class="option-main">
                <span class="option-path">{opt.path}</span>
                <span class="option-value">{formatValue(opt.value)}</span>
              </div>
              <div class="option-meta">
                {#if opt.file}
                  <span class="option-file">{opt.file}:{opt.line}</span>
                {:else if opt.source}
                  <span class="option-source">{opt.source}</span>
                {/if}
                <span class="expand-icon">{#if selectedOption === getOptionKey(opt)}<Icon name="ChevronDown" size={14} />{:else}<Icon name="ChevronRight" size={14} />{/if}</span>
              </div>
            </button>
            {#if selectedOption === getOptionKey(opt)}
              <div class="option-detail">
                {@render optionDetailPanel()}
              </div>
            {/if}
          </div>
        {:else}
          <div class="empty">
            {searchQuery ? "No matching options" : "No options found in this category"}
          </div>
        {/each}
      </div>
    </div>

    {#if searchQuery.trim()}
      {@const totalMatches = getTotalFilteredCount()}
      <div class="search-results-info">
        {totalMatches} matching option{totalMatches !== 1 ? 's' : ''} across all categories
      </div>

      {#if sourceMode === 'config' && totalMatches === 0}
        <div class="catalog-search-box">
          <div class="catalog-search-header">
            <span>Option not found in current config or live scan.</span>
            <button class="catalog-search-btn" onclick={runCatalogSearch} disabled={catalogSearching}>
              <Icon name="Search" size={12} /> {catalogSearching ? 'Searching...' : 'Search NixOS options'}
            </button>
          </div>
          {#if catalogError}
            <p class="catalog-error">{catalogError}</p>
          {/if}
          {#if catalogResults.length > 0}
            <div class="catalog-results">
              {#each catalogResults as result}
                <div class="catalog-row">
                  <div class="catalog-main">
                    <span class="catalog-path">{result.path}</span>
                    <span class="catalog-type">{result.type || 'unknown type'}</span>
                    {#if result.description}
                      <span class="catalog-desc">{formatValue(stripHtml(result.description))}</span>
                    {/if}
                  </div>
                  <button class="catalog-add-btn" onclick={() => addOptionFromCatalog(result)} disabled={savingOption}>
                    <Icon name="Plus" size={12} /> Add with suggested value
                  </button>
                </div>
              {/each}
            </div>
          {:else if !catalogSearching && catalogSearched}
            <p class="catalog-empty">No option matches found in NixOS search for "{catalogSearched}"</p>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</div>

{#snippet optionDetailPanel()}
  <div class="detail-content">
    {#if !optionInfo}
      <div class="skeleton-loading">
        <div class="skeleton-header">
          <div class="skeleton-title"></div>
        </div>
        <div class="skeleton-description"></div>
        <div class="skeleton-grid">
          <div class="skeleton-field"></div>
          <div class="skeleton-field"></div>
        </div>
      </div>
    {:else if optionInfo.error}
      <div class="detail-error">Failed to load: {optionInfo.error}</div>
    {:else}
      <div class="detail-header">
        <div class="detail-title">
          <h3>{optionInfo.path}</h3>
          {#if optionInfo.type}
            <span class="type-badge">{optionInfo.type}</span>
          {/if}
        </div>
        {#if optionInfo.description}
          <p class="detail-description">{optionInfo.description}</p>
        {/if}
      </div>

        <div class="detail-grid">
          <div class="detail-field full-width">
            <span class="field-label">Current Value</span>
            {#if sourceMode === 'config' && isBooleanOption()}
              {@const currentBool = parseBoolValue(optionInfo.currentValue)}
              <div class="bool-editor">
                <button class="value-toggle" class:active={currentBool === true} onclick={toggleBooleanOption} disabled={savingOption}>
                  <span class="toggle-knob"></span>
                </button>
                <span class="bool-label">{currentBool === true ? 'true' : 'false'}</span>
              </div>
            {:else if sourceMode === 'config' && editingOptionKey === optionInfo.path}
              <div class="inline-edit">
                {#if isBlockValue(optionInfo.currentValue)}
                  <textarea class="edit-input edit-block" bind:value={editDraftValue}></textarea>
                {:else}
                  <input class="edit-input" bind:value={editDraftValue} />
                {/if}
                <div class="edit-actions">
                  <button class="save-btn" onclick={saveInlineEdit} disabled={savingOption}>
                    <Icon name="Check" size={12} /> Save changes
                  </button>
                  <button class="discard-btn" onclick={cancelInlineEdit} disabled={savingOption}>
                    Discard
                  </button>
                </div>
              </div>
            {:else if isBlockValue(optionInfo.currentValue)}
              <button class="inline-value-btn editable block-edit-btn" onclick={startInlineEdit}>
                <pre class="block-value">{@html highlightNix(optionInfo.currentValue)}</pre>
                <span class="edit-hint">Click to edit</span>
              </button>
            {:else}
              <button class="inline-value-btn" class:editable={canInlineEdit()} onclick={canInlineEdit() ? startInlineEdit : undefined}>
                <span class="field-value mono">{@html highlightNix(optionInfo.currentValue || 'not set')}</span>
                {#if canInlineEdit()}<span class="edit-hint">Click to edit</span>{/if}
              </button>
            {/if}
          </div>

        {#if optionInfo.default}
          <div class="detail-field">
            <span class="field-label">Default</span>
            <span class="field-value mono">{optionInfo.default}</span>
          </div>
        {/if}

        {#if optionInfo.example}
          <div class="detail-field full-width">
            <span class="field-label">Example</span>
            <span class="field-value mono">{optionInfo.example}</span>
          </div>
        {/if}

        {#if optionInfo.currentFile}
          <div class="detail-field full-width">
            <span class="field-label">Defined In</span>
            <span class="config-location">{optionInfo.currentFile}:{optionInfo.currentLine}</span>
          </div>
        {/if}

        {#if optionInfo.configLocations && optionInfo.configLocations.length > 0}
          <div class="detail-field full-width">
            <span class="field-label">All References</span>
            <div class="config-locations">
              {#each optionInfo.configLocations as loc}
                <span class="config-location">{loc}</span>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="detail-actions">
        <button class="action-btn" onclick={() => openUrl(`https://search.nixos.org/options?channel=unstable&query=${encodeURIComponent(optionInfo.path)}`)}>
          <Icon name="Search" size={12} /> NixOS Search
        </button>
        {#if optionInfo.declared}
          <button class="action-btn" onclick={() => openUrl(`https://github.com/NixOS/nixpkgs/blob/master/${optionInfo.declared.replace(/.*\/nixpkgs\//, '')}`)}>
            <Icon name="Package" size={12} /> Declaration
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .options-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 24px;
    overflow: hidden;
  }

  .page-header {
    margin-bottom: 20px;
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

  .source-toggle {
    display: flex;
    gap: 4px;
    background: rgba(30, 30, 46, 0.6);
    padding: 4px;
    border-radius: 12px;
    border: 1px solid rgba(69, 71, 90, 0.3);
  }

  .source-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #6c7086;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .source-btn:hover {
    color: #a6adc8;
    background: rgba(49, 50, 68, 0.4);
  }

  .source-btn.active {
    background: linear-gradient(135deg, rgba(203, 166, 247, 0.2) 0%, rgba(180, 190, 254, 0.2) 100%);
    color: #cba6f7;
    box-shadow: 0 2px 8px rgba(203, 166, 247, 0.15);
  }

  .source-icon {
    font-size: 14px;
  }

  .search-bar {
    display: flex;
    align-items: center;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 12px;
    padding: 0 16px;
    margin-bottom: 16px;
    transition: all 0.2s;
  }

  .search-bar:focus-within {
    border-color: rgba(203, 166, 247, 0.5);
    box-shadow: 0 0 0 2px rgba(203, 166, 247, 0.1);
  }

  .search-icon {
    margin-right: 12px;
    opacity: 0.6;
    display: flex;
    align-items: center;
  }

  .search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #cdd6f4;
    font-size: 14px;
    padding: 12px 0;
  }

  .search-bar input::placeholder {
    color: #6c7086;
  }

  .clear-btn {
    background: rgba(243, 139, 168, 0.2);
    border: none;
    color: #f38ba8;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .clear-btn:hover {
    background: rgba(243, 139, 168, 0.3);
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    align-items: center;
    flex-wrap: wrap;
  }

  .tab {
    background: rgba(49, 50, 68, 0.4);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 10px;
    padding: 10px 16px;
    color: #a6adc8;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tab:hover {
    background: rgba(49, 50, 68, 0.6);
    color: #cdd6f4;
  }

  .tab.active {
    background: linear-gradient(135deg, rgba(203, 166, 247, 0.2) 0%, rgba(180, 190, 254, 0.2) 100%);
    border-color: rgba(203, 166, 247, 0.4);
    color: #cba6f7;
  }

  .count {
    background: rgba(0, 0, 0, 0.2);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .tab.active .count {
    background: rgba(203, 166, 247, 0.2);
  }

  .tab.dimmed {
    opacity: 0.4;
  }

  .count.filtered {
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
  }

  .tab.active .count.filtered {
    background: rgba(166, 227, 161, 0.3);
  }

  .refresh-btn {
    margin-left: auto;
    background: rgba(49, 50, 68, 0.4);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 10px;
    padding: 10px 14px;
    color: #a6adc8;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: rgba(49, 50, 68, 0.6);
    color: #cdd6f4;
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
    color: #6c7086;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(203, 166, 247, 0.2);
    border-top-color: #cba6f7;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 16px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #f38ba8;
    text-align: center;
  }

  .error-icon {
    margin-bottom: 12px;
    display: flex;
  }

  .error button {
    margin-top: 16px;
    background: rgba(243, 139, 168, 0.2);
    border: 1px solid rgba(243, 139, 168, 0.3);
    color: #f38ba8;
    padding: 8px 20px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .error button:hover {
    background: rgba(243, 139, 168, 0.3);
  }

  .options-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .section-header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 12px;
  }

  .section-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0;
  }

  .section-header .info {
    font-size: 12px;
    color: #6c7086;
    font-family: monospace;
    background: rgba(49, 50, 68, 0.4);
    padding: 2px 8px;
    border-radius: 4px;
  }

  .option-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 8px;
  }

  .option-list::-webkit-scrollbar {
    width: 8px;
  }

  .option-list::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }

  .option-list::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }

  .option-list::-webkit-scrollbar-thumb:hover {
    background: rgba(88, 91, 112, 0.8);
  }

  .option-item-wrapper {
    display: flex;
    flex-direction: column;
  }

  .option-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: rgba(49, 50, 68, 0.3);
    border: 1px solid transparent;
    border-radius: 8px;
    transition: all 0.15s;
    cursor: pointer;
    width: 100%;
    text-align: left;
    color: inherit;
  }

  .option-item:hover {
    background: rgba(49, 50, 68, 0.5);
  }

  .option-item.selected {
    background: rgba(203, 166, 247, 0.15);
    border-color: rgba(203, 166, 247, 0.3);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .option-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .option-path {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 13px;
    color: #cdd6f4;
  }

  .option-value {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
    color: #a6e3a1;
    opacity: 0.8;
  }

  .option-meta {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .option-file, .option-source {
    font-size: 11px;
    color: #6c7086;
    font-family: monospace;
  }

  .expand-icon {
    font-size: 10px;
    color: #6c7086;
    transition: transform 0.2s;
  }

  .option-item.selected .expand-icon {
    color: #cba6f7;
  }

  .option-detail {
    background: rgba(30, 30, 46, 0.8);
    border: 1px solid rgba(203, 166, 247, 0.3);
    border-top: none;
    border-radius: 0 0 8px 8px;
    overflow: hidden;
    animation: slideDown 0.2s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .detail-content {
    padding: 16px 20px;
  }

  .detail-error {
    color: #f38ba8;
    font-size: 13px;
  }

  .skeleton-loading {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .skeleton-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .skeleton-title {
    width: 200px;
    height: 20px;
    background: linear-gradient(90deg, rgba(69, 71, 90, 0.4) 25%, rgba(88, 91, 112, 0.6) 50%, rgba(69, 71, 90, 0.4) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 4px;
  }

  .skeleton-description {
    width: 100%;
    height: 14px;
    background: linear-gradient(90deg, rgba(69, 71, 90, 0.4) 25%, rgba(88, 91, 112, 0.6) 50%, rgba(69, 71, 90, 0.4) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 4px;
  }

  .skeleton-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .skeleton-field {
    height: 40px;
    background: linear-gradient(90deg, rgba(69, 71, 90, 0.3) 25%, rgba(88, 91, 112, 0.5) 50%, rgba(69, 71, 90, 0.3) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 6px;
  }

  @keyframes skeleton-shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .detail-header {
    margin-bottom: 16px;
  }

  .detail-title {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .detail-title h3 {
    font-size: 16px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0;
  }

  .type-badge {
    background: rgba(203, 166, 247, 0.2);
    color: #cba6f7;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-family: monospace;
  }

  .detail-description {
    font-size: 13px;
    color: #a6adc8;
    margin: 0;
    line-height: 1.5;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }

  .detail-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .detail-field.full-width {
    grid-column: 1 / -1;
  }

  .field-label {
    font-size: 11px;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .field-value {
    font-size: 13px;
    color: #cdd6f4;
  }

  .field-value.mono {
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  .block-value {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
    color: #cdd6f4;
    background: rgba(30, 30, 46, 0.6);
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid rgba(69, 71, 90, 0.4);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
  }

  /* highlight.js Catppuccin-style theme for Nix */
  .block-value :global(.hljs-comment) {
    color: #6c7086;
    font-style: italic;
  }

  .block-value :global(.hljs-string) {
    color: #a6e3a1;
  }

  .block-value :global(.hljs-literal),
  .block-value :global(.hljs-keyword) {
    color: #fab387;
  }

  .block-value :global(.hljs-number) {
    color: #fab387;
  }

  .block-value :global(.hljs-built_in),
  .block-value :global(.hljs-builtin-name) {
    color: #f38ba8;
  }

  .block-value :global(.hljs-variable),
  .block-value :global(.hljs-attr) {
    color: #89b4fa;
  }

  .block-value :global(.hljs-punctuation) {
    color: #cba6f7;
  }

  .block-value :global(.hljs-subst) {
    color: #f5c2e7;
  }

  .config-locations {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .config-location {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
    color: #f9e2af;
    background: rgba(249, 226, 175, 0.1);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .detail-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid rgba(69, 71, 90, 0.3);
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 6px;
    color: #cdd6f4;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: rgba(49, 50, 68, 0.8);
    border-color: rgba(203, 166, 247, 0.3);
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6c7086;
    font-style: italic;
  }

  .search-results-info {
    margin-top: 12px;
    font-size: 12px;
    color: #6c7086;
    text-align: center;
  }

  .catalog-search-box {
    margin-top: 10px;
    padding: 12px;
    background: rgba(49, 50, 68, 0.2);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .catalog-search-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    color: #a6adc8;
  }

  .catalog-search-btn,
  .catalog-add-btn,
  .save-btn,
  .discard-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    border: 1px solid rgba(69, 71, 90, 0.35);
    background: rgba(49, 50, 68, 0.5);
    color: #cdd6f4;
    font-size: 12px;
    padding: 6px 10px;
    cursor: pointer;
  }

  .catalog-search-btn:hover,
  .catalog-add-btn:hover,
  .save-btn:hover,
  .discard-btn:hover {
    background: rgba(49, 50, 68, 0.75);
  }

  .catalog-results {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .catalog-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px;
    background: rgba(30, 30, 46, 0.55);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 6px;
  }

  .catalog-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .catalog-path {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
    color: #cdd6f4;
  }

  .catalog-type {
    font-size: 11px;
    color: #89b4fa;
  }

  .catalog-desc {
    font-size: 11px;
    color: #a6adc8;
  }

  .catalog-error,
  .catalog-empty {
    margin: 0;
    font-size: 12px;
    color: #f38ba8;
  }

  .inline-value-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    text-align: left;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 6px;
    color: inherit;
    padding: 6px 8px;
    cursor: default;
  }

  .inline-value-btn.editable {
    cursor: pointer;
    border-color: rgba(69, 71, 90, 0.3);
    background: rgba(30, 30, 46, 0.35);
  }

  .inline-value-btn.editable:hover {
    border-color: rgba(137, 180, 250, 0.35);
  }

  .edit-hint {
    font-size: 11px;
    color: #89b4fa;
    margin-left: 8px;
    white-space: nowrap;
  }

  .inline-edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .edit-input {
    border-radius: 6px;
    border: 1px solid rgba(69, 71, 90, 0.4);
    background: rgba(30, 30, 46, 0.7);
    color: #cdd6f4;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
    padding: 8px 10px;
  }

  .edit-input.edit-block {
    min-height: 180px;
    resize: vertical;
    line-height: 1.5;
    white-space: pre;
  }

  .edit-actions {
    display: flex;
    gap: 8px;
  }

  .bool-editor {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .value-toggle {
    position: relative;
    width: 52px;
    height: 28px;
    border-radius: 20px;
    border: 1px solid rgba(69, 71, 90, 0.5);
    background: rgba(49, 50, 68, 0.6);
    cursor: pointer;
    transition: all 0.2s;
    padding: 0;
  }

  .value-toggle.active {
    background: rgba(166, 227, 161, 0.2);
    border-color: rgba(166, 227, 161, 0.5);
  }

  .value-toggle .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #6c7086;
    transition: left 0.2s, background 0.2s;
  }

  .value-toggle.active .toggle-knob {
    left: 27px;
    background: #a6e3a1;
  }

  .bool-label {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 12px;
    color: #a6adc8;
  }

  .block-edit-btn {
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 8px;
  }
</style>
