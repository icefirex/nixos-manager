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

  // Add to configuration
  let configFiles = $state([]);
  let configFilesLoaded = $state(false);
  let installFile = $state('');
  let installType = $state('system');
  let installUser = $state('');
  let availableUsers = $state([]);
  let adding = $state(false);
  let installSuccess = $state(false);
  let installDiff = $state('');
  let nixpkgsValid = $state(true);
  let checkingNixpkgs = $state(false);
  let currentView = $state('details');
  let configuredPackages = $state(new Set());
  let removing = $state(false);
  let packageLocations = $state([]);
  let auditLog = $state([]);
  let toasts = $state([]);
  let diffOverlay = $state(null);

  function showToast(message, type, diff) {
    const id = Date.now() + Math.random();
    toasts = [...toasts, { id, message, type, diff }];
    if (type !== 'error') {
      setTimeout(() => {
        toasts = toasts.filter(t => t.id !== id);
      }, 4000);
    }
  }

  function closeDiffOverlay() {
    diffOverlay = null;
  }

  let isConfigured = $derived(selectedPackage ? configuredPackages.has(selectedPackage.pkgname) : false);

  let filteredConfigFiles = $derived.by(() => {
    const files = configFiles.filter(f => f.sections.includes(installType));
    files.sort((a, b) => {
      const aMatch = packageLocations.some(p => p.path === a.path) ? 1 : 0;
      const bMatch = packageLocations.some(p => p.path === b.path) ? 1 : 0;
      return bMatch - aMatch;
    });
    return files;
  });

  let isValidRemoveTarget = $derived(
    packageLocations.some(p => p.path === installFile)
  );

  function formatTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  // Nixpkgs extended search
  let nixpkgsResults = $state([]);
  let searchingNixpkgs = $state(false);
  let nixpkgsSearched = $state(false);
  let showNixpkgsTab = $state(false);
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

      await loadConfiguredPackages();

      const histResult = await window.electronAPI.historyGet();
      if (histResult.success) {
        auditLog = histResult.entries;
      }

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

  async function loadConfiguredPackages() {
    try {
      const result = await window.electronAPI.discoverGetConfigured();
      if (result.success) {
        configuredPackages = new Set(result.packages);
      }
    } catch (e) {
      console.error('Failed to load configured packages:', e);
    }
  }

  async function goToInstall() {
    currentView = 'install';
    packageLocations = [];
    loadConfigFiles();
    if (isConfigured && selectedPackage) {
      try {
        const result = await window.electronAPI.discoverFindPackage(selectedPackage.pkgname);
        if (result.success) {
          packageLocations = result.files;
          if (result.files.length > 0) {
            const first = result.files[0];
            installFile = first.path;
            const secs = first.sections;
            if (secs.includes('system')) installType = 'system';
            else if (secs.includes('homeManager')) installType = 'homeManager';
            else if (secs.some(s => s.type === 'user')) {
              installType = 'user';
              installUser = secs.find(s => s.type === 'user').userName;
            }
          }
        }
      } catch (e) {
        console.error('Failed to find package:', e);
      }
    }
  }

  function goToDetails() {
    currentView = 'details';
    installDiff = '';
  }

  async function removeFromConfig() {
    if (!installFile || !installType) return;
    removing = true;
    try {
      const result = await window.electronAPI.discoverRemovePackage({
        pkgname: selectedPackage.pkgname,
        filePath: installFile
      });
      if (result.success) {
        await loadConfiguredPackages();
        const entry = { pkgname: selectedPackage.pkgname, action: 'removed', file: installFile, type: installType, userName: installType === 'user' ? installUser : undefined };
        auditLog = [{ timestamp: Date.now(), ...entry }, ...auditLog];
        window.electronAPI.historyAdd(entry);
        showToast(result.message, 'success', result.diff);
        window.dispatchEvent(new CustomEvent('history-updated'));
        window.dispatchEvent(new CustomEvent('pending-changes'));
        window.dispatchEvent(new CustomEvent('packages-changed'));
      } else {
        showToast(result.error || 'Failed to remove package', 'error');
      }
    } catch (e) {
      showToast(e.message || 'Failed to remove package', 'error');
    } finally {
      removing = false;
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

  // Reset nixpkgs search when query changes
  $effect(() => {
    const q = searchQuery; // Track changes
    nixpkgsResults = [];
    nixpkgsSearched = false;
    showNixpkgsTab = false;
  });

  async function searchNixpkgs() {
    const q = searchQuery.trim();
    if (!q) return;

    searchingNixpkgs = true;
    try {
      nixpkgsResults = await window.electronAPI.discoverSearchNixpkgs(q);
      nixpkgsSearched = true;
      showNixpkgsTab = true;
    } catch (e) {
      console.error('Nixpkgs search failed:', e);
      nixpkgsResults = [];
    } finally {
      searchingNixpkgs = false;
    }
  }

  async function openModal(pkg) {
    selectedPackage = pkg;
    currentView = 'details';
    loadingDetails = true;
    packageDetails = null;
    installDiff = '';
    installFile = '';
    installType = 'system';
    nixpkgsValid = true;

    try {
      packageDetails = await window.electronAPI.discoverGetDetails(pkg.pkgname);
    } catch (e) {
      console.error('Failed to load details:', e);
    } finally {
      loadingDetails = false;
    }

    loadConfigFiles();
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

  // Add to configuration
  async function loadConfigFiles() {
    if (configFilesLoaded) return;
    try {
      const result = await window.electronAPI.discoverGetConfigFiles();
      if (result.success) {
        configFiles = result.files;
        const allUsers = [...new Set(result.files.flatMap(f => f.users))];
        availableUsers = allUsers;
        installUser = availableUsers[0] || '';
        autoSelectFile();
        configFilesLoaded = true;
      }
    } catch (e) {
      console.error('Failed to load config files:', e);
    }
  }

  function autoSelectFile() {
    const f = filteredConfigFiles[0];
    installFile = f ? f.path : '';
  }

  async function selectType(type) {
    installType = type;
    autoSelectFile();

    if (type === 'homeManager') {
      checkingNixpkgs = true;
      nixpkgsValid = false;
      try {
        const result = await window.electronAPI.discoverCheckNixpkgsPackage(selectedPackage.pkgname);
        nixpkgsValid = result.exists;
      } catch {
        nixpkgsValid = false;
      } finally {
        checkingNixpkgs = false;
      }
    } else {
      nixpkgsValid = true;
    }
  }

  async function addToConfig() {
    if (!installFile || !installType) return;
    adding = true;
    try {
      const result = await window.electronAPI.discoverAddPackage({
        pkgname: selectedPackage.pkgname,
        filePath: installFile,
        packageType: installType,
        userName: installType === 'user' ? installUser : undefined
      });
      if (result.success) {
        await loadConfiguredPackages();
        const entry = { pkgname: selectedPackage.pkgname, action: 'added', file: installFile, type: installType, userName: installType === 'user' ? installUser : undefined };
        auditLog = [{ timestamp: Date.now(), ...entry }, ...auditLog];
        window.electronAPI.historyAdd(entry);
        showToast(result.message, 'success', result.diff);
        window.dispatchEvent(new CustomEvent('history-updated'));
        window.dispatchEvent(new CustomEvent('pending-changes'));
        window.dispatchEvent(new CustomEvent('packages-changed'));
      } else {
        showToast(result.error || 'Failed to add package', 'error');
      }
    } catch (e) {
      showToast(e.message || 'Failed to add package', 'error');
    } finally {
      adding = false;
    }
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
        <p class="subtitle">Browse {stats.totalApps.toLocaleString()} categorized apps — or search all of nixpkgs (140k+)</p>
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
      placeholder="Search apps or all of nixpkgs (140k+)..."
      bind:value={searchQuery}
    />
    {#if searchQuery}
      <button class="clear-btn" onclick={() => searchQuery = ''}>×</button>
    {/if}
    <button class="nixpkgs-search-btn" onclick={searchNixpkgs} disabled={!searchQuery.trim() || searchingNixpkgs || nixpkgsSearched}>
      {#if searchingNixpkgs}
        <span class="spinner-sm"></span>
      {:else}
        <Icon name="Search" size={12} />
      {/if}
      Search Nix Packages
    </button>
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
            <button class="card nixpkgs-card" class:configured={configuredPackages.has(pkg.pkgname)} onclick={() => openModal(pkg)}>
              <div class="card-icon">
                <span class="placeholder-icon"><Icon name="Package" size={24} /></span>
              </div>
              <div class="card-content">
                <span class="card-name">
                  {pkg.name}
                  {#if configuredPackages.has(pkg.pkgname)}
                    <span class="installed-badge">Installed</span>
                  {/if}
                  <span class="nixpkgs-badge">nixpkgs</span>
                </span>
                <span class="card-summary">{pkg.summary || ''}</span>
              </div>
            </button>
          {/each}
        {:else}
          <!-- Normal view - AppStream packages -->
          {#each (searchQuery || selectedCategory ? filteredPackages : featuredPackages) as pkg}
            <button class="card" class:configured={configuredPackages.has(pkg.pkgname)} onclick={() => openModal(pkg)}>
              <div class="card-icon">
                {#if getIconUrl(pkg)}
                  <img src={getIconUrl(pkg)} alt="" />
                {:else}
                  <span class="placeholder-icon"><Icon name="Package" size={24} /></span>
                {/if}
              </div>
              <div class="card-content">
                <span class="card-name">
                  {pkg.name}
                  {#if configuredPackages.has(pkg.pkgname)}
                    <span class="installed-badge">Installed</span>
                  {/if}
                </span>
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
        <div class="modal-page-container">
          {#if currentView === 'details'}
            <div class="modal-page">
              {#if isConfigured}
                <span class="configured-badge">Configured</span>
              {/if}

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

              <button class="config-nav-btn" class:configured={isConfigured} onclick={goToInstall}>
                <span class="config-btn-icon">
                  {#if isConfigured}
                    <Icon name="Settings" size={14} />
                  {:else}
                    <Icon name="Plus" size={14} />
                  {/if}
                </span>
                {isConfigured ? 'Manage Configuration' : 'Add to Configuration'}
              </button>

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
          {:else}
            <div class="modal-page">
              <button class="back-btn" onclick={goToDetails}>← Back</button>

              <div class="install-section">
                <div class="file-list">
                  <div class="section-label">Config File</div>
                  {#each filteredConfigFiles as file}
                    <button class="file-item" class:selected={installFile === file.path}
                      onclick={() => { installFile = file.path; }}>
                      <div class="file-info">
                        <span class="file-path">{file.relativePath}</span>
                        <div class="file-section-badges">
                          {#each file.sections as t}
                            <span class="file-section-badge">{t}</span>
                          {/each}
                        </div>
                      </div>
                      {#if packageLocations.some(p => p.relativePath === file.relativePath)}
                        <span class="file-configured-badge">Contains</span>
                      {/if}
                    </button>
                  {/each}
                  {#if filteredConfigFiles.length === 0}
                    <p class="file-list-empty">No files with this section type</p>
                  {/if}
                </div>

                <div class="type-selector">
                  <button class="type-btn" class:active={installType === 'system'} onclick={() => selectType('system')}>
                    System
                  </button>
                  <button class="type-btn" class:active={installType === 'user'} onclick={() => selectType('user')}
                    disabled={availableUsers.length === 0}>
                    User
                  </button>
                  <button class="type-btn" class:active={installType === 'homeManager'} onclick={() => selectType('homeManager')}>
                    Home Manager
                    {#if checkingNixpkgs}
                      <span class="type-spinner"></span>
                    {:else if !nixpkgsValid}
                      <span class="type-warn" title="No match in nixpkgs">!</span>
                    {:else}
                      <span class="type-ok" title="Available in nixpkgs">✓</span>
                    {/if}
                  </button>
                </div>

                {#if installType === 'user' && availableUsers.length > 0}
                  <div class="install-field">
                    <select bind:value={installUser} class="install-select">
                      {#each availableUsers as user}
                        <option value={user}>{user}</option>
                      {/each}
                    </select>
                  </div>
                {/if}

                {#if installType === 'homeManager' && !nixpkgsValid && !checkingNixpkgs}
                  <p class="install-warning">Not available in nixpkgs — may not work with home-manager</p>
                {/if}

                <code class="install-code">
                  {installType === 'system' ? 'environment.systemPackages' : ''}
                  {installType === 'homeManager' ? 'home.packages' : ''}
                  {installType === 'user' ? `users.users.${installUser || '<user>'}.packages` : ''}
                  = [ pkgs.{selectedPackage.pkgname} ];
                </code>

                <button class="install-action-btn" class:add={!isConfigured} class:remove={isConfigured}
                  onclick={isConfigured ? removeFromConfig : addToConfig}
                  disabled={adding || removing || !installFile || !installType || (installType === 'homeManager' && !nixpkgsValid) || (isConfigured && !isValidRemoveTarget)}>
                  {#if adding}
                    <span class="spinner-sm"></span> Adding...
                  {:else if removing}
                    <span class="spinner-sm"></span> Removing...
                  {:else if isConfigured}
                    Remove from Configuration
                  {:else}
                    Add to Configuration
                  {/if}
                </button>


              </div>

            </div>
          {/if}
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

<div class="toast-container">
  {#each toasts as t (t.id)}
    <div class="toast" class:toast-success={t.type === 'success'} class:toast-error={t.type === 'error'}>
      <span class="toast-msg">{t.message}</span>
      <div class="toast-actions">
        {#if t.diff}
          <button class="toast-action" onclick={() => diffOverlay = t.diff}>Changes</button>
        {/if}
        {#if t.type === 'error'}
          <button class="toast-action" onclick={() => toasts = toasts.filter(x => x.id !== t.id)}>Dismiss</button>
        {/if}
      </div>
    </div>
  {/each}
</div>

{#if diffOverlay}
  <div class="diff-overlay" onclick={closeDiffOverlay}>
    <div class="diff-overlay-content" onclick={(e) => e.stopPropagation()}>
      <button class="diff-overlay-close" onclick={closeDiffOverlay}>✕</button>
      <pre>{diffOverlay}</pre>
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
    opacity: 0.4;
    cursor: not-allowed;
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

  .card.configured {
    border-color: rgba(166, 227, 161, 0.25);
  }

  .card.configured:hover {
    border-color: rgba(166, 227, 161, 0.4);
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
    position: relative;
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

  .install-code {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #a6e3a1;
    background: rgba(30, 30, 46, 0.8);
    padding: 10px 12px;
    border-radius: 6px;
    overflow-x: auto;
    margin-bottom: 10px;
  }

  .install-field {
    margin-bottom: 10px;
  }

  .install-select {
    width: 100%;
    background: rgba(30, 30, 46, 0.8);
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 6px;
    color: #cdd6f4;
    font-size: 13px;
    padding: 8px 10px;
    outline: none;
    cursor: pointer;
    font-family: inherit;
  }

  .install-select:focus {
    border-color: rgba(137, 180, 250, 0.5);
  }

  .type-selector {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
  }

  .type-btn {
    flex: 1;
    padding: 7px 10px;
    background: rgba(49, 50, 68, 0.4);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 6px;
    color: #a6adc8;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }

  .type-btn:hover:not(:disabled) {
    background: rgba(49, 50, 68, 0.6);
    color: #cdd6f4;
  }

  .type-btn.active {
    background: linear-gradient(135deg, rgba(137, 180, 250, 0.2) 0%, rgba(180, 190, 254, 0.2) 100%);
    border-color: rgba(137, 180, 250, 0.4);
    color: #89b4fa;
  }

  .type-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .type-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    display: inline-block;
  }

  .type-warn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(249, 226, 175, 0.2);
    color: #f9e2af;
    font-size: 10px;
    font-weight: 700;
  }

  .type-ok {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
    font-size: 10px;
    font-weight: 700;
  }

  .install-warning {
    font-size: 11px;
    color: #f9e2af;
    margin: 0 0 10px 0;
    padding: 6px 10px;
    background: rgba(249, 226, 175, 0.1);
    border-radius: 6px;
    border: 1px solid rgba(249, 226, 175, 0.2);
  }

  .install-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 9px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .install-action-btn.add {
    background: rgba(166, 227, 161, 0.2);
    border: 1px solid rgba(166, 227, 161, 0.4);
    color: #a6e3a1;
  }

  .install-action-btn.add:hover:not(:disabled) {
    background: rgba(166, 227, 161, 0.3);
  }

  .install-action-btn.remove {
    background: rgba(243, 139, 168, 0.2);
    border: 1px solid rgba(243, 139, 168, 0.4);
    color: #f38ba8;
  }

  .install-action-btn.remove:hover:not(:disabled) {
    background: rgba(243, 139, 168, 0.3);
  }

  .install-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .install-result {
    font-size: 12px;
    margin: 8px 0 0 0;
    padding: 6px 10px;
    border-radius: 6px;
  }

  .install-result.success {
    color: #a6e3a1;
    background: rgba(166, 227, 161, 0.1);
    border: 1px solid rgba(166, 227, 161, 0.2);
  }

  .toast-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 3000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(30, 30, 46, 0.97);
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 10px;
    font-size: 13px;
    color: #cdd6f4;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    animation: toastSlideIn 0.25s ease-out;
    max-width: 440px;
    backdrop-filter: blur(8px);
  }

  .toast-success {
    border-color: rgba(166, 227, 161, 0.3);
  }

  .toast-error {
    border-color: rgba(243, 139, 168, 0.3);
  }

  @keyframes toastSlideIn {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .toast-msg {
    flex: 1;
    line-height: 1.4;
  }

  .toast-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .toast-action {
    padding: 3px 8px;
    background: rgba(49, 50, 68, 0.6);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 5px;
    color: #a6adc8;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
  }

  .toast-action:hover {
    background: rgba(49, 50, 68, 0.8);
    color: #cdd6f4;
  }

  .diff-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 4000;
    animation: fadeIn 0.15s ease-out;
  }

  .diff-overlay-content {
    position: relative;
    background: #1e1e2e;
    border: 1px solid rgba(69, 71, 90, 0.6);
    border-radius: 12px;
    padding: 20px;
    max-width: 600px;
    width: 90%;
    max-height: 70vh;
    overflow: auto;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }

  .diff-overlay-content::-webkit-scrollbar {
    width: 8px;
  }
  .diff-overlay-content::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }
  .diff-overlay-content::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }

  .diff-overlay-close {
    position: sticky;
    top: 0;
    float: right;
    background: rgba(49, 50, 68, 0.8);
    border: none;
    color: #a6adc8;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
    margin: -8px -8px 8px 8px;
  }

  .diff-overlay-close:hover {
    background: rgba(69, 71, 90, 0.8);
    color: #cdd6f4;
  }

  .diff-overlay-content pre {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 1.5;
    color: #a6adc8;
    white-space: pre;
    overflow-x: auto;
    clear: right;
  }

  .file-list {
    margin-bottom: 10px;
    max-height: 140px;
    overflow-y: auto;
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 6px;
    background: rgba(30, 30, 46, 0.4);
  }

  .file-list .section-label {
    padding: 6px 10px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6c7086;
    border-bottom: 1px solid rgba(69, 71, 90, 0.2);
  }

  .file-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 7px 10px;
    background: transparent;
    border: none;
    border-bottom: 1px solid rgba(69, 71, 90, 0.15);
    color: #cdd6f4;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background 0.1s;
  }

  .file-item:last-child {
    border-bottom: none;
  }

  .file-item:hover {
    background: rgba(49, 50, 68, 0.5);
  }

  .file-item.selected {
    background: rgba(137, 180, 250, 0.12);
    border-left: 2px solid #89b4fa;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .file-path {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #cdd6f4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-section-badges {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
  }

  .file-section-badge {
    display: inline-block;
    padding: 1px 5px;
    font-size: 9px;
    background: rgba(69, 71, 90, 0.3);
    border-radius: 3px;
    color: #a6adc8;
    text-transform: uppercase;
  }

  .file-configured-badge {
    flex-shrink: 0;
    padding: 2px 6px;
    font-size: 9px;
    background: rgba(166, 227, 161, 0.15);
    border: 1px solid rgba(166, 227, 161, 0.3);
    border-radius: 4px;
    color: #a6e3a1;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .file-list-empty {
    padding: 12px;
    text-align: center;
    color: #6c7086;
    font-size: 12px;
  }



  .install-result:not(.success) {
    color: #f38ba8;
    background: rgba(243, 139, 168, 0.1);
    border: 1px solid rgba(243, 139, 168, 0.2);
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

  .modal-page-container {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .modal-page-container::-webkit-scrollbar {
    width: 8px;
  }
  .modal-page-container::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.3);
    border-radius: 4px;
  }
  .modal-page-container::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.8);
    border-radius: 4px;
  }
  .modal-page-container::-webkit-scrollbar-thumb:hover {
    background: rgba(88, 91, 112, 0.8);
  }

  .file-list::-webkit-scrollbar {
    width: 6px;
  }
  .file-list::-webkit-scrollbar-track {
    background: rgba(49, 50, 68, 0.2);
    border-radius: 3px;
  }
  .file-list::-webkit-scrollbar-thumb {
    background: rgba(69, 71, 90, 0.7);
    border-radius: 3px;
  }

  .modal-page {
    padding: 20px;
  }

  .configured-badge {
    display: inline-block;
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: 12px;
  }

  .config-nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    background: rgba(137, 180, 250, 0.15);
    border: 1px solid rgba(137, 180, 250, 0.3);
    border-radius: 10px;
    color: #89b4fa;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    margin-bottom: 16px;
  }

  .config-nav-btn:hover {
    background: rgba(137, 180, 250, 0.25);
    border-color: rgba(137, 180, 250, 0.5);
  }

  .config-nav-btn.configured {
    background: rgba(166, 227, 161, 0.15);
    border-color: rgba(166, 227, 161, 0.3);
    color: #a6e3a1;
  }

  .config-nav-btn.configured:hover {
    background: rgba(166, 227, 161, 0.25);
    border-color: rgba(166, 227, 161, 0.5);
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    margin-bottom: 14px;
    background: rgba(49, 50, 68, 0.4);
    border: 1px solid rgba(69, 71, 90, 0.3);
    border-radius: 6px;
    color: #a6adc8;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .back-btn:hover {
    background: rgba(49, 50, 68, 0.6);
    color: #cdd6f4;
  }

  .install-section {
    display: flex;
    flex-direction: column;
    gap: 0;
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

  .installed-badge {
    display: inline-block;
    background: rgba(166, 227, 161, 0.2);
    color: #a6e3a1;
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
