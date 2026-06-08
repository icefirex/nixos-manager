<script>
  import { tick } from "svelte";

  let generations = $state([]);
  let groupedGenerations = $state([]);
  let loading = $state(true);
  let error = $state(null);

  // Search index state - using array for reliable Svelte 5 reactivity
  // Each entry: { genNumber, added, removed, changed, fromGen }
  let searchIndexArray = $state([]);
  let indexingProgress = $state({ current: 0, total: 0, complete: false });
  let masterSearch = $state("");
  let isIndexing = $state(false);

  // Detail state
  let selectedGeneration = $state(null);
  let generationInfo = $state(null);
  let generationDiff = $state(null);
  let loadingInfo = $state(false);

  // Diff tab state
  let diffTab = $state("changed");
  let diffFilter = $state("");
  let diffPage = $state(0);
  const ITEMS_PER_PAGE = 10;

  // Group expansion state
  let expandedGroups = $state(new Set());

  // Derived filtered groups for search - this ensures reactivity
  let filteredGroups = $derived.by(() => {
    if (!masterSearch.trim() || !indexingProgress.complete) {
      return groupedGenerations;
    }

    const query = masterSearch.toLowerCase();
    const matchingGenNumbers = new Set();

    // Find all generations that have matching packages
    for (const entry of searchIndexArray) {
      const allPackages = [
        ...entry.added.map(p => p.name),
        ...entry.removed.map(p => p.name),
        ...entry.changed.map(p => p.name)
      ];
      if (allPackages.some(name => name.toLowerCase().includes(query))) {
        matchingGenNumbers.add(entry.genNumber);
      }
    }

    // Filter groups to only include matching generations
    const filtered = [];
    for (const group of groupedGenerations) {
      const primaryMatches = matchingGenNumbers.has(group.primary.number);
      const matchingIdentical = group.identical.filter(g => matchingGenNumbers.has(g.number));

      if (primaryMatches || matchingIdentical.length > 0) {
        if (group.isGroup) {
          // For groups, only show matching members
          const allInGroup = [group.primary, ...group.identical];
          const matchingInGroup = allInGroup.filter(g => matchingGenNumbers.has(g.number));

          if (matchingInGroup.length === 1) {
            filtered.push({ primary: matchingInGroup[0], identical: [], isGroup: false });
          } else if (matchingInGroup.length > 1) {
            filtered.push({
              primary: matchingInGroup[0],
              identical: matchingInGroup.slice(1),
              isGroup: true
            });
          }
        } else {
          filtered.push(group);
        }
      }
    }

    return filtered;
  });

  // Action state
  let showConfirmDialog = $state(false);
  let confirmAction = $state(null);
  let pendingGeneration = $state(null);
  let isActioning = $state(false);
  let actionError = $state(null);
  let actionSuccess = $state(null);

  async function loadGenerations() {
    loading = true;
    error = null;
    selectedGeneration = null;
    generationInfo = null;
    generationDiff = null;
    expandedGroups = new Set();
    searchIndexArray = [];
    indexingProgress = { current: 0, total: 0, complete: false };
    masterSearch = "";
    try {
      generations = await window.electronAPI.getGenerations();
      // Group identical generations (this also starts building partial index)
      groupedGenerations = await computeGroups(generations);
      // Start background indexing for search
      startBackgroundIndexing();
    } catch (e) {
      error = e.message;
      console.error("Failed to load generations:", e);
    } finally {
      loading = false;
    }
  }

  async function computeGroups(gens) {
    if (gens.length === 0) return [];

    const groups = [];
    const newSearchIndex = []; // Build array for proper reactivity
    let currentGroup = null;

    for (let i = 0; i < gens.length; i++) {
      const gen = gens[i];
      const nextGen = gens[i + 1]; // older generation

      // Start a new group if needed
      if (!currentGroup) {
        currentGroup = {
          primary: gen,
          identical: [],
          isGroup: false
        };
      } else {
        // This gen is being added to an existing group (continuing from previous identical)
        currentGroup.identical.push(gen);
      }

      // Check if there's a next generation to compare with
      if (nextGen && !gen.current) {
        try {
          const diff = await window.electronAPI.getGenerationDiff(nextGen.number, gen.number);
          const hasChanges = diff.available &&
            (diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0);

          // Store in index for later search
          if (diff.available) {
            newSearchIndex.push({
              genNumber: gen.number,
              added: diff.added,
              removed: diff.removed,
              changed: diff.changed,
              fromGen: nextGen.number
            });
          }

          if (!hasChanges) {
            // Next generation is identical, continue grouping
            currentGroup.isGroup = true;
            continue;
          }
        } catch (e) {
          // If diff fails, treat as different
        }
      }

      // Different from next (or no next, or current gen), finalize group
      groups.push(currentGroup);
      currentGroup = null;
    }

    // Don't forget the last group
    if (currentGroup) {
      groups.push(currentGroup);
    }

    // Update searchIndexArray for proper Svelte 5 reactivity
    searchIndexArray = newSearchIndex;

    return groups;
  }

  async function startBackgroundIndexing() {
    if (generations.length < 2) {
      indexingProgress = { current: 0, total: 0, complete: true };
      return;
    }

    isIndexing = true;
    const total = generations.length - 1;
    indexingProgress = { current: 0, total, complete: false };

    // Create a working copy of the current index
    const workingIndex = [...searchIndexArray];
    const indexedGenNumbers = new Set(workingIndex.map(e => e.genNumber));

    // Index diffs that weren't already computed during grouping
    for (let i = 0; i < generations.length - 1; i++) {
      const gen = generations[i];
      const prevGen = generations[i + 1];

      // Skip if already indexed
      if (!indexedGenNumbers.has(gen.number)) {
        try {
          const diff = await window.electronAPI.getGenerationDiff(prevGen.number, gen.number);
          if (diff.available) {
            workingIndex.push({
              genNumber: gen.number,
              added: diff.added,
              removed: diff.removed,
              changed: diff.changed,
              fromGen: prevGen.number
            });
            indexedGenNumbers.add(gen.number);
            // Update searchIndexArray reactively after each new entry
            searchIndexArray = [...workingIndex];
          }
        } catch (e) {
          // Skip failed diffs
        }
      }

      indexingProgress = { current: i + 1, total, complete: false };
      // Small delay to keep UI responsive
      await new Promise(r => setTimeout(r, 50));
    }

    // Final update
    searchIndexArray = [...workingIndex];
    indexingProgress = { current: total, total, complete: true };
    isIndexing = false;
  }


  function getSearchMatchInfo(genNumber) {
    if (!masterSearch.trim()) return null;

    const entry = searchIndexArray.find(e => e.genNumber === genNumber);
    if (!entry) return null;

    const query = masterSearch.toLowerCase();
    const diff = entry;
    const matches = {
      added: diff.added.filter(p => p.name.toLowerCase().includes(query)),
      removed: diff.removed.filter(p => p.name.toLowerCase().includes(query)),
      changed: diff.changed.filter(p => p.name.toLowerCase().includes(query))
    };

    const total = matches.added.length + matches.removed.length + matches.changed.length;
    return total > 0 ? matches : null;
  }

  $effect(() => {
    loadGenerations();
  });

  function toggleGroup(groupIndex) {
    const newSet = new Set(expandedGroups);
    if (newSet.has(groupIndex)) {
      newSet.delete(groupIndex);
    } else {
      newSet.add(groupIndex);
    }
    expandedGroups = newSet;
  }

  async function selectGeneration(gen) {
    if (selectedGeneration?.number === gen.number) {
      selectedGeneration = null;
      generationInfo = null;
      generationDiff = null;
      return;
    }

    selectedGeneration = gen;
    generationInfo = null;
    generationDiff = null;
    loadingInfo = true;
    diffTab = "changed";
    diffFilter = "";
    diffPage = 0;

    await tick();

    try {
      const [info] = await Promise.all([
        window.electronAPI.getGenerationInfo(gen.number),
        new Promise(resolve => setTimeout(resolve, 400))
      ]);

      if (selectedGeneration?.number === gen.number) {
        generationInfo = info;

        // Get diff with previous generation (what changed IN this generation)
        // This matches what the search index contains
        const genIndex = generations.findIndex(g => g.number === gen.number);
        const prevGen = generations[genIndex + 1]; // older generation (list is sorted newest first)
        if (prevGen) {
          try {
            generationDiff = await window.electronAPI.getGenerationDiff(prevGen.number, gen.number);
          } catch (e) {
            console.error("Failed to load diff:", e);
          }
        }
      }
    } catch (e) {
      console.error("Failed to load generation info:", e);
      if (selectedGeneration?.number === gen.number) {
        generationInfo = { number: gen.number, error: e.message };
      }
    } finally {
      loadingInfo = false;
    }
  }

  function getFilteredDiffItems(items) {
    if (!diffFilter.trim()) return items;
    const q = diffFilter.toLowerCase();
    return items.filter(pkg => pkg.name.toLowerCase().includes(q));
  }

  function getPaginatedItems(items) {
    const filtered = getFilteredDiffItems(items);
    const start = diffPage * ITEMS_PER_PAGE;
    return {
      items: filtered.slice(start, start + ITEMS_PER_PAGE),
      total: filtered.length,
      hasMore: start + ITEMS_PER_PAGE < filtered.length,
      hasPrev: diffPage > 0
    };
  }

  function getCurrentDiffList() {
    if (!generationDiff || !generationDiff.available) return [];
    switch (diffTab) {
      case "added": return generationDiff.added;
      case "removed": return generationDiff.removed;
      case "changed": return generationDiff.changed;
      default: return [];
    }
  }

  function requestAction(action, gen) {
    confirmAction = action;
    pendingGeneration = gen;
    showConfirmDialog = true;
    actionError = null;
  }

  function cancelAction() {
    showConfirmDialog = false;
    confirmAction = null;
    pendingGeneration = null;
  }

  async function confirmActionHandler() {
    if (!pendingGeneration || !confirmAction) return;

    isActioning = true;
    actionError = null;
    actionSuccess = null;

    try {
      let result;
      switch (confirmAction) {
        case 'switch':
          result = await window.electronAPI.switchGeneration(pendingGeneration.number);
          break;
        case 'boot':
          result = await window.electronAPI.bootGeneration(pendingGeneration.number);
          break;
        case 'delete':
          result = await window.electronAPI.deleteGeneration(pendingGeneration.number);
          break;
      }

      actionSuccess = result;
      showConfirmDialog = false;

      // Reload generations after action
      await loadGenerations();
    } catch (e) {
      actionError = e.message;
    } finally {
      isActioning = false;
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  }

  function getRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
      return `${Math.floor(diffDays / 365)} years ago`;
    } catch {
      return '';
    }
  }

  function getActionTitle() {
    switch (confirmAction) {
      case 'switch': return 'Switch Generation';
      case 'boot': return 'Set Boot Generation';
      case 'delete': return 'Delete Generation';
      default: return 'Confirm Action';
    }
  }

  function getActionDescription() {
    if (!pendingGeneration) return '';
    switch (confirmAction) {
      case 'switch':
        return `This will immediately switch to generation ${pendingGeneration.number}. Your current session may be affected.`;
      case 'boot':
        return `Generation ${pendingGeneration.number} will become active on the next reboot.`;
      case 'delete':
        return `This will permanently delete generation ${pendingGeneration.number}. This cannot be undone.`;
      default:
        return '';
    }
  }

  function dismissSuccess() {
    actionSuccess = null;
  }

  function getTotalCount() {
    let count = 0;
    for (const group of groupedGenerations) {
      count += 1 + group.identical.length;
    }
    return count;
  }

  function clearSearch() {
    masterSearch = "";
  }
</script>

<div class="generations-page">
  <div class="page-header">
    <div class="header-top">
      <div>
        <h1>System Generations</h1>
        <p class="subtitle">
          Manage NixOS system generations and rollback to previous configurations
        </p>
      </div>
      <button class="refresh-btn" onclick={loadGenerations} disabled={loading}>
        {loading ? "..." : "Refresh"}
      </button>
    </div>
  </div>

  <!-- Master Search -->
  <div class="master-search" class:disabled={loading || !indexingProgress.complete}>
    <div class="search-input-wrapper">
      <span class="search-icon">
        {#if isIndexing && !loading}
          <span class="indexing-spinner"></span>
        {:else}
          O
        {/if}
      </span>
      <input
        type="text"
        placeholder={loading ? "Loading..." : (indexingProgress.complete ? "Search all generations for package changes..." : "Indexing...")}
        bind:value={masterSearch}
        disabled={loading || !indexingProgress.complete}
      />
      {#if masterSearch}
        <button class="clear-search" onclick={clearSearch}>x</button>
      {/if}
    </div>
    {#if isIndexing && !loading}
      <div class="indexing-status">
        <div class="indexing-bar">
          <div
            class="indexing-progress"
            style="width: {(indexingProgress.current / indexingProgress.total) * 100}%"
          ></div>
        </div>
        <span class="indexing-text">{indexingProgress.current}/{indexingProgress.total}</span>
      </div>
    {:else if masterSearch && indexingProgress.complete}
      {@const query = masterSearch.toLowerCase()}
      {@const matchingEntries = searchIndexArray.filter(e => [...e.added, ...e.removed, ...e.changed].some(p => p.name.toLowerCase().includes(query)))}
      <span class="search-results-count">
        {filteredGroups.length} generation{filteredGroups.length !== 1 ? 's' : ''} with matches
      </span>
      {#if matchingEntries.length > 0 && matchingEntries.length <= 10}
        <div class="search-match-summary">
          {#each matchingEntries as entry}
            {@const addedMatches = entry.added.filter(p => p.name.toLowerCase().includes(query))}
            {@const removedMatches = entry.removed.filter(p => p.name.toLowerCase().includes(query))}
            {@const changedMatches = entry.changed.filter(p => p.name.toLowerCase().includes(query))}
            <div class="match-entry">
              <span class="match-gen">#{entry.genNumber}</span>
              {#each addedMatches as pkg}<span class="match-pkg added">+{pkg.name}</span>{/each}
              {#each removedMatches as pkg}<span class="match-pkg removed">-{pkg.name}</span>{/each}
              {#each changedMatches as pkg}<span class="match-pkg changed">~{pkg.name}</span>{/each}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading generations...</p>
    </div>
  {:else if error}
    <div class="error">
      <span class="error-icon">!</span>
      <p>{error}</p>
      <button onclick={loadGenerations}>Retry</button>
    </div>
  {:else}
    <div class="generations-content">
      <div class="section-header">
        <h2>Available Generations</h2>
        <span class="info">{getTotalCount()} generations</span>
        {#if groupedGenerations.some(g => g.isGroup)}
          <span class="info grouped">{groupedGenerations.length} unique</span>
        {/if}
      </div>

      <div class="generation-list">
        {#each filteredGroups as group, groupIndex}
          {#if group.isGroup}
            <!-- Grouped identical generations -->
            <div class="generation-group">
              <button
                class="group-header"
                class:expanded={expandedGroups.has(groupIndex)}
                onclick={() => toggleGroup(groupIndex)}
              >
                <div class="group-info">
                  <span class="group-icon">{expandedGroups.has(groupIndex) ? '...' : '+'}</span>
                  <span class="group-range">
                    #{group.primary.number} - #{group.identical[group.identical.length - 1].number}
                  </span>
                  <span class="group-count">{1 + group.identical.length} identical</span>
                </div>
                <span class="group-date">{getRelativeTime(group.primary.date)}</span>
              </button>

              {#if expandedGroups.has(groupIndex)}
                <div class="group-contents">
                  {@render generationItem(group.primary, false)}
                  {#each group.identical as gen}
                    {@render generationItem(gen, true)}
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <!-- Single generation -->
            {@render generationItem(group.primary, false)}
          {/if}
        {:else}
          <div class="empty">
            {#if masterSearch}
              No generations match "{masterSearch}"
            {:else}
              No generations found
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if showConfirmDialog}
  <div class="modal-overlay" onclick={cancelAction}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <h3>{getActionTitle()}</h3>
      <p class="modal-description">{getActionDescription()}</p>

      <div class="modal-gen-info">
        <span class="modal-gen-number">Generation #{pendingGeneration?.number}</span>
        <span class="modal-gen-date">{formatDate(pendingGeneration?.date)}</span>
      </div>

      {#if actionError}
        <div class="modal-error">{actionError}</div>
      {/if}

      <div class="modal-actions">
        <button class="cancel-btn" onclick={cancelAction} disabled={isActioning}>
          Cancel
        </button>
        <button
          class="confirm-btn"
          class:danger={confirmAction === 'delete'}
          onclick={confirmActionHandler}
          disabled={isActioning}
        >
          {#if isActioning}
            <span class="btn-spinner"></span>
            Processing...
          {:else}
            {confirmAction === 'switch' ? 'Switch Now' : confirmAction === 'boot' ? 'Set for Boot' : 'Delete'}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if actionSuccess}
  <div class="toast success" onclick={dismissSuccess}>
    <span class="toast-icon">OK</span>
    <span class="toast-message">{actionSuccess}</span>
  </div>
{/if}

{#snippet generationItem(gen, isInGroup)}
  {@const searchMatches = getSearchMatchInfo(gen.number)}
  <div class="generation-item-wrapper" class:in-group={isInGroup}>
    <button
      class="generation-item"
      class:selected={selectedGeneration?.number === gen.number}
      class:current={gen.current}
      class:has-match={searchMatches}
      onclick={() => selectGeneration(gen)}
    >
      <div class="gen-main">
        <div class="gen-number">
          {#if gen.current}
            <span class="current-indicator"></span>
          {/if}
          <span class="number">#{gen.number}</span>
          {#if gen.current}
            <span class="current-badge">Current</span>
          {/if}
        </div>
        <div class="gen-date">
          <span class="date-full">{formatDate(gen.date)}</span>
          <span class="date-relative">{getRelativeTime(gen.date)}</span>
        </div>
        {#if searchMatches}
          <div class="search-match-badges">
            {#if searchMatches.added.length > 0}
              <span class="match-badge added">+{searchMatches.added.length}</span>
            {/if}
            {#if searchMatches.removed.length > 0}
              <span class="match-badge removed">-{searchMatches.removed.length}</span>
            {/if}
            {#if searchMatches.changed.length > 0}
              <span class="match-badge changed">~{searchMatches.changed.length}</span>
            {/if}
          </div>
        {/if}
      </div>
      <span class="expand-icon">{selectedGeneration?.number === gen.number ? '...' : '>'}</span>
    </button>

    {#if selectedGeneration?.number === gen.number}
      <div class="generation-detail">
        {@render generationDetailPanel(gen)}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet generationDetailPanel(gen)}
  <div class="detail-content">
    {#if !generationInfo}
      <div class="skeleton-loading">
        <div class="skeleton-row">
          <div class="skeleton-field"></div>
          <div class="skeleton-field"></div>
        </div>
        <div class="skeleton-row">
          <div class="skeleton-field wide"></div>
        </div>
        <div class="skeleton-actions">
          <div class="skeleton-btn"></div>
          <div class="skeleton-btn"></div>
        </div>
      </div>
    {:else if generationInfo.error}
      <div class="detail-error">Failed to load: {generationInfo.error}</div>
    {:else}
      <div class="detail-grid">
        {#if generationInfo.nixosVersion}
          <div class="detail-field">
            <span class="field-label">NixOS Version</span>
            <span class="field-value">{generationInfo.nixosVersion}</span>
          </div>
        {/if}

        {#if generationInfo.kernelVersion}
          <div class="detail-field">
            <span class="field-label">Kernel</span>
            <span class="field-value mono">{generationInfo.kernelVersion}</span>
          </div>
        {/if}

        {#if generationInfo.closureSize}
          <div class="detail-field">
            <span class="field-label">Closure Size</span>
            <span class="field-value">{generationInfo.closureSize}</span>
          </div>
        {/if}

        {#if generationInfo.configurationRevision}
          <div class="detail-field full-width">
            <span class="field-label">Configuration Revision</span>
            <span class="field-value mono revision">{generationInfo.configurationRevision}</span>
          </div>
        {/if}

        <div class="detail-field full-width">
          <span class="field-label">Store Path</span>
          <span class="field-value mono path">{generationInfo.path}</span>
        </div>
      </div>

      {#if generationDiff && generationDiff.available}
        {@const filteredChanged = getFilteredDiffItems(generationDiff.changed)}
        {@const filteredAdded = getFilteredDiffItems(generationDiff.added)}
        {@const filteredRemoved = getFilteredDiffItems(generationDiff.removed)}
        {@const hasAnyResults = filteredChanged.length > 0 || filteredAdded.length > 0 || filteredRemoved.length > 0}
        {@const bestTab = diffFilter.trim() ? (
          (diffTab === "changed" && filteredChanged.length > 0) ? "changed" :
          (diffTab === "added" && filteredAdded.length > 0) ? "added" :
          (diffTab === "removed" && filteredRemoved.length > 0) ? "removed" :
          (filteredChanged.length > 0) ? "changed" :
          (filteredAdded.length > 0) ? "added" :
          (filteredRemoved.length > 0) ? "removed" : diffTab
        ) : diffTab}
        {@const activeTab = bestTab}
        <div class="diff-section">
          <div class="diff-header">
            <h4>Changes in this Generation</h4>
            <div class="diff-tabs">
              {#if filteredChanged.length > 0 || !diffFilter.trim()}
                <button
                  class="diff-tab"
                  class:active={activeTab === "changed"}
                  class:dimmed={diffFilter.trim() && filteredChanged.length === 0}
                  onclick={() => { diffTab = "changed"; diffPage = 0; }}
                >
                  Changed
                  {#if filteredChanged.length > 0}
                    <span class="tab-count changed">{filteredChanged.length}</span>
                  {/if}
                </button>
              {/if}
              {#if filteredAdded.length > 0 || !diffFilter.trim()}
                <button
                  class="diff-tab"
                  class:active={activeTab === "added"}
                  class:dimmed={diffFilter.trim() && filteredAdded.length === 0}
                  onclick={() => { diffTab = "added"; diffPage = 0; }}
                >
                  Added
                  {#if filteredAdded.length > 0}
                    <span class="tab-count added">{filteredAdded.length}</span>
                  {/if}
                </button>
              {/if}
              {#if filteredRemoved.length > 0 || !diffFilter.trim()}
                <button
                  class="diff-tab"
                  class:active={activeTab === "removed"}
                  class:dimmed={diffFilter.trim() && filteredRemoved.length === 0}
                  onclick={() => { diffTab = "removed"; diffPage = 0; }}
                >
                  Removed
                  {#if filteredRemoved.length > 0}
                    <span class="tab-count removed">{filteredRemoved.length}</span>
                  {/if}
                </button>
              {/if}
            </div>
          </div>

          <!-- Always show filter box -->
          <div class="diff-filter">
            <input
              type="text"
              placeholder="Filter..."
              bind:value={diffFilter}
              oninput={() => diffPage = 0}
            />
            {#if diffFilter}
              <button class="clear-filter" onclick={() => { diffFilter = ""; diffPage = 0; }}>x</button>
            {/if}
          </div>

          {#if hasAnyResults}
            {@const currentList = activeTab === "changed" ? filteredChanged : activeTab === "added" ? filteredAdded : filteredRemoved}
            {@const start = diffPage * ITEMS_PER_PAGE}
            {@const paginatedItems = currentList.slice(start, start + ITEMS_PER_PAGE)}
            {@const hasMore = start + ITEMS_PER_PAGE < currentList.length}
            {@const hasPrev = diffPage > 0}
            <div class="diff-list">
              {#each paginatedItems as pkg}
                <div class="diff-item" class:added={activeTab === "added"} class:removed={activeTab === "removed"} class:changed={activeTab === "changed"}>
                  <span class="diff-pkg">{pkg.name}</span>
                  <span class="diff-change">{pkg.change}</span>
                </div>
              {/each}
            </div>

            {#if currentList.length > ITEMS_PER_PAGE}
              <div class="diff-pagination">
                <button
                  class="page-btn"
                  disabled={!hasPrev}
                  onclick={() => diffPage--}
                >
                  Prev
                </button>
                <span class="page-info">
                  {start + 1}-{Math.min(start + ITEMS_PER_PAGE, currentList.length)} of {currentList.length}
                </span>
                <button
                  class="page-btn"
                  disabled={!hasMore}
                  onclick={() => diffPage++}
                >
                  Next
                </button>
              </div>
            {/if}
          {:else}
            <div class="diff-empty-state">
              {#if diffFilter.trim()}
                No matches for "{diffFilter}"
              {:else}
                No changes in this generation
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <div class="detail-actions">
        {#if !gen.current}
          <button class="action-btn primary" onclick={() => requestAction('switch', gen)}>
            Switch Now
          </button>
          <button class="action-btn" onclick={() => requestAction('boot', gen)}>
            Set for Boot
          </button>
        {:else}
          <span class="current-note">This is the currently active generation</span>
        {/if}
        {#if !gen.current && generations.length > 1}
          <button class="action-btn danger" onclick={() => requestAction('delete', gen)}>
            Delete
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .generations-page {
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
    background: rgba(49, 50, 68, 0.4);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 10px;
    padding: 10px 20px;
    color: #a6adc8;
    font-size: 13px;
    font-weight: 500;
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

  /* Master Search */
  .master-search {
    margin-bottom: 16px;
  }

  .master-search.disabled {
    opacity: 0.7;
  }

  .search-input-wrapper {
    display: flex;
    align-items: center;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 10px;
    padding: 0 14px;
    transition: all 0.2s;
  }

  .search-input-wrapper:focus-within {
    border-color: rgba(137, 180, 250, 0.5);
    box-shadow: 0 0 0 2px rgba(137, 180, 250, 0.1);
  }

  .search-icon {
    font-size: 14px;
    margin-right: 10px;
    color: #6c7086;
  }

  .indexing-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(137, 180, 250, 0.3);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .search-input-wrapper input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #cdd6f4;
    font-size: 14px;
    padding: 12px 0;
  }

  .search-input-wrapper input::placeholder {
    color: #6c7086;
  }

  .search-input-wrapper input:disabled {
    cursor: not-allowed;
  }

  .clear-search {
    width: 20px;
    height: 20px;
    border: none;
    background: rgba(243, 139, 168, 0.2);
    color: #f38ba8;
    border-radius: 50%;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .clear-search:hover {
    background: rgba(243, 139, 168, 0.3);
  }

  .indexing-status {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }

  .indexing-bar {
    flex: 1;
    height: 4px;
    background: rgba(49, 50, 68, 0.5);
    border-radius: 2px;
    overflow: hidden;
  }

  .indexing-progress {
    height: 100%;
    background: linear-gradient(90deg, #89b4fa, #b4befe);
    border-radius: 2px;
    transition: width 0.1s ease-out;
  }

  .indexing-text {
    font-size: 11px;
    color: #6c7086;
    min-width: 50px;
    text-align: right;
  }

  .search-results-count {
    display: block;
    margin-top: 8px;
    font-size: 12px;
    color: #89b4fa;
  }

  .search-match-summary {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .match-entry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }

  .match-gen {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    color: #89b4fa;
    min-width: 40px;
  }

  .match-pkg {
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 10px;
  }

  .match-pkg.added {
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
  }

  .match-pkg.removed {
    background: rgba(243, 139, 168, 0.2);
    color: #f38ba8;
  }

  .match-pkg.changed {
    background: rgba(249, 226, 175, 0.2);
    color: #f9e2af;
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
    border: 3px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
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
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(243, 139, 168, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 12px;
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

  .generations-content {
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
    background: rgba(49, 50, 68, 0.4);
    padding: 2px 8px;
    border-radius: 4px;
  }

  .section-header .info.grouped {
    background: rgba(137, 180, 250, 0.15);
    color: #89b4fa;
  }

  .generation-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 8px;
  }

  .generation-list::-webkit-scrollbar {
    width: 8px;
  }

  .generation-list::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }

  .generation-list::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }

  .generation-list::-webkit-scrollbar-thumb:hover {
    background: rgba(88, 91, 112, 0.8);
  }

  /* Group styles */
  .generation-group {
    display: flex;
    flex-direction: column;
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: rgba(137, 180, 250, 0.08);
    border: 1px dashed rgba(137, 180, 250, 0.3);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
    text-align: left;
    color: inherit;
  }

  .group-header:hover {
    background: rgba(137, 180, 250, 0.12);
  }

  .group-header.expanded {
    border-radius: 8px 8px 0 0;
    border-bottom-style: solid;
  }

  .group-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .group-icon {
    font-size: 12px;
    color: #89b4fa;
    width: 16px;
  }

  .group-range {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 13px;
    color: #89b4fa;
  }

  .group-count {
    font-size: 11px;
    color: #6c7086;
    background: rgba(49, 50, 68, 0.4);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .group-date {
    font-size: 12px;
    color: #6c7086;
  }

  .group-contents {
    border: 1px dashed rgba(137, 180, 250, 0.3);
    border-top: none;
    border-radius: 0 0 8px 8px;
    padding: 8px;
    background: rgba(137, 180, 250, 0.04);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .generation-item-wrapper {
    display: flex;
    flex-direction: column;
  }

  .generation-item-wrapper.in-group .generation-item {
    background: rgba(49, 50, 68, 0.2);
  }

  .generation-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    background: rgba(49, 50, 68, 0.3);
    border: 1px solid transparent;
    border-radius: 8px;
    transition: all 0.15s;
    cursor: pointer;
    width: 100%;
    text-align: left;
    color: inherit;
  }

  .generation-item:hover {
    background: rgba(49, 50, 68, 0.5);
  }

  .generation-item.selected {
    background: rgba(137, 180, 250, 0.15);
    border-color: rgba(137, 180, 250, 0.3);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .generation-item.current {
    border-left: 3px solid #a6e3a1;
  }

  .generation-item.current.selected {
    border-left-color: #a6e3a1;
  }

  .generation-item.has-match {
    background: rgba(137, 180, 250, 0.1);
    border-color: rgba(137, 180, 250, 0.2);
  }

  .gen-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .gen-number {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .current-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #a6e3a1;
    box-shadow: 0 0 8px rgba(166, 227, 161, 0.6);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .number {
    font-size: 16px;
    font-weight: 600;
    color: #cdd6f4;
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  .current-badge {
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .gen-date {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .date-full {
    font-size: 13px;
    color: #a6adc8;
  }

  .date-relative {
    font-size: 12px;
    color: #6c7086;
  }

  .search-match-badges {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  .match-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
  }

  .match-badge.added {
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
  }

  .match-badge.removed {
    background: rgba(243, 139, 168, 0.2);
    color: #f38ba8;
  }

  .match-badge.changed {
    background: rgba(249, 226, 175, 0.2);
    color: #f9e2af;
  }

  .expand-icon {
    font-size: 12px;
    color: #6c7086;
    transition: transform 0.2s;
  }

  .generation-item.selected .expand-icon {
    color: #89b4fa;
  }

  .generation-detail {
    background: rgba(30, 30, 46, 0.8);
    border: 1px solid rgba(137, 180, 250, 0.3);
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

  .field-value.revision {
    font-size: 12px;
    background: rgba(249, 226, 175, 0.1);
    padding: 4px 8px;
    border-radius: 4px;
    color: #f9e2af;
  }

  .field-value.path {
    font-size: 11px;
    color: #6c7086;
    word-break: break-all;
  }

  /* Diff section with tabs */
  .diff-section {
    margin-bottom: 16px;
    padding: 12px;
    background: rgba(49, 50, 68, 0.3);
    border-radius: 8px;
  }

  .diff-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .diff-section h4 {
    font-size: 13px;
    color: #cdd6f4;
    margin: 0;
    font-weight: 500;
  }

  .diff-tabs {
    display: flex;
    gap: 4px;
  }

  .diff-tab {
    padding: 4px 10px;
    border: none;
    background: rgba(49, 50, 68, 0.5);
    border-radius: 6px;
    color: #6c7086;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .diff-tab:hover {
    background: rgba(49, 50, 68, 0.8);
    color: #a6adc8;
  }

  .diff-tab.active {
    background: rgba(137, 180, 250, 0.2);
    color: #89b4fa;
  }

  .diff-tab.dimmed {
    opacity: 0.4;
  }

  .tab-count {
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }

  .tab-count.added {
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
  }

  .tab-count.removed {
    background: rgba(243, 139, 168, 0.2);
    color: #f38ba8;
  }

  .tab-count.changed {
    background: rgba(249, 226, 175, 0.2);
    color: #f9e2af;
  }

  .diff-filter {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .diff-filter input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 6px;
    background: rgba(30, 30, 46, 0.6);
    color: #cdd6f4;
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
  }

  .diff-filter input:focus {
    border-color: rgba(137, 180, 250, 0.5);
  }

  .diff-filter input::placeholder {
    color: #6c7086;
  }

  .clear-filter {
    width: 20px;
    height: 20px;
    border: none;
    background: rgba(243, 139, 168, 0.2);
    color: #f38ba8;
    border-radius: 50%;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .clear-filter:hover {
    background: rgba(243, 139, 168, 0.3);
  }

  .diff-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .diff-item {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 4px;
    gap: 12px;
  }

  .diff-item.added {
    background: rgba(166, 227, 161, 0.1);
  }

  .diff-item.removed {
    background: rgba(243, 139, 168, 0.1);
  }

  .diff-item.changed {
    background: rgba(249, 226, 175, 0.1);
  }

  .diff-pkg {
    font-family: monospace;
    color: #cdd6f4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-change {
    color: #6c7086;
    font-family: monospace;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .diff-empty, .diff-empty-state {
    color: #6c7086;
    font-size: 12px;
    font-style: italic;
    text-align: center;
    padding: 16px;
  }

  .diff-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(69, 71, 90, 0.3);
  }

  .page-btn {
    padding: 4px 12px;
    border: 1px solid rgba(69, 71, 90, 0.3);
    background: rgba(49, 50, 68, 0.4);
    border-radius: 4px;
    color: #a6adc8;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .page-btn:hover:not(:disabled) {
    background: rgba(49, 50, 68, 0.6);
    color: #cdd6f4;
  }

  .page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-info {
    font-size: 11px;
    color: #6c7086;
  }

  .detail-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid rgba(69, 71, 90, 0.3);
    align-items: center;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 6px;
    color: #cdd6f4;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: rgba(49, 50, 68, 0.8);
    border-color: rgba(137, 180, 250, 0.3);
  }

  .action-btn.primary {
    background: linear-gradient(135deg, rgba(137, 180, 250, 0.3) 0%, rgba(180, 190, 254, 0.3) 100%);
    border-color: rgba(137, 180, 250, 0.4);
    color: #89b4fa;
  }

  .action-btn.primary:hover {
    background: linear-gradient(135deg, rgba(137, 180, 250, 0.4) 0%, rgba(180, 190, 254, 0.4) 100%);
  }

  .action-btn.danger {
    color: #f38ba8;
    margin-left: auto;
  }

  .action-btn.danger:hover {
    background: rgba(243, 139, 168, 0.15);
    border-color: rgba(243, 139, 168, 0.3);
  }

  .current-note {
    font-size: 13px;
    color: #a6e3a1;
    font-style: italic;
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6c7086;
    font-style: italic;
  }

  /* Skeleton loading */
  .skeleton-loading {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .skeleton-row {
    display: flex;
    gap: 12px;
  }

  .skeleton-field {
    height: 40px;
    flex: 1;
    background: linear-gradient(90deg, rgba(69, 71, 90, 0.4) 25%, rgba(88, 91, 112, 0.6) 50%, rgba(69, 71, 90, 0.4) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 6px;
  }

  .skeleton-field.wide {
    flex: 2;
  }

  .skeleton-actions {
    display: flex;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid rgba(69, 71, 90, 0.3);
  }

  .skeleton-btn {
    width: 100px;
    height: 32px;
    background: linear-gradient(90deg, rgba(69, 71, 90, 0.4) 25%, rgba(88, 91, 112, 0.6) 50%, rgba(69, 71, 90, 0.4) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 6px;
  }

  @keyframes skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal {
    background: #1e1e2e;
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 16px;
    padding: 24px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal h3 {
    font-size: 18px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0 0 8px 0;
  }

  .modal-description {
    font-size: 14px;
    color: #a6adc8;
    margin: 0 0 16px 0;
    line-height: 1.5;
  }

  .modal-gen-info {
    background: rgba(49, 50, 68, 0.4);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .modal-gen-number {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 14px;
    font-weight: 600;
    color: #89b4fa;
  }

  .modal-gen-date {
    font-size: 12px;
    color: #6c7086;
  }

  .modal-error {
    background: rgba(243, 139, 168, 0.15);
    border: 1px solid rgba(243, 139, 168, 0.3);
    border-radius: 8px;
    padding: 12px;
    color: #f38ba8;
    font-size: 13px;
    margin-bottom: 16px;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }

  .cancel-btn {
    padding: 10px 20px;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 8px;
    color: #a6adc8;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .cancel-btn:hover:not(:disabled) {
    background: rgba(49, 50, 68, 0.8);
    color: #cdd6f4;
  }

  .confirm-btn {
    padding: 10px 20px;
    background: linear-gradient(135deg, rgba(137, 180, 250, 0.3) 0%, rgba(180, 190, 254, 0.3) 100%);
    border: 1px solid rgba(137, 180, 250, 0.4);
    border-radius: 8px;
    color: #89b4fa;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .confirm-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(137, 180, 250, 0.4) 0%, rgba(180, 190, 254, 0.4) 100%);
  }

  .confirm-btn.danger {
    background: rgba(243, 139, 168, 0.2);
    border-color: rgba(243, 139, 168, 0.4);
    color: #f38ba8;
  }

  .confirm-btn.danger:hover:not(:disabled) {
    background: rgba(243, 139, 168, 0.3);
  }

  .confirm-btn:disabled,
  .cancel-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(137, 180, 250, 0.3);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .confirm-btn.danger .btn-spinner {
    border-color: rgba(243, 139, 168, 0.3);
    border-top-color: #f38ba8;
  }

  /* Toast */
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 20px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    animation: slideInUp 0.3s ease-out;
    z-index: 1001;
  }

  @keyframes slideInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .toast.success {
    background: rgba(166, 227, 161, 0.2);
    border: 1px solid rgba(166, 227, 161, 0.4);
    color: #a6e3a1;
  }

  .toast-icon {
    font-weight: bold;
  }

  .toast-message {
    font-size: 13px;
  }
</style>
