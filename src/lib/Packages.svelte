<script>
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";

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
      const list = packages[tab.id] || [];
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
    if (!searchQuery.trim()) return activeTab;

    // If current tab has results, stay there
    if (filteredByCategory[activeTab]?.length > 0) return activeTab;

    // Find first tab with results
    for (const tab of tabs) {
      if (filteredByCategory[tab.id]?.length > 0) return tab.id;
    }

    return activeTab;
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

  $effect(() => {
    loadPackages();
  });

  // Reload when source mode changes
  function switchSource(mode) {
    if (mode !== sourceMode) {
      sourceMode = mode;
      loadPackages();
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
      {#if total > 0 || !searchQuery.trim()}
        {#if !searchQuery.trim() || filtered > 0}
          <button
            class="tab"
            class:active={effectiveTab === tab.id}
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
        {#each filteredByCategory[effectiveTab] || [] as pkg}
          <div class="package-item-wrapper">
            <button
              class="package-item"
              class:selected={selectedPackage === pkg}
              onclick={() => selectPackage(pkg)}
            >
              <span class="package-name">{pkg}</span>
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
          <div class="detail-field full-width">
            <span class="field-label">Defined In</span>
            <div class="config-locations">
              {#each packageInfo.configLocations as loc}
                <span class="config-location">{loc}</span>
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

  .package-detail {
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
</style>
