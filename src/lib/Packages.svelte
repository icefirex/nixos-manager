<script>
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";

  let { pendingPackage = null, onPendingConsumed = () => {} } = $props();

  let packages = $state({
    system: [],
    user: [],
    homeManager: []
  });
  let loading = $state(true);
  let error = $state(null);
  let searchQuery = $state("");
  let activeTab = $state("system");
  let sourceMode = $state("config"); // "config" or "live"

  // Package detail state
  let selectedPackage = $state(null);
  let packageInfo = $state(null);
  let loadingInfo = $state(false);

  // Duplicates
  let duplicates = $state([]);
  let showDuplicatesOnly = $state(false);
  let removingPkg = $state(null);

  $effect(() => {
    function onPackagesChanged() {
      loadPackages();
    }
    window.addEventListener('packages-changed', onPackagesChanged);
    return () => {
      window.removeEventListener('packages-changed', onPackagesChanged);
    };
  });

  $effect(() => {
    if (!searchQuery && selectedPackage &&
      !packages.system.includes(selectedPackage) &&
      !packages.user.includes(selectedPackage) &&
      !packages.homeManager.includes(selectedPackage)) {
      selectedPackage = null;
      packageInfo = null;
    }
  });

  $effect(() => {
    function onExternalSelect(e) {
      const detail = e.detail;
      const pkg = typeof detail === 'object' ? detail.pkg : detail;
      const source = typeof detail === 'object' ? detail.source : null;

      if (source === 'live') {
        sourceMode = 'live';
        duplicates = [];
        searchQuery = pkg;
        loadPackages().then(() => {
          selectedPackage = pkg;
          packageInfo = null;
          loadingInfo = true;
          window.electronAPI.getPackageInfo(pkg).then(info => {
            packageInfo = info;
            loadingInfo = false;
          }).catch(() => {
            packageInfo = null;
            loadingInfo = false;
          });
          setTimeout(() => {
            document.querySelector('.package-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 200);
        });
        return;
      }

      // Default: ensure we're in config mode
      if (sourceMode !== 'config') {
        sourceMode = 'config';
        loadPackages();
      }

      // Find which tab this package belongs to
      const allTabs = { system: 'system', user: 'user', homeManager: 'homeManager' };
      let foundTab = null;
      for (const [tabId, tabKey] of Object.entries(allTabs)) {
        if (packages[tabKey]?.includes(pkg)) {
          foundTab = tabId;
          break;
        }
      }

      if (foundTab) {
        // Package is in the declared list — switch to correct tab and select it
        activeTab = foundTab;
        searchQuery = "";
        showDuplicatesOnly = false;
        selectedPackage = pkg;
        packageInfo = null;
        loadingInfo = true;
        window.electronAPI.getPackageInfo(pkg).then(info => {
          packageInfo = info;
          loadingInfo = false;
        }).catch(() => {
          packageInfo = null;
          loadingInfo = false;
        });
        setTimeout(() => {
          document.querySelector('.package-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      } else {
        // Not in any tab — use filter to show it's not found
        searchQuery = pkg;
        selectedPackage = pkg;
        packageInfo = null;
        loadingInfo = true;
        window.electronAPI.getPackageInfo(pkg).then(info => {
          packageInfo = info;
          loadingInfo = false;
        }).catch(() => {
          packageInfo = null;
          loadingInfo = false;
        });
        setTimeout(() => {
          document.querySelector('.package-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      }
    }
    window.addEventListener('select-package', onExternalSelect);
    return () => window.removeEventListener('select-package', onExternalSelect);
  });

  let duplicateSet = $derived(new Set(duplicates.map(d => d.pkgname)));

  function isDuplicate(pkg) {
    return duplicateSet.has(pkg);
  }

  const tabs = [
    { id: "system", label: "System" },
    { id: "user", label: "User Profile" },
    { id: "homeManager", label: "Home Manager" }
  ];

  // Derived filtered packages for each category - ensures reactivity
  let filteredByCategory = $derived.by(() => {
    const result = {};
    const q = searchQuery.trim().toLowerCase();
    for (const tab of tabs) {
      let list = packages[tab.id] || [];
      if (showDuplicatesOnly && sourceMode === 'config') {
        list = list.filter(pkg => duplicateSet.has(pkg));
      }
      if (!q) {
        result[tab.id] = list;
      } else {
        result[tab.id] = list.filter(pkg => pkg.toLowerCase().includes(q));
      }
    }
    return result;
  });

  // Determine the best active tab (auto-switch if current becomes empty)
  let effectiveTab = $derived.by(() => {
    const filterActive = searchQuery.trim() || (showDuplicatesOnly && sourceMode === 'config');

    if (!filterActive) return activeTab;

    // If current tab has results, stay there
    if (filteredByCategory[activeTab]?.length > 0) return activeTab;

    // Find first tab with results
    for (const tab of tabs) {
      if (filteredByCategory[tab.id]?.length > 0) return tab.id;
    }

    return activeTab;
  });

  // Auto-select when filter narrows to exactly one result
  let totalFiltered = $derived(
    tabs.reduce((sum, tab) => sum + (filteredByCategory[tab.id]?.length || 0), 0)
  );

  $effect(() => {
    totalFiltered;
    effectiveTab;
    if (totalFiltered === 1 && searchQuery.trim() && !loading) {
      const list = filteredByCategory[effectiveTab];
      if (list?.length === 1 && selectedPackage !== list[0]) {
        selectedPackage = list[0];
        packageInfo = null;
        loadingInfo = true;
        window.electronAPI.getPackageInfo(list[0]).then(info => {
          packageInfo = info;
          loadingInfo = false;
        }).catch(() => {
          packageInfo = null;
          loadingInfo = false;
        });
      }
    }
  });

  async function loadPackages() {
    loading = true;
    error = null;
    selectedPackage = null;
    packageInfo = null;
    try {
      if (sourceMode === "live") {
        packages = await window.electronAPI.getLivePackages();
      } else {
        packages = await window.electronAPI.getPackages();
      }
    } catch (e) {
      error = e.message;
      console.error("Failed to load packages:", e);
    } finally {
      loading = false;
    }
  }

  async function loadDuplicates() {
    try {
      const result = await window.electronAPI.packagesGetDuplicates();
      if (result.success) {
        duplicates = result.duplicates;
      }
    } catch (e) {
      console.error('Failed to load duplicates:', e);
    }
  }

  $effect(() => {
    loadPackages();
    loadDuplicates();
  });

  // Reload when source mode changes
  function switchSource(mode) {
    if (mode !== sourceMode) {
      sourceMode = mode;
      loadPackages();
      if (sourceMode === 'config') loadDuplicates();
      else duplicates = [];
    }
  }

  async function removeLocation(relPath) {
    if (!selectedPackage) return;
    removingPkg = selectedPackage;
    try {
      const findResult = await window.electronAPI.discoverFindPackage(selectedPackage);
      if (!findResult.success || findResult.files.length === 0) {
        alert(`Package '${selectedPackage}' not found in any config file`);
        return;
      }
      const match = findResult.files.find(f => f.relativePath === relPath || f.path.endsWith(relPath));
      if (!match) {
        alert(`Could not find file: ${relPath}`);
        return;
      }
      const result = await window.electronAPI.discoverRemovePackage({
        pkgname: selectedPackage,
        filePath: match.path
      });
      if (result.success) {
        const entry = { pkgname: selectedPackage, action: 'removed', file: match.path, type: activeTab };
        window.electronAPI.historyAdd(entry);
        await Promise.all([loadPackages(), loadDuplicates()]);
        packageInfo = null;
        selectedPackage = null;
        window.dispatchEvent(new CustomEvent('history-updated'));
        window.dispatchEvent(new CustomEvent('pending-changes'));
        window.dispatchEvent(new CustomEvent('packages-changed'));
      } else {
        alert(result.error || 'Failed to remove package');
      }
    } catch (e) {
      alert(e.message || 'Failed to remove package');
    } finally {
      removingPkg = null;
    }
  }

  // Track which package is currently loading
  let loadingPackage = $state(null);

  // Load package details
  async function selectPackage(pkg) {
    if (selectedPackage === pkg) {
      // Toggle off if clicking same package
      selectedPackage = null;
      packageInfo = null;
      return;
    }

    // Expand immediately with loading state
    selectedPackage = pkg;
    packageInfo = null; // null means loading
    loadingInfo = true;

    // Force UI update before API call
    await tick();

    try {
      // Run fetch and minimum delay in parallel so skeleton shows for at least 500ms
      const [info] = await Promise.all([
        window.electronAPI.getPackageInfo(pkg),
        new Promise(resolve => setTimeout(resolve, 500))
      ]);
      // Only update if this is still the selected package
      if (selectedPackage === pkg) {
        packageInfo = info;
      }
    } catch (e) {
      console.error("Failed to load package info:", e);
      if (selectedPackage === pkg) {
        packageInfo = { name: pkg, error: e.message };
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
    return packages[tab]?.length || 0;
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

  function getSourceInfo(tab) {
    if (sourceMode === "config") {
      switch (tab) {
        case "system": return "environment.systemPackages";
        case "user": return "users.users.*.packages";
        case "homeManager": return "home.packages";
      }
    } else {
      switch (tab) {
        case "system": return "/run/current-system/sw";
        case "user": return "/etc/profiles/per-user/*";
        case "homeManager": return "~/.nix-profile";
      }
    }
    return "";
  }

  function getEmptyMessage(tab) {
    switch (tab) {
      case "system": return "No system packages found";
      case "user": return "No user packages found";
      case "homeManager": return "No home-manager packages found";
      default: return "No packages found";
    }
  }
</script>

<div class="packages-page">
  <div class="page-header">
    <div class="header-top">
      <div>
        <h1>Installed Packages</h1>
        <p class="subtitle">
          {#if sourceMode === "config"}
            Packages defined in your NixOS configuration files
          {:else}
            Packages currently installed on your system
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

  {#if sourceMode === 'config' && duplicates.length > 0}
    <button class="duplicates-banner" class:active={showDuplicatesOnly} onclick={() => showDuplicatesOnly = !showDuplicatesOnly}>
      <Icon name="AlertTriangle" size={14} />
      <span>{duplicates.length} duplicate{duplicates.length !== 1 ? 's' : ''} found across files</span>
      <span class="duplicates-hint">{showDuplicatesOnly ? 'Show all' : 'Show duplicates only'}</span>
    </button>
  {/if}

  <div class="search-bar">
    <span class="search-icon"><Icon name="Search" size={16} /></span>
    <input
      type="text"
      placeholder="Search packages..."
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
      {@const dupActive = showDuplicatesOnly && sourceMode === 'config'}
      {#if total > 0 || !searchQuery.trim() || !dupActive}
        {#if (!searchQuery.trim() && !dupActive) || filtered > 0}
          <button
            class="tab"
            class:active={effectiveTab === tab.id}
            class:disabled={dupActive && filtered === 0}
            disabled={dupActive && filtered === 0}
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
    <button class="refresh-btn" onclick={loadPackages} disabled={loading}>
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
      <button onclick={loadPackages}>Retry</button>
    </div>
  {:else}
    <div class="packages-content">
      <div class="section-header">
        <h2>{tabs.find(t => t.id === effectiveTab)?.label || "Packages"}</h2>
        <span class="info">{getSourceInfo(effectiveTab)}</span>
      </div>
      <div class="package-list">
        {#if selectedPackage && searchQuery && !packages.system.includes(selectedPackage) && !packages.user.includes(selectedPackage) && !packages.homeManager.includes(selectedPackage)}
          <div class="package-item-wrapper external">
            <div class="external-pkg-header">
              <span class="package-name">{selectedPackage}</span>
              <span class="external-badge">not in config</span>
              <button class="close-external" onclick={() => { selectedPackage = null; packageInfo = null; }}>
                <Icon name="X" size={14} />
              </button>
            </div>
            <div class="package-detail">
              {@render packageDetailPanel()}
            </div>
          </div>
        {/if}
        {#each filteredByCategory[effectiveTab] || [] as pkg}
          <div class="package-item-wrapper">
              <button
                class="package-item"
                class:selected={selectedPackage === pkg}
                class:duplicate={sourceMode === 'config' && isDuplicate(pkg)}
                onclick={() => selectPackage(pkg)}
              >
                <span class="package-name">{pkg}</span>
                {#if sourceMode === 'config' && isDuplicate(pkg)}
                  <span class="dup-badge" title="Defined in multiple files"><Icon name="AlertTriangle" size={12} /></span>
                {/if}
                <span class="expand-icon">{#if selectedPackage === pkg}<Icon name="ChevronDown" size={14} />{:else}<Icon name="ChevronRight" size={14} />{/if}</span>
              </button>
            {#if selectedPackage === pkg}
              <div class="package-detail">
                {@render packageDetailPanel()}
              </div>
            {/if}
          </div>
        {:else}
          <div class="empty">
            {searchQuery ? "No matching packages" : getEmptyMessage(effectiveTab)}
          </div>
        {/each}
      </div>
    </div>

    {#if searchQuery}
      <div class="search-results-info">
        Showing {getTotalFilteredCount()} of {getTabCount("system") + getTabCount("user") + getTabCount("homeManager")} packages
      </div>
    {/if}
  {/if}
</div>

{#snippet packageDetailPanel()}
  <div class="detail-content">
    {#if !packageInfo}
      <!-- Skeleton loading state -->
      <div class="skeleton-loading">
        <div class="skeleton-header">
          <div class="skeleton-title"></div>
          <div class="skeleton-badge"></div>
        </div>
        <div class="skeleton-description"></div>
        <div class="skeleton-grid">
          <div class="skeleton-field"></div>
          <div class="skeleton-field"></div>
        </div>
        <div class="skeleton-programs"></div>
        <div class="skeleton-actions">
          <div class="skeleton-btn"></div>
          <div class="skeleton-btn"></div>
          <div class="skeleton-btn"></div>
        </div>
      </div>
    {:else if packageInfo.error}
      <div class="detail-error">Failed to load: {packageInfo.error}</div>
    {:else}
      <div class="detail-header">
        <div class="detail-title">
          <h3>{packageInfo.name}</h3>
          {#if packageInfo.version}
            <span class="version-badge">{packageInfo.version}</span>
          {/if}
        </div>
        {#if packageInfo.description}
          <p class="detail-description">{packageInfo.description}</p>
        {/if}
      </div>

      <div class="detail-grid">
        {#if packageInfo.license}
          <div class="detail-field">
            <span class="field-label">License</span>
            <span class="field-value">{packageInfo.license}</span>
          </div>
        {/if}

        {#if packageInfo.mainProgram}
          <div class="detail-field">
            <span class="field-label">Main Program</span>
            <span class="field-value mono">{packageInfo.mainProgram}</span>
          </div>
        {/if}

        {#if packageInfo.programs && packageInfo.programs.length > 0}
          <div class="detail-field full-width">
            <span class="field-label">Programs Provided ({packageInfo.programs.length})</span>
            <div class="programs-list">
              {#each packageInfo.programs as prog}
                <span class="program-badge">{prog}</span>
              {/each}
            </div>
          </div>
        {/if}

        {#if packageInfo.platforms && packageInfo.platforms.length > 0}
          <div class="detail-field full-width">
            <span class="field-label">Platforms</span>
            <div class="platforms-list">
              {#each packageInfo.platforms as platform}
                <span class="platform-badge">{platform}</span>
              {/each}
            </div>
          </div>
        {/if}

        {#if packageInfo.configLocations && packageInfo.configLocations.length > 0}
          {@const dupEntry = duplicates.find(d => d.pkgname === selectedPackage)}
          <div class="detail-field full-width">
            <span class="field-label">Defined In ({packageInfo.configLocations.length})</span>
            {#if dupEntry}
              {@const locCount = packageInfo.configLocations.length}
              {@const multiFile = new Set(dupEntry.files.map(f => f.file)).size > 1}
              <p class="dup-suggestion">
                <Icon name="AlertTriangle" size={12} />
                {#if dupEntry.crossUser}
                  Defined for {dupEntry.users.join(', ')} — consider elevating to environment.systemPackages
                {:else if multiFile}
                  Defined in {locCount} locations — consider consolidating to a single declaration
                {:else}
                  Duplicate entry in same file — remove one
                {/if}
              </p>
            {/if}
            <div class="config-locations-list">
              {#each packageInfo.configLocations as loc, locIdx}
                {@const locParts = loc.split(':')}
                {@const locFile = locParts.slice(0, -1).join(':')}
                {@const locLine = locParts.length > 1 ? locParts[locParts.length - 1] : ''}
                <div class="config-location-row">
                  <span class="config-location-path">{locFile}</span>
                  <div class="location-row-right">
                    {#if locLine}
                      <span class="line-pill">line: {locLine}</span>
                    {/if}
                    <button class="remove-loc-btn" title="Remove this definition"
                      onclick={() => removeLocation(locFile)} disabled={removingPkg === selectedPackage}>
                      <Icon name="Trash2" size={12} />
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="detail-actions">
        {#if packageInfo.homepage}
          <button class="action-btn" onclick={() => openUrl(packageInfo.homepage)}>
            <Icon name="Globe" size={12} /> Homepage
          </button>
        {/if}
        <button class="action-btn" onclick={() => openUrl(`https://search.nixos.org/packages?channel=unstable&show=${packageInfo.name}&query=${packageInfo.name}`)}>
          <Icon name="Search" size={12} /> NixOS Search
        </button>
        {#if packageInfo.position}
          <button class="action-btn" onclick={() => openUrl(`https://github.com/NixOS/nixpkgs/blob/master/${packageInfo.position.replace(/:.*$/, '')}`)}>
            <Icon name="Package" size={12} /> Source
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .pending-changes {
    margin: 0 24px 8px;
    border: 1px solid rgba(249, 226, 175, 0.25);
    border-radius: 8px;
    background: rgba(249, 226, 175, 0.05);
    overflow: hidden;
  }

  .pending-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    color: #f9e2af;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }

  .pending-toggle span {
    flex: 1;
  }

  .pending-details {
    padding: 0 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .pending-info {
    font-size: 12px;
    color: #cdd6f4;
    line-height: 1.6;
    opacity: 0.85;
  }

  .pending-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pending-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .pending-label.add { color: #a6e3a1; }
  .pending-label.remove { color: #f38ba8; }

  .pending-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .pending-pkg {
    font-family: monospace;
    font-size: 11px;
    padding: 2px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: #cdd6f4;
  }

  .pending-more {
    font-size: 11px;
    color: #6c7086;
    align-self: center;
  }

  .packages-page {
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
    background: linear-gradient(135deg, rgba(137, 180, 250, 0.2) 0%, rgba(180, 190, 254, 0.2) 100%);
    color: #89b4fa;
    box-shadow: 0 2px 8px rgba(137, 180, 250, 0.15);
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
    border-color: rgba(137, 180, 250, 0.5);
    box-shadow: 0 0 0 2px rgba(137, 180, 250, 0.1);
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
    background: linear-gradient(135deg, rgba(137, 180, 250, 0.2) 0%, rgba(180, 190, 254, 0.2) 100%);
    border-color: rgba(137, 180, 250, 0.4);
    color: #89b4fa;
  }

  .tab.disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }

  .count {
    background: rgba(0, 0, 0, 0.2);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .tab.active .count {
    background: rgba(137, 180, 250, 0.2);
  }

  .count.filtered {
    background: rgba(249, 226, 175, 0.3);
    color: #f9e2af;
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

  .packages-content {
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

  .package-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 8px;
  }

  .package-list::-webkit-scrollbar {
    width: 8px;
  }

  .package-list::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }

  .package-list::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }

  .package-list::-webkit-scrollbar-thumb:hover {
    background: rgba(88, 91, 112, 0.8);
  }

  .package-item-wrapper {
    display: flex;
    flex-direction: column;
  }

  .package-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: rgba(49, 50, 68, 0.3);
    border: 1px solid transparent;
    border-radius: 8px;
    transition: all 0.15s;
    cursor: pointer;
    width: 100%;
    text-align: left;
    color: inherit;
    position: relative;
    overflow: hidden;
  }

  .loading-bar {
    position: absolute;
    top: 0;
    left: 0;
    height: 4px;
    width: 40%;
    background: linear-gradient(
      90deg,
      transparent 0%,
      #89b4fa 30%,
      #b4befe 50%,
      #89b4fa 70%,
      transparent 100%
    );
    box-shadow: 0 0 10px rgba(137, 180, 250, 0.8), 0 0 20px rgba(137, 180, 250, 0.4);
    animation: loading-slide 0.8s ease-in-out infinite;
    border-radius: 2px;
  }

  @keyframes loading-slide {
    0% {
      left: -40%;
    }
    100% {
      left: 100%;
    }
  }

  .package-item:hover {
    background: rgba(49, 50, 68, 0.5);
  }

  .package-item.selected {
    background: rgba(137, 180, 250, 0.15);
    border-color: rgba(137, 180, 250, 0.3);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .package-name {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 13px;
    color: #cdd6f4;
  }

  .expand-icon {
    font-size: 10px;
    color: #6c7086;
    transition: transform 0.2s;
  }

  .package-item.selected .expand-icon {
    color: #89b4fa;
  }

  .package-item.loading {
    background: rgba(137, 180, 250, 0.1);
    border-color: rgba(137, 180, 250, 0.2);
  }

  .package-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .item-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .package-item-wrapper.external {
    margin-bottom: 8px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.02);
  }

  .external-pkg-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--color-border);
  }

  .external-pkg-header .package-name {
    font-family: monospace;
    font-size: 14px;
    font-weight: 600;
    color: #cdd6f4;
  }

  .external-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 10px;
    color: #a6adc8;
    background: rgba(166, 173, 200, 0.1);
    border: 1px solid rgba(166, 173, 200, 0.2);
  }

  .close-external {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: #6c7086;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.1s;
  }

  .close-external:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #cdd6f4;
  }

  .package-detail {
    scroll-margin-top: 80px;
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

  .detail-loading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    color: #6c7086;
    font-size: 13px;
  }

  .mini-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .detail-content {
    padding: 16px 20px;
  }

  .detail-error {
    color: #f38ba8;
    font-size: 13px;
  }

  /* Skeleton loading styles */
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
    width: 180px;
    height: 20px;
    background: linear-gradient(90deg, rgba(69, 71, 90, 0.4) 25%, rgba(88, 91, 112, 0.6) 50%, rgba(69, 71, 90, 0.4) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 4px;
  }

  .skeleton-badge {
    width: 60px;
    height: 20px;
    background: linear-gradient(90deg, rgba(166, 227, 161, 0.15) 25%, rgba(166, 227, 161, 0.3) 50%, rgba(166, 227, 161, 0.15) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 6px;
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

  .skeleton-programs {
    width: 100%;
    height: 32px;
    background: linear-gradient(90deg, rgba(137, 180, 250, 0.1) 25%, rgba(137, 180, 250, 0.2) 50%, rgba(137, 180, 250, 0.1) 75%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s infinite;
    border-radius: 6px;
  }

  .skeleton-actions {
    display: flex;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid rgba(69, 71, 90, 0.3);
  }

  .skeleton-btn {
    width: 100px;
    height: 28px;
    background: linear-gradient(90deg, rgba(69, 71, 90, 0.4) 25%, rgba(88, 91, 112, 0.6) 50%, rgba(69, 71, 90, 0.4) 75%);
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

  .version-badge {
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
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

  .programs-list, .platforms-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .program-badge {
    background: rgba(137, 180, 250, 0.15);
    color: #89b4fa;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-family: monospace;
  }

  .platform-badge {
    background: rgba(180, 190, 254, 0.15);
    color: #b4befe;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
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
    border-color: rgba(137, 180, 250, 0.3);
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

  .duplicates-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 14px;
    margin-bottom: 12px;
    background: rgba(249, 226, 175, 0.1);
    border: 1px solid rgba(249, 226, 175, 0.25);
    border-radius: 8px;
    color: #f9e2af;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }

  .duplicates-banner:hover {
    background: rgba(249, 226, 175, 0.15);
    border-color: rgba(249, 226, 175, 0.4);
  }

  .duplicates-banner.active {
    background: rgba(249, 226, 175, 0.2);
    border-color: rgba(249, 226, 175, 0.5);
  }

  .duplicates-hint {
    margin-left: auto;
    font-size: 11px;
    color: #f9e2af;
    opacity: 0.7;
  }

  .package-item.duplicate {
    border-left: 2px solid #f9e2af;
  }

  .dup-badge {
    display: inline-flex;
    align-items: center;
    color: #f9e2af;
    margin-left: auto;
    margin-right: 4px;
    flex-shrink: 0;
  }

  .dup-suggestion {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0 0;
    padding: 6px 10px;
    font-size: 12px;
    color: #f9e2af;
    background: rgba(249, 226, 175, 0.08);
    border: 1px solid rgba(249, 226, 175, 0.2);
    border-radius: 6px;
  }

  .config-locations-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
  }

  .config-location-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    transition: background 0.1s;
  }

  .location-row-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .line-pill {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    font-size: 10px;
    font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
    color: #9ceaf9;
    background: rgba(156, 234, 249, 0.1);
    border: 1px solid rgba(156, 234, 249, 0.25);
    border-radius: 10px;
    white-space: nowrap;
  }

  .config-location-row:hover {
    background: rgba(49, 50, 68, 0.6);
    border-color: rgba(69, 71, 90, 0.5);
  }

  .config-location-path {
    flex: 1;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: #a6adc8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .remove-loc-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: rgba(243, 139, 168, 0.1);
    border: 1px solid rgba(243, 139, 168, 0.2);
    border-radius: 4px;
    color: #f38ba8;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
  }

  .remove-loc-btn:hover:not(:disabled) {
    background: rgba(243, 139, 168, 0.2);
    border-color: rgba(243, 139, 168, 0.4);
  }

  .remove-loc-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .spinner-sm {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(243, 139, 168, 0.3);
    border-top-color: #f38ba8;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    display: inline-block;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
