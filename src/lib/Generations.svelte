<script lang="ts">
  import { tick } from "svelte";

  let generations = $state<any[]>([]);
  let groupedGenerations = $state<any[]>([]);
  let loading = $state(true);
  let error = $state<any>(null);

  // Search index state - using array for reliable Svelte 5 reactivity
  // Each entry: { genNumber, added, removed, changed, fromGen }
  let searchIndexArray = $state<any[]>([]);
  let indexingProgress = $state({ current: 0, total: 0, complete: false });
  let masterSearch = $state("");
  let isIndexing = $state(false);

  // Token used to cancel any in-flight background indexing when a new load starts
  // Plain variable (not $state) — must NOT be reactive; $state here would cause
  // the loadGenerations $effect to subscribe to it via `++indexingToken`, creating
  // an infinite re-run loop (effect_update_depth_exceeded).
  let indexingToken = 0;
  let selectedGeneration = $state<any>(null);
  let generationInfo = $state<any>(null);
  let generationDiff = $state<any>(null);
  let loadingInfo = $state(false);

  // Diff tab state
  let diffTab = $state("changed");
  let diffFilter = $state("");
  let diffPage = $state(0);
  const ITEMS_PER_PAGE = 10;
  const GROUPS_PAGE_SIZE = 25; // UX-07: number of groups to show initially / per "show more"

  // Group expansion state
  let expandedGroups = $state(new Set());
  // UX-07: how many groups are currently visible in the list
  let visibleGroupCount = $state(GROUPS_PAGE_SIZE);

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
        ...entry.added.map((p: any) => p.name),
        ...entry.removed.map((p: any) => p.name),
        ...entry.changed.map((p: any) => p.name)
      ];
      if (allPackages.some(name => name.toLowerCase().includes(query))) {
        matchingGenNumbers.add(entry.genNumber);
      }
    }

    // Filter groups to only include matching generations
    const filtered: any[] = [];
    for (const group of groupedGenerations) {
      const primaryMatches = matchingGenNumbers.has(group.primary.number);
      const matchingIdentical = group.identical.filter((g: any) => matchingGenNumbers.has(g.number));

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

  // UX-07: visible slice of filteredGroups; reset to first page when filter changes
  let visibleGroups = $derived(filteredGroups.slice(0, visibleGroupCount));
  $effect(() => {
    filteredGroups; // track
    visibleGroupCount = GROUPS_PAGE_SIZE;
  });

  // Action state
  let showConfirmDialog = $state(false);
  let confirmAction = $state<any>(null);
  let pendingGeneration = $state<any>(null);
  let isActioning = $state(false);
  let actionError = $state<any>(null);
  let actionSuccess = $state<any>(null);

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
    // Increment token to cancel any running background indexing loop
    const myToken = ++indexingToken;
    try {
      generations = await window.electronAPI.getGenerations();
      // Group identical generations (this also starts building partial index)
      groupedGenerations = await computeGroups(generations);
      // Start background indexing for search — pass token so it can self-cancel
      startBackgroundIndexing(myToken);
    } catch (e: any) {
      error = e.message;
      console.error("Failed to load generations:", e);
    } finally {
      loading = false;
    }
  }

  async function computeGroups(gens: any) {
    if (gens.length === 0) return [];

    const groups: any[] = [];
    const newSearchIndex: any[] = []; // Build array for proper reactivity
    let currentGroup: any = null;

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
        } catch (e: any) {
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

  async function startBackgroundIndexing(token: number) {
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
      // Abort if a newer loadGenerations() call has started
      if (token !== indexingToken) return;

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
        } catch (e: any) {
          // Skip failed diffs
        }
      }

      indexingProgress = { current: i + 1, total, complete: false };
      // Small delay to keep UI responsive
      await new Promise(r => setTimeout(r, 50));
    }

    // Check token once more before marking complete
    if (token !== indexingToken) return;

    // Final update
    searchIndexArray = [...workingIndex];
    indexingProgress = { current: total, total, complete: true };
    isIndexing = false;
  }


  function getSearchMatchInfo(genNumber: number) {
    if (!masterSearch.trim()) return null;

    const entry = searchIndexArray.find(e => e.genNumber === genNumber);
    if (!entry) return null;

    const query = masterSearch.toLowerCase();
    const diff = entry;
    const matches = {
      added: diff.added.filter((p: any) => p.name.toLowerCase().includes(query)),
      removed: diff.removed.filter((p: any) => p.name.toLowerCase().includes(query)),
      changed: diff.changed.filter((p: any) => p.name.toLowerCase().includes(query))
    };

    const total = matches.added.length + matches.removed.length + matches.changed.length;
    return total > 0 ? matches : null;
  }

  $effect(() => {
    loadGenerations();
  });

  function toggleGroup(groupIndex: number) {
    const newSet = new Set(expandedGroups);
    if (newSet.has(groupIndex)) {
      newSet.delete(groupIndex);
    } else {
      newSet.add(groupIndex);
    }
    expandedGroups = newSet;
  }

  async function selectGeneration(gen: any) {
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
          } catch (e: any) {
            console.error("Failed to load diff:", e);
          }
        }
      }
    } catch (e: any) {
      console.error("Failed to load generation info:", e);
      if (selectedGeneration?.number === gen.number) {
        generationInfo = { number: gen.number, error: e.message };
      }
    } finally {
      loadingInfo = false;
    }
  }

  function getFilteredDiffItems(items: any[]) {
    if (!diffFilter.trim()) return items;
    const q = diffFilter.toLowerCase();
    return items.filter(pkg => pkg.name.toLowerCase().includes(q));
  }

  function compareVersions(a: string, b: string): number {
    const pa = a.split(/[.\-+]/).map(Number);
    const pb = b.split(/[.\-+]/).map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  function getPaginatedItems(items: any[]) {
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

  function requestAction(action: any, gen: any) {
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
    } catch (e: any) {
      actionError = e.message;
    } finally {
      isActioning = false;
    }
  }

  function formatDate(dateStr: any) {
    if (!dateStr) return '';
    try {
      const date: Date = new Date(dateStr);
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

  function getRelativeTime(dateStr: any) {
    if (!dateStr) return '';
    try {
      const date: Date = new Date(dateStr);
      const now: Date = new Date();
      const diffMs = now.getTime() - date.getTime();
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
            {@const addedMatches = entry.added.filter((p: any) => p.name.toLowerCase().includes(query))}
            {@const removedMatches = entry.removed.filter((p: any) => p.name.toLowerCase().includes(query))}
            {@const changedMatches = entry.changed.filter((p: any) => p.name.toLowerCase().includes(query))}
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
        {#each visibleGroups as group, groupIndex}
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
        {#if visibleGroupCount < filteredGroups.length}
          <button
            class="show-more-btn"
            onclick={() => visibleGroupCount += GROUPS_PAGE_SIZE}
          >
            Show {Math.min(GROUPS_PAGE_SIZE, filteredGroups.length - visibleGroupCount)} older generations
          </button>
        {/if}
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

{#snippet generationItem(gen: any, isInGroup: any)}
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

{#snippet generationDetailPanel(gen: any)}
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
        ) : (
          (diffTab === "changed" && generationDiff.changed.length > 0) ? "changed" :
          (diffTab === "added" && generationDiff.added.length > 0) ? "added" :
          (diffTab === "removed" && generationDiff.removed.length > 0) ? "removed" :
          (generationDiff.changed.length > 0) ? "changed" :
          (generationDiff.added.length > 0) ? "added" :
          (generationDiff.removed.length > 0) ? "removed" : diffTab
        )}
        {@const activeTab = bestTab}
        <div class="diff-section">
          <div class="diff-header">
            <h4>Changes in this Generation</h4>
            <div class="diff-tabs">
              {#if generationDiff.changed.length > 0}
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
              {#if generationDiff.added.length > 0}
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
              {#if generationDiff.removed.length > 0}
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
                {#if activeTab === "changed"}
                  {@const changeParts = pkg.change.split(',')}
                  {@const versionPart = changeParts[0].trim()}
                  {@const sizePart = changeParts[1]?.trim() || ''}
                  {@const versions = versionPart.split('→').map((v: any) => v.trim())}
                  {@const oldVer = versions[0] || ''}
                  {@const newVer = versions[1] || ''}
                  {@const isUpgrade = compareVersions(newVer, oldVer) > 0}
                  {@const isDowngrade = compareVersions(newVer, oldVer) < 0}
                  <div class="diff-item changed clickable" onclick={() => window.dispatchEvent(new CustomEvent('select-package', { detail: pkg.name }))}>
                    <span class="diff-pkg">{pkg.name}</span>
                    <div class="diff-meta">
                      <span class="version-change">
                        <span class="ver old">{oldVer}</span>
                        <span class="ver-arrow">→</span>
                        <span class="ver new">{newVer}</span>
                      </span>
                      {#if sizePart}
                        <span class="size-badge" class:positive={sizePart.startsWith('+')} class:negative={sizePart.startsWith('-')}>{sizePart}</span>
                      {/if}
                      {#if isUpgrade}
                        <span class="dir-badge up">upgraded</span>
                      {:else if isDowngrade}
                        <span class="dir-badge down">downgraded</span>
                      {/if}
                    </div>
                  </div>
                {:else if activeTab === "added"}
                  {@const addParts = pkg.change.split(',')}
                  {@const addVer = addParts[0].trim().replace('∅ → ', '')}
                  {@const addSize = addParts[1]?.trim() || ''}
                  <div class="diff-item added clickable" onclick={() => window.dispatchEvent(new CustomEvent('select-package', { detail: pkg.name }))}>
                    <span class="diff-pkg">{pkg.name}</span>
                    <div class="diff-meta">
                      <span class="ver new">{addVer}</span>
                      {#if addSize}
                        <span class="size-badge">{addSize}</span>
                      {/if}
                    </div>
                  </div>
                {:else}
                  <div class="diff-item removed clickable" onclick={() => window.dispatchEvent(new CustomEvent('select-package', { detail: pkg.name }))}>
                    <span class="diff-pkg">{pkg.name}</span>
                    <div class="diff-meta">
                      <span class="ver old">{pkg.change.replace('→ ∅', '').trim()}</span>
                    </div>
                  </div>
                {/if}
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
    color: var(--text);
    margin: 0 0 4px 0;
  }

  .subtitle {
    font-size: 14px;
    color: var(--overlay0);
    margin: 0;
  }

  .refresh-btn {
    background: rgba(var(--surface0-rgb), 0.4);
    border: 1px solid rgba(var(--surface1-rgb), 0.3);
    border-radius: 10px;
    padding: 10px 20px;
    color: var(--subtext0);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: rgba(var(--surface0-rgb), 0.6);
    color: var(--text);
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
    background: rgba(var(--surface0-rgb), 0.5);
    border: 1px solid rgba(var(--surface1-rgb), 0.5);
    border-radius: 10px;
    padding: 0 14px;
    transition: all 0.2s;
  }

  .search-input-wrapper:focus-within {
    border-color: rgba(var(--blue-rgb), 0.5);
    box-shadow: 0 0 0 2px rgba(var(--blue-rgb), 0.1);
  }

  .search-icon {
    font-size: 14px;
    margin-right: 10px;
    color: var(--overlay0);
  }

  .indexing-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(var(--blue-rgb), 0.3);
    border-top-color: var(--blue);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .search-input-wrapper input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 14px;
    padding: 12px 0;
  }

  .search-input-wrapper input::placeholder {
    color: var(--overlay0);
  }

  .search-input-wrapper input:disabled {
    cursor: not-allowed;
  }

  .clear-search {
    width: 20px;
    height: 20px;
    border: none;
    background: rgba(var(--red-rgb), 0.2);
    color: var(--red);
    border-radius: 50%;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .clear-search:hover {
    background: rgba(var(--red-rgb), 0.3);
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
    background: rgba(var(--surface0-rgb), 0.5);
    border-radius: 2px;
    overflow: hidden;
  }

  .indexing-progress {
    height: 100%;
    background: linear-gradient(90deg, var(--blue), var(--lavender));
    border-radius: 2px;
    transition: width 0.1s ease-out;
  }

  .indexing-text {
    font-size: 11px;
    color: var(--overlay0);
    min-width: 50px;
    text-align: right;
  }

  .search-results-count {
    display: block;
    margin-top: 8px;
    font-size: 12px;
    color: var(--blue);
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
    color: var(--blue);
    min-width: 40px;
  }

  .match-pkg {
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 10px;
  }

  .match-pkg.added {
    background: rgba(var(--green-rgb), 0.2);
    color: var(--green);
  }

  .match-pkg.removed {
    background: rgba(var(--red-rgb), 0.2);
    color: var(--red);
  }

  .match-pkg.changed {
    background: rgba(var(--yellow-rgb), 0.2);
    color: var(--yellow);
  }

  .loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--overlay0);
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(var(--blue-rgb), 0.2);
    border-top-color: var(--blue);
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
    color: var(--red);
    text-align: center;
  }

  .error-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(var(--red-rgb), 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 12px;
  }

  .error button {
    margin-top: 16px;
    background: rgba(var(--red-rgb), 0.2);
    border: 1px solid rgba(var(--red-rgb), 0.3);
    color: var(--red);
    padding: 8px 20px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .error button:hover {
    background: rgba(var(--red-rgb), 0.3);
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
    color: var(--text);
    margin: 0;
  }

  .section-header .info {
    font-size: 12px;
    color: var(--overlay0);
    background: rgba(var(--surface0-rgb), 0.4);
    padding: 2px 8px;
    border-radius: 4px;
  }

  .section-header .info.grouped {
    background: rgba(var(--blue-rgb), 0.15);
    color: var(--blue);
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
    background: rgba(var(--surface0-rgb), 0.3);
    border-radius: 4px;
  }

  .generation-list::-webkit-scrollbar-thumb {
    background: rgba(var(--surface1-rgb), 0.8);
    border-radius: 4px;
  }

  .generation-list::-webkit-scrollbar-thumb:hover {
    background: rgba(var(--surface2-rgb), 0.8);
  }

  .show-more-btn {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 8px 16px;
    background: rgba(var(--surface0-rgb), 0.5);
    border: 1px solid rgba(var(--surface2-rgb), 0.4);
    border-radius: 6px;
    color: var(--subtext0);
    font-size: 13px;
    cursor: pointer;
    text-align: center;
    transition: background 0.15s, color 0.15s;
  }
  .show-more-btn:hover {
    background: rgba(var(--surface1-rgb), 0.7);
    color: var(--text);
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
    background: rgba(var(--blue-rgb), 0.08);
    border: 1px dashed rgba(var(--blue-rgb), 0.3);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
    text-align: left;
    color: inherit;
  }

  .group-header:hover {
    background: rgba(var(--blue-rgb), 0.12);
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
    color: var(--blue);
    width: 16px;
  }

  .group-range {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 13px;
    color: var(--blue);
  }

  .group-count {
    font-size: 11px;
    color: var(--overlay0);
    background: rgba(var(--surface0-rgb), 0.4);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .group-date {
    font-size: 12px;
    color: var(--overlay0);
  }

  .group-contents {
    border: 1px dashed rgba(var(--blue-rgb), 0.3);
    border-top: none;
    border-radius: 0 0 8px 8px;
    padding: 8px;
    background: rgba(var(--blue-rgb), 0.04);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .generation-item-wrapper {
    display: flex;
    flex-direction: column;
  }

  .generation-item-wrapper.in-group .generation-item {
    background: rgba(var(--surface0-rgb), 0.2);
  }

  .generation-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    background: rgba(var(--surface0-rgb), 0.3);
    border: 1px solid transparent;
    border-radius: 8px;
    transition: all 0.15s;
    cursor: pointer;
    width: 100%;
    text-align: left;
    color: inherit;
  }

  .generation-item:hover {
    background: rgba(var(--surface0-rgb), 0.5);
  }

  .generation-item.selected {
    background: rgba(var(--blue-rgb), 0.15);
    border-color: rgba(var(--blue-rgb), 0.3);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .generation-item.current {
    border-left: 3px solid var(--green);
  }

  .generation-item.current.selected {
    border-left-color: var(--green);
  }

  .generation-item.has-match {
    background: rgba(var(--blue-rgb), 0.1);
    border-color: rgba(var(--blue-rgb), 0.2);
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
    background: var(--green);
    box-shadow: 0 0 8px rgba(var(--green-rgb), 0.6);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .number {
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  .current-badge {
    background: rgba(var(--green-rgb), 0.2);
    color: var(--green);
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
    color: var(--subtext0);
  }

  .date-relative {
    font-size: 12px;
    color: var(--overlay0);
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
    background: rgba(var(--green-rgb), 0.2);
    color: var(--green);
  }

  .match-badge.removed {
    background: rgba(var(--red-rgb), 0.2);
    color: var(--red);
  }

  .match-badge.changed {
    background: rgba(var(--yellow-rgb), 0.2);
    color: var(--yellow);
  }

  .expand-icon {
    font-size: 12px;
    color: var(--overlay0);
    transition: transform 0.2s;
  }

  .generation-item.selected .expand-icon {
    color: var(--blue);
  }

  .generation-detail {
    background: rgba(var(--base-rgb), 0.8);
    border: 1px solid rgba(var(--blue-rgb), 0.3);
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
    color: var(--red);
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
    color: var(--overlay0);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .field-value {
    font-size: 13px;
    color: var(--text);
  }

  .field-value.mono {
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }

  .field-value.revision {
    font-size: 12px;
    background: rgba(var(--yellow-rgb), 0.1);
    padding: 4px 8px;
    border-radius: 4px;
    color: var(--yellow);
  }

  .field-value.path {
    font-size: 11px;
    color: var(--overlay0);
    word-break: break-all;
  }

  /* Diff section with tabs */
  .diff-section {
    margin-bottom: 16px;
    padding: 12px;
    background: rgba(var(--surface0-rgb), 0.3);
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
    color: var(--text);
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
    background: rgba(var(--surface0-rgb), 0.5);
    border-radius: 6px;
    color: var(--overlay0);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .diff-tab:hover {
    background: rgba(var(--surface0-rgb), 0.8);
    color: var(--subtext0);
  }

  .diff-tab.active {
    background: rgba(var(--blue-rgb), 0.2);
    color: var(--blue);
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
    background: rgba(var(--green-rgb), 0.2);
    color: var(--green);
  }

  .tab-count.removed {
    background: rgba(var(--red-rgb), 0.2);
    color: var(--red);
  }

  .tab-count.changed {
    background: rgba(var(--yellow-rgb), 0.2);
    color: var(--yellow);
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
    border: 1px solid rgba(var(--surface1-rgb), 0.5);
    border-radius: 6px;
    background: rgba(var(--base-rgb), 0.6);
    color: var(--text);
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
  }

  .diff-filter input:focus {
    border-color: rgba(var(--blue-rgb), 0.5);
  }

  .diff-filter input::placeholder {
    color: var(--overlay0);
  }

  .clear-filter {
    width: 20px;
    height: 20px;
    border: none;
    background: rgba(var(--red-rgb), 0.2);
    color: var(--red);
    border-radius: 50%;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .clear-filter:hover {
    background: rgba(var(--red-rgb), 0.3);
  }

  .diff-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .diff-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 4px;
    gap: 12px;
  }

  .diff-item.clickable {
    cursor: pointer;
    transition: background 0.1s;
  }

  .diff-item.clickable:hover {
    background: rgba(var(--white-rgb), 0.06);
  }

  .diff-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .diff-item.added {
    background: rgba(var(--green-rgb), 0.1);
  }

  .diff-item.removed {
    background: rgba(var(--red-rgb), 0.1);
  }

  .diff-item.changed {
    background: rgba(var(--yellow-rgb), 0.1);
  }

  .diff-pkg {
    font-family: monospace;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-change {
    color: var(--overlay0);
    font-family: monospace;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .version-change {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: monospace;
    font-size: 11px;
    flex-shrink: 0;
  }

  .ver.old {
    color: var(--overlay0);
    text-decoration: line-through;
    opacity: 0.8;
  }

  .ver.new {
    color: var(--green);
    font-weight: 600;
  }

  .ver-arrow {
    color: var(--overlay0);
    font-size: 10px;
  }

  .size-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 10px;
    font-family: monospace;
    white-space: nowrap;
    color: var(--text);
    background: rgba(var(--text-rgb), 0.08);
  }

  .size-badge.positive {
    color: var(--red);
    background: rgba(var(--red-rgb), 0.12);
  }

  .size-badge.negative {
    color: var(--green);
    background: rgba(var(--green-rgb), 0.12);
  }

  .dir-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }

  .dir-badge.up {
    color: var(--green);
    background: rgba(var(--green-rgb), 0.15);
  }

  .dir-badge.down {
    color: var(--yellow);
    background: rgba(var(--yellow-rgb), 0.15);
  }

  .diff-empty, .diff-empty-state {
    color: var(--overlay0);
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
    border-top: 1px solid rgba(var(--surface1-rgb), 0.3);
  }

  .page-btn {
    padding: 4px 12px;
    border: 1px solid rgba(var(--surface1-rgb), 0.3);
    background: rgba(var(--surface0-rgb), 0.4);
    border-radius: 4px;
    color: var(--subtext0);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .page-btn:hover:not(:disabled) {
    background: rgba(var(--surface0-rgb), 0.6);
    color: var(--text);
  }

  .page-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-info {
    font-size: 11px;
    color: var(--overlay0);
  }

  .detail-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid rgba(var(--surface1-rgb), 0.3);
    align-items: center;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: rgba(var(--surface0-rgb), 0.5);
    border: 1px solid rgba(var(--surface1-rgb), 0.3);
    border-radius: 6px;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover {
    background: rgba(var(--surface0-rgb), 0.8);
    border-color: rgba(var(--blue-rgb), 0.3);
  }

  .action-btn.primary {
    background: linear-gradient(135deg, rgba(var(--blue-rgb), 0.3) 0%, rgba(var(--lavender-rgb), 0.3) 100%);
    border-color: rgba(var(--blue-rgb), 0.4);
    color: var(--blue);
  }

  .action-btn.primary:hover {
    background: linear-gradient(135deg, rgba(var(--blue-rgb), 0.4) 0%, rgba(var(--lavender-rgb), 0.4) 100%);
  }

  .action-btn.danger {
    color: var(--red);
    margin-left: auto;
  }

  .action-btn.danger:hover {
    background: rgba(var(--red-rgb), 0.15);
    border-color: rgba(var(--red-rgb), 0.3);
  }

  .current-note {
    font-size: 13px;
    color: var(--green);
    font-style: italic;
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--overlay0);
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
    background: linear-gradient(90deg, rgba(var(--surface1-rgb), 0.4) 25%, rgba(var(--surface2-rgb), 0.6) 50%, rgba(var(--surface1-rgb), 0.4) 75%);
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
    border-top: 1px solid rgba(var(--surface1-rgb), 0.3);
  }

  .skeleton-btn {
    width: 100px;
    height: 32px;
    background: linear-gradient(90deg, rgba(var(--surface1-rgb), 0.4) 25%, rgba(var(--surface2-rgb), 0.6) 50%, rgba(var(--surface1-rgb), 0.4) 75%);
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
    background: rgba(var(--black-rgb), 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .modal {
    background: var(--base);
    border: 1px solid rgba(var(--surface1-rgb), 0.5);
    border-radius: 16px;
    padding: 24px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 20px 60px rgba(var(--black-rgb), 0.5);
  }

  .modal h3 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 8px 0;
  }

  .modal-description {
    font-size: 14px;
    color: var(--subtext0);
    margin: 0 0 16px 0;
    line-height: 1.5;
  }

  .modal-gen-info {
    background: rgba(var(--surface0-rgb), 0.4);
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
    color: var(--blue);
  }

  .modal-gen-date {
    font-size: 12px;
    color: var(--overlay0);
  }

  .modal-error {
    background: rgba(var(--red-rgb), 0.15);
    border: 1px solid rgba(var(--red-rgb), 0.3);
    border-radius: 8px;
    padding: 12px;
    color: var(--red);
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
    background: rgba(var(--surface0-rgb), 0.5);
    border: 1px solid rgba(var(--surface1-rgb), 0.3);
    border-radius: 8px;
    color: var(--subtext0);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .cancel-btn:hover:not(:disabled) {
    background: rgba(var(--surface0-rgb), 0.8);
    color: var(--text);
  }

  .confirm-btn {
    padding: 10px 20px;
    background: linear-gradient(135deg, rgba(var(--blue-rgb), 0.3) 0%, rgba(var(--lavender-rgb), 0.3) 100%);
    border: 1px solid rgba(var(--blue-rgb), 0.4);
    border-radius: 8px;
    color: var(--blue);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .confirm-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(var(--blue-rgb), 0.4) 0%, rgba(var(--lavender-rgb), 0.4) 100%);
  }

  .confirm-btn.danger {
    background: rgba(var(--red-rgb), 0.2);
    border-color: rgba(var(--red-rgb), 0.4);
    color: var(--red);
  }

  .confirm-btn.danger:hover:not(:disabled) {
    background: rgba(var(--red-rgb), 0.3);
  }

  .confirm-btn:disabled,
  .cancel-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(var(--blue-rgb), 0.3);
    border-top-color: var(--blue);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .confirm-btn.danger .btn-spinner {
    border-color: rgba(var(--red-rgb), 0.3);
    border-top-color: var(--red);
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
    background: rgba(var(--green-rgb), 0.2);
    border: 1px solid rgba(var(--green-rgb), 0.4);
    color: var(--green);
  }

  .toast-icon {
    font-weight: bold;
  }

  .toast-message {
    font-size: 13px;
  }
</style>
