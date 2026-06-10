<script>
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";

  let searchQuery = $state('');
  let selectedCategory = $state(null);
  let categories = $state([]);
  let allPackages = $state([]);
  let featuredPackages = $state([]);
  let loading = $state(true);
  let error = $state(null);
  let stats = $state({ totalApps: 0, categories: 0 });
  let selectedPackage = $state(null);
  let packageDetails = $state(null);
  let loadingDetails = $state(false);
  let trying = $state(false);
  let iconCache = $state({});

  // Nixpkgs extended search
  let nixpkgsResults = $state([]);
  let searchingNixpkgs = $state(false);
  let nixpkgsSearched = $state(false);
  let showNixpkgsTab = $state(false);
  // UX-08: delay showing the "Search nixpkgs" button until the user pauses typing
  let showNixpkgsButton = $state(false);
  let _nixpkgsButtonTimer = null;

  // Category display names and icons
  const categoryMeta = {
    'AudioVideo': { name: 'Media', icon: 'Film' },
    'Audio': { name: 'Audio', icon: 'Music' },
    'Video': { name: 'Video', icon: 'Video' },
    'Development': { name: 'Development', icon: 'Code' },
    'Education': { name: 'Education', icon: 'GraduationCap' },
    'Game': { name: 'Games', icon: 'Gamepad2' },
    'Graphics': { name: 'Graphics', icon: 'Palette' },
    'Network': { name: 'Internet', icon: 'Globe' },
    'Office': { name: 'Office', icon: 'FileText' },
    'Science': { name: 'Science', icon: 'Microscope' },
    'Settings': { name: 'Settings', icon: 'Settings' },
    'System': { name: 'System', icon: 'Monitor' },
    'Utility': { name: 'Utilities', icon: 'Wrench' },
  };

  // Filtered packages based on search and category
  let filteredPackages = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    let results = allPackages;

    if (selectedCategory) {
      results = results.filter(pkg => pkg.categories?.includes(selectedCategory));
    }

    if (q) {
      results = results.filter(pkg => {
        const searchable = `${pkg.name} ${pkg.summary || ''} ${pkg.pkgname}`.toLowerCase();
        return searchable.includes(q);
      });
    }

    return results;
  });

  // Category counts
  let categoryCounts = $derived.by(() => {
    const counts = {};
    const q = searchQuery.trim().toLowerCase();

    for (const cat of categories) {
      let pkgs = allPackages.filter(pkg => pkg.categories?.includes(cat));
      if (q) {
        pkgs = pkgs.filter(pkg => {
          const searchable = `${pkg.name} ${pkg.summary || ''} ${pkg.pkgname}`.toLowerCase();
          return searchable.includes(q);
        });
      }
      counts[cat] = pkgs.length;
    }
    return counts;
  });

  // Total count for "All" tab
  let totalCount = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allPackages.length;
    return allPackages.filter(pkg => {
      const searchable = `${pkg.name} ${pkg.summary || ''} ${pkg.pkgname}`.toLowerCase();
      return searchable.includes(q);
    }).length;
  });

  // Initialize
  $effect(() => {
    initDiscover();
  });

  async function initDiscover() {
    loading = true;
    error = null;

    try {
      const result = await window.electronAPI.discoverInit();
      if (!result.success) {
        throw new Error(result.error);
      }
      stats = result.stats;

      // Load categories and all packages
      const [cats, pkgs, featured] = await Promise.all([
        window.electronAPI.discoverGetCategories(),
        window.electronAPI.discoverSearch('', { limit: 2000 }),
        window.electronAPI.discoverFeatured(24)
      ]);

      categories = cats.filter(c => categoryMeta[c]);
      allPackages = pkgs;
      featuredPackages = featured;

      // Preload icons for featured
      for (const pkg of featured) {
        if (pkg.icon?.name) {
          loadIcon(pkg.icon.name);
        }
      }
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function loadIcon(iconName) {
    if (iconCache[iconName]) return;

    try {
      const dataUrl = await window.electronAPI.discoverGetIcon(iconName);
      if (dataUrl) {
        iconCache = { ...iconCache, [iconName]: dataUrl };
      }
    } catch (e) {
      // Ignore icon load errors
    }
  }

  function selectCategory(cat) {
    selectedCategory = cat === selectedCategory ? null : cat;
    showNixpkgsTab = false;
  }

  function selectNixpkgsTab() {
    showNixpkgsTab = true;
    selectedCategory = null;
  }

  // Reset nixpkgs search when query changes; debounce button visibility (UX-08)
  $effect(() => {
    const q = searchQuery; // Track changes
    nixpkgsResults = [];
    nixpkgsSearched = false;
    showNixpkgsTab = false;
    showNixpkgsButton = false;
    if (_nixpkgsButtonTimer) clearTimeout(_nixpkgsButtonTimer);
    if (q.trim()) {
      // Show the button only after 350ms of idle typing
      _nixpkgsButtonTimer = setTimeout(() => {
        showNixpkgsButton = true;
        _nixpkgsButtonTimer = null;
      }, 350);
    }
  });

  async function searchNixpkgs() {
    const q = searchQuery.trim();
    if (!q) return;

    searchingNixpkgs = true;
    try {
      nixpkgsResults = await window.electronAPI.discoverSearchNixpkgs(q);
      nixpkgsSearched = true;
    } catch (e) {
      console.error('Nixpkgs search failed:', e);
      nixpkgsResults = [];
    } finally {
      searchingNixpkgs = false;
    }
  }

  async function openModal(pkg) {
    selectedPackage = pkg;
    loadingDetails = true;
    packageDetails = null;

    try {
      packageDetails = await window.electronAPI.discoverGetDetails(pkg.pkgname);
    } catch (e) {
      console.error('Failed to load details:', e);
    } finally {
      loadingDetails = false;
    }
  }

  function closeModal() {
    selectedPackage = null;
    packageDetails = null;
  }

  function getIconUrl(pkg) {
    if (!pkg.icon?.name) return null;
    return iconCache[pkg.icon.name] || null;
  }

  // Load icons for visible packages
  $effect(() => {
    const pkgsToShow = selectedCategory || searchQuery ? filteredPackages : featuredPackages;
    for (const pkg of pkgsToShow.slice(0, 50)) {
      if (pkg.icon?.name && !iconCache[pkg.icon.name]) {
        loadIcon(pkg.icon.name);
      }
    }
  });

  function openUrl(url) {
    if (url) {
      window.open(url, '_blank');
    }
  }

  let showKillConfirm = $state(false);
  let pendingTryPackage = $state(null);

  async function tryPackage(pkgname) {
    // Check if a process is already running
    const status = await window.electronAPI.discoverIsTrying();
    if (status.running) {
      pendingTryPackage = pkgname;
      showKillConfirm = true;
      return;
    }

    await doTryPackage(pkgname);
  }

  async function doTryPackage(pkgname) {
    trying = true;
    try {
      await window.electronAPI.discoverTryPackage(pkgname);
      // Close modal after launching
      closeModal();
    } catch (e) {
      console.error('Failed to try package:', e);
    } finally {
      trying = false;
    }
  }

  async function confirmKillAndTry() {
    await window.electronAPI.discoverKillTry();
    showKillConfirm = false;
    if (pendingTryPackage) {
      await doTryPackage(pendingTryPackage);
      pendingTryPackage = null;
    }
  }

  function cancelKill() {
    showKillConfirm = false;
    pendingTryPackage = null;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && selectedPackage) {
      closeModal();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="discover-page">
  <div class="page-header">
    <div class="header-top">
      <div>
        <h1>Discover Packages</h1>
        <p class="subtitle">Browse {stats.totalApps} applications from nixpkgs</p>
      </div>
      <button class="refresh-btn" onclick={initDiscover} disabled={loading}>
        {#if loading}<Icon name="Loader" size={14} />{:else}<Icon name="RefreshCw" size={14} />{/if}
      </button>
    </div>
  </div>

  <!-- Search Bar -->
  <div class="search-bar">
    <span class="search-icon"><Icon name="Search" size={16} /></span>
    <input
      type="text"
      placeholder="Search applications..."
      bind:value={searchQuery}
    />
    {#if searchQuery}
      <button class="clear-btn" onclick={() => searchQuery = ''}>×</button>
    {/if}
    {#if searchQuery && showNixpkgsButton && !showNixpkgsTab && !nixpkgsSearched}
      <button class="nixpkgs-search-btn" onclick={searchNixpkgs} disabled={searchingNixpkgs}>
        {#if searchingNixpkgs}
          <span class="spinner-sm"></span>
        {:else}
          <Icon name="Search" size={12} />
        {/if}
        nixpkgs
      </button>
    {/if}
  </div>

  <!-- Category Tabs -->
  <div class="tabs">
    <button
      class="tab"
      class:active={!selectedCategory && !showNixpkgsTab}
      onclick={() => { selectedCategory = null; showNixpkgsTab = false; }}
    >
      All
      <span class="count">{totalCount}</span>
    </button>
    {#each categories as cat}
      {@const count = categoryCounts[cat] || 0}
      {#if count > 0 || !searchQuery}
        <button
          class="tab"
          class:active={selectedCategory === cat && !showNixpkgsTab}
          onclick={() => selectCategory(cat)}
        >
          <span class="cat-icon"><Icon name={categoryMeta[cat]?.icon || 'Package'} size={12} /></span>
          {categoryMeta[cat]?.name || cat}
          <span class="count">{count}</span>
        </button>
      {/if}
    {/each}
    {#if nixpkgsResults.length > 0}
      <button
        class="tab nixpkgs-tab"
        class:active={showNixpkgsTab}
        onclick={selectNixpkgsTab}
      >
        <span class="cat-icon"><Icon name="Package" size={12} /></span>
        Nixpkgs
        <span class="count">{nixpkgsResults.length}</span>
      </button>
    {/if}
  </div>

  <!-- Content -->
  <div class="content-area">
    {#if loading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading applications...</p>
      </div>
    {:else if error}
      <div class="error-state">
        <span class="error-icon"><Icon name="AlertTriangle" size={32} /></span>
        <p>{error}</p>
        <button onclick={initDiscover}>Retry</button>
      </div>
    {:else}
      <div class="section-header">
        <h2>
          {#if showNixpkgsTab}
            Nixpkgs Results
          {:else if selectedCategory}
            {categoryMeta[selectedCategory]?.name || selectedCategory}
          {:else if searchQuery}
            Search Results
          {:else}
            Featured Applications
          {/if}
        </h2>
        <span class="info">
          {#if showNixpkgsTab}
            {nixpkgsResults.length} packages
          {:else}
            {searchQuery || selectedCategory ? filteredPackages.length : featuredPackages.length} applications
          {/if}
        </span>
      </div>

      <div class="card-grid">
        {#if showNixpkgsTab}
          <!-- Nixpkgs tab selected - show only nixpkgs results -->
          {#each nixpkgsResults as pkg}
            <button class="card nixpkgs-card" onclick={() => openModal(pkg)}>
              <div class="card-icon">
                <span class="placeholder-icon"><Icon name="Package" size={24} /></span>
              </div>
              <div class="card-content">
                <span class="card-name">
                  {pkg.name}
                  <span class="nixpkgs-badge">nixpkgs</span>
                </span>
                <span class="card-summary">{pkg.summary || ''}</span>
              </div>
            </button>
          {/each}
        {:else}
          <!-- Normal view - AppStream packages -->
          {#each (searchQuery || selectedCategory ? filteredPackages : featuredPackages) as pkg}
            <button class="card" onclick={() => openModal(pkg)}>
              <div class="card-icon">
                {#if getIconUrl(pkg)}
                  <img src={getIconUrl(pkg)} alt="" />
                {:else}
                  <span class="placeholder-icon"><Icon name="Package" size={24} /></span>
                {/if}
              </div>
              <div class="card-content">
                <span class="card-name">{pkg.name}</span>
                <span class="card-summary">{pkg.summary || ''}</span>
              </div>
            </button>
          {/each}

          <!-- No results message -->
          {#if (searchQuery || selectedCategory) && filteredPackages.length === 0}
            <div class="empty-with-action">
              <p>No applications found in AppStream catalog</p>
            </div>
          {:else if !searchQuery && !selectedCategory && featuredPackages.length === 0}
            <div class="empty">No applications found</div>
          {/if}
        {/if}
      </div>


      {#if !searchQuery && !selectedCategory}
        <div class="browse-hint">
          <p>Select a category or search to browse all {stats.totalApps} applications</p>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Modal -->
{#if selectedPackage}
  <div class="modal-overlay" onclick={closeModal} role="dialog" aria-modal="true">
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <button class="modal-close" onclick={closeModal}>×</button>

      <div class="modal-header">
        <div class="modal-icon">
          {#if getIconUrl(selectedPackage)}
            <img src={getIconUrl(selectedPackage)} alt="" />
          {:else}
            <span class="placeholder-icon-lg"><Icon name="Package" size={32} /></span>
          {/if}
        </div>
        <div class="modal-title">
          <h2>{selectedPackage.name}</h2>
          <span class="modal-pkgname">nixpkgs#{selectedPackage.pkgname}</span>
        </div>
      </div>

      {#if loadingDetails}
        <div class="modal-loading">
          <div class="spinner-sm"></div>
          <span>Loading details...</span>
        </div>
      {:else if packageDetails}
        <div class="modal-body">
          {#if packageDetails.nix?.version}
            <span class="version-badge">{packageDetails.nix.version}</span>
          {/if}

          <p class="modal-description">
            {packageDetails.nix?.description || selectedPackage.summary || 'No description available'}
          </p>

          <div class="modal-meta">
            {#if packageDetails.nix?.license}
              <div class="meta-item">
                <span class="meta-label">License</span>
                <span class="meta-value">{packageDetails.nix.license}</span>
              </div>
            {/if}

            {#if selectedPackage.categories?.length}
              <div class="meta-item">
                <span class="meta-label">Categories</span>
                <span class="meta-value">{selectedPackage.categories.join(', ')}</span>
              </div>
            {/if}

            {#if packageDetails.nix?.maintainers?.length}
              <div class="meta-item">
                <span class="meta-label">Maintainers</span>
                <div class="meta-badges">
                  {#each packageDetails.nix.maintainers as m}
                    <span class="badge">{m}</span>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <div class="install-box">
            <span class="install-label">Add to configuration:</span>
            <code class="install-code">environment.systemPackages = [ pkgs.{selectedPackage.pkgname} ];</code>
          </div>

          <div class="modal-actions">
            <button class="action-btn try" onclick={() => tryPackage(selectedPackage.pkgname)} disabled={trying}>
              {#if trying}...{:else}<Icon name="Play" size={14} />{/if} Try
            </button>
            {#if packageDetails.appstream?.homepage || packageDetails.nix?.homepage}
              <button class="action-btn primary" onclick={() => openUrl(packageDetails.appstream?.homepage || packageDetails.nix?.homepage)}>
                <Icon name="Globe" size={14} /> Homepage
              </button>
            {/if}
            <button class="action-btn" onclick={() => openUrl(`https://search.nixos.org/packages?channel=unstable&show=${selectedPackage.pkgname}&query=${selectedPackage.pkgname}`)}>
              <Icon name="Search" size={14} /> NixOS Search
            </button>
            {#if packageDetails.appstream?.bugtracker}
              <button class="action-btn" onclick={() => openUrl(packageDetails.appstream.bugtracker)}>
                <Icon name="Bug" size={14} /> Bug Tracker
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Kill confirmation dialog -->
{#if showKillConfirm}
  <div class="confirm-overlay" onclick={cancelKill}>
    <div class="confirm-dialog" onclick={(e) => e.stopPropagation()}>
      <div class="confirm-header">
        <span class="confirm-icon"><Icon name="AlertTriangle" size={24} /></span>
        <h3>Application Running</h3>
      </div>
      <p class="confirm-message">
        Another application is currently running. Starting a new one will terminate it.
      </p>
      <div class="confirm-actions">
        <button class="confirm-btn cancel" onclick={cancelKill}>Cancel</button>
        <button class="confirm-btn kill" onclick={confirmKillAndTry}>Kill & Try</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .discover-page {
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

  /* Search Bar */
  .search-bar {
    display: flex;
    align-items: center;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 12px;
    padding: 0 16px;
    margin-bottom: 12px;
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
  }

  .nixpkgs-search-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    margin-left: 8px;
    background: rgba(180, 190, 254, 0.15);
    border: 1px solid rgba(180, 190, 254, 0.3);
    border-radius: 8px;
    color: #b4befe;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .nixpkgs-search-btn:hover:not(:disabled) {
    background: rgba(180, 190, 254, 0.25);
    border-color: rgba(180, 190, 254, 0.5);
  }

  .nixpkgs-search-btn:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  /* Tabs */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 16px;
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
    white-space: nowrap;
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

  .cat-icon {
    font-size: 12px;
  }

  .count {
    background: rgba(0, 0, 0, 0.2);
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
  }

  .tab.active .count {
    background: rgba(137, 180, 250, 0.2);
  }

  .tab.nixpkgs-tab {
    border-color: rgba(180, 190, 254, 0.3);
    color: #b4befe;
  }

  .tab.nixpkgs-tab:hover {
    border-color: rgba(180, 190, 254, 0.5);
  }

  .tab.nixpkgs-tab.active {
    background: linear-gradient(135deg, rgba(180, 190, 254, 0.2) 0%, rgba(203, 166, 247, 0.2) 100%);
    border-color: rgba(180, 190, 254, 0.5);
  }

  .tab.nixpkgs-tab .count {
    background: rgba(180, 190, 254, 0.2);
  }

  /* Content Area */
  .content-area {
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
  }

  /* Card Grid */
  .card-grid {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    padding: 6px 8px 6px 0;
    align-content: start;
  }

  .card-grid::-webkit-scrollbar {
    width: 8px;
  }

  .card-grid::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }

  .card-grid::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 12px;
    background: rgba(49, 50, 68, 0.3);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
    color: inherit;
  }

  .card:hover {
    background: rgba(49, 50, 68, 0.5);
    border-color: rgba(137, 180, 250, 0.3);
    transform: translateY(-2px);
  }

  .card-icon {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(30, 30, 46, 0.8);
    border-radius: 12px;
    margin-bottom: 10px;
    overflow: hidden;
  }

  .card-icon img {
    width: 40px;
    height: 40px;
    object-fit: contain;
  }

  .placeholder-icon {
    font-size: 24px;
    opacity: 0.5;
  }

  .card-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .card-name {
    font-size: 13px;
    font-weight: 500;
    color: #cdd6f4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-summary {
    font-size: 11px;
    color: #6c7086;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
    min-height: 30px;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 24px;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    background: #1e1e2e;
    border: 1px solid rgba(69, 71, 90, 0.6);
    border-radius: 16px;
    max-width: 500px;
    width: 100%;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .modal-close {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(49, 50, 68, 0.8);
    border: none;
    color: #a6adc8;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
  }

  .modal-close:hover {
    background: rgba(69, 71, 90, 0.9);
    color: #cdd6f4;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    background: rgba(24, 24, 37, 0.8);
    border-bottom: 1px solid rgba(49, 50, 68, 0.5);
  }

  .modal-icon {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(49, 50, 68, 0.6);
    border-radius: 14px;
    flex-shrink: 0;
  }

  .modal-icon img {
    width: 48px;
    height: 48px;
    object-fit: contain;
  }

  .placeholder-icon-lg {
    font-size: 32px;
    opacity: 0.5;
  }

  .modal-title h2 {
    font-size: 20px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0 0 4px 0;
  }

  .modal-pkgname {
    font-size: 12px;
    color: #6c7086;
    font-family: monospace;
  }

  .modal-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px;
    color: #6c7086;
  }

  .spinner-sm {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
  }

  .version-badge {
    display: inline-block;
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-family: monospace;
    margin-bottom: 12px;
  }

  .modal-description {
    font-size: 14px;
    color: #a6adc8;
    line-height: 1.6;
    margin: 0 0 16px 0;
  }

  .modal-meta {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 16px;
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .meta-label {
    font-size: 11px;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .meta-value {
    font-size: 13px;
    color: #cdd6f4;
  }

  .meta-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .badge {
    background: rgba(180, 190, 254, 0.15);
    color: #b4befe;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .install-box {
    background: rgba(49, 50, 68, 0.4);
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 16px;
  }

  .install-label {
    display: block;
    font-size: 11px;
    color: #6c7086;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .install-code {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #a6e3a1;
    background: rgba(30, 30, 46, 0.8);
    padding: 10px 12px;
    border-radius: 6px;
    overflow-x: auto;
  }

  .modal-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 8px;
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
    background: rgba(137, 180, 250, 0.2);
    border-color: rgba(137, 180, 250, 0.4);
    color: #89b4fa;
  }

  .action-btn.primary:hover {
    background: rgba(137, 180, 250, 0.3);
  }

  .action-btn.try {
    background: rgba(166, 227, 161, 0.2);
    border-color: rgba(166, 227, 161, 0.4);
    color: #a6e3a1;
  }

  .action-btn.try:hover {
    background: rgba(166, 227, 161, 0.3);
  }

  .action-btn.try:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* States */
  .loading-state,
  .error-state {
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

  .error-icon {
    margin-bottom: 12px;
    display: flex;
  }

  .error-state button {
    margin-top: 16px;
    background: rgba(243, 139, 168, 0.2);
    border: 1px solid rgba(243, 139, 168, 0.3);
    color: #f38ba8;
    padding: 8px 20px;
    border-radius: 8px;
    cursor: pointer;
  }

  .empty {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6c7086;
    font-style: italic;
    padding: 40px;
  }

  .browse-hint {
    margin-top: 16px;
    text-align: center;
    color: #6c7086;
    font-size: 13px;
  }

  /* Nixpkgs search */
  .nixpkgs-card {
    border-color: rgba(180, 190, 254, 0.3);
  }

  .nixpkgs-badge {
    display: inline-block;
    background: rgba(180, 190, 254, 0.2);
    color: #b4befe;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    margin-left: 6px;
    vertical-align: middle;
  }

  .empty-with-action {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #6c7086;
    padding: 40px;
    gap: 16px;
  }

  .empty-with-action p {
    font-style: italic;
  }

  .search-nixpkgs-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    background: rgba(137, 180, 250, 0.15);
    border: 1px solid rgba(137, 180, 250, 0.3);
    border-radius: 10px;
    color: #89b4fa;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .search-nixpkgs-btn:hover:not(:disabled) {
    background: rgba(137, 180, 250, 0.25);
    border-color: rgba(137, 180, 250, 0.5);
  }

  .search-nixpkgs-btn:disabled {
    opacity: 0.7;
    cursor: wait;
  }

  .search-nixpkgs-btn.secondary {
    padding: 8px 16px;
    font-size: 13px;
    background: rgba(49, 50, 68, 0.5);
    border-color: rgba(69, 71, 90, 0.5);
    color: #a6adc8;
  }

  .search-nixpkgs-btn.secondary:hover:not(:disabled) {
    background: rgba(137, 180, 250, 0.15);
    border-color: rgba(137, 180, 250, 0.3);
    color: #89b4fa;
  }

  .spinner-sm {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .search-more {
    display: flex;
    justify-content: center;
    padding: 16px 0;
  }

  .nixpkgs-header {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid rgba(69, 71, 90, 0.3);
  }

  .nixpkgs-header h2 {
    color: #b4befe;
  }

  /* Kill Confirmation Dialog */
  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    animation: fadeIn 0.15s ease-out;
  }

  .confirm-dialog {
    background: #1e1e2e;
    border: 1px solid rgba(69, 71, 90, 0.6);
    border-radius: 12px;
    padding: 20px;
    max-width: 360px;
    width: 90%;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .confirm-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }

  .confirm-icon {
    font-size: 24px;
  }

  .confirm-header h3 {
    font-size: 16px;
    font-weight: 600;
    color: #f9e2af;
    margin: 0;
  }

  .confirm-message {
    font-size: 14px;
    color: #a6adc8;
    margin: 0 0 20px 0;
    line-height: 1.5;
  }

  .confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .confirm-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .confirm-btn.cancel {
    background: rgba(49, 50, 68, 0.5);
    border: 1px solid rgba(69, 71, 90, 0.5);
    color: #a6adc8;
  }

  .confirm-btn.cancel:hover {
    background: rgba(69, 71, 90, 0.5);
    color: #cdd6f4;
  }

  .confirm-btn.kill {
    background: rgba(243, 139, 168, 0.2);
    border: 1px solid rgba(243, 139, 168, 0.4);
    color: #f38ba8;
  }

  .confirm-btn.kill:hover {
    background: rgba(243, 139, 168, 0.3);
  }
</style>
