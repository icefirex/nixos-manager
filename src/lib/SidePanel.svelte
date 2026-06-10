<script>
  import Icon from "./Icon.svelte";

  let specializations = $state([]);
  let flakeInputs = $state([]);
  let showConfirmDialog = $state(false);
  let pendingSwitch = $state(null);
  let isSwitching = $state(false);
  let switchError = $state(null);
  let selectedInput = $state(null);
  let isUpdatingInput = $state(false);

  // Load real data on mount
  $effect(() => {
    loadSpecializations();
    loadFlakeInputs();
    // Re-render inputs when the background update check finishes
    const cleanup = window.electronAPI.onFlakeUpdateCheckComplete(() => {
      loadFlakeInputs();
    });
    return cleanup;
  });

  async function loadSpecializations() {
    try {
      specializations = await window.electronAPI.getSpecializations();
    } catch (e) {
      console.error("Failed to load specializations:", e);
    }
  }

  async function loadFlakeInputs() {
    try {
      flakeInputs = await window.electronAPI.getFlakeInputs();
    } catch (e) {
      console.error("Failed to load flake inputs:", e);
    }
  }

  function requestSwitch(name) {
    // Don't switch if already active
    const current = specializations.find(s => s.active);
    if (current?.name === name) return;

    pendingSwitch = name;
    switchError = null;
    showConfirmDialog = true;
  }

  async function confirmSwitch() {
    if (!pendingSwitch) return;

    showConfirmDialog = false;
    isSwitching = true;
    switchError = null;

    try {
      await window.electronAPI.switchSpecialization(pendingSwitch);
      specializations = specializations.map((s) => ({
        ...s,
        active: s.name === pendingSwitch,
      }));
    } catch (e) {
      console.error("Failed to switch:", e);
      switchError = e.message || "Failed to switch specialization";
    } finally {
      isSwitching = false;
      pendingSwitch = null;
    }
  }

  function cancelSwitch() {
    showConfirmDialog = false;
    pendingSwitch = null;
  }

  function selectInput(name) {
    if (isUpdatingInput) return;
    selectedInput = selectedInput === name ? null : name;
  }

  async function updateSingleInput(name) {
    if (isUpdatingInput) return;

    isUpdatingInput = true;
    selectedInput = name;

    // Dispatch event so Dashboard can show terminal
    window.dispatchEvent(new CustomEvent('flake-update-start', {
      detail: { inputName: name }
    }));

    try {
      await window.electronAPI.updateFlakeInput(name);
      // Reload inputs after update
      await loadFlakeInputs();

      window.dispatchEvent(new CustomEvent('flake-update-complete', {
        detail: { inputName: name, success: true }
      }));
    } catch (e) {
      console.error("Failed to update:", e);
      window.dispatchEvent(new CustomEvent('flake-update-complete', {
        detail: { inputName: name, success: false, error: e.message }
      }));
    } finally {
      isUpdatingInput = false;
      selectedInput = null;
    }
  }

  async function updateAllInputs() {
    if (isUpdatingInput) return;

    isUpdatingInput = true;

    // Dispatch event so Dashboard can show terminal
    window.dispatchEvent(new CustomEvent('flake-update-start', {
      detail: { inputName: 'all' }
    }));

    try {
      await window.electronAPI.updateFlakeInputs();
      // Reload inputs after update
      await loadFlakeInputs();

      window.dispatchEvent(new CustomEvent('flake-update-complete', {
        detail: { inputName: 'all', success: true }
      }));
    } catch (e) {
      console.error("Failed to update:", e);
      window.dispatchEvent(new CustomEvent('flake-update-complete', {
        detail: { inputName: 'all', success: false, error: e.message }
      }));
    } finally {
      isUpdatingInput = false;
    }
  }

  function getCurrentSpecName() {
    return specializations.find(s => s.active)?.name || 'unknown';
  }
</script>

<div class="side-panel">
  <div class="panel-card">
    <div class="panel-header">
      <span class="panel-title">Specializations</span>
      <span class="panel-badge badge-active"
        >{specializations.length} available</span
      >
    </div>
    <div class="spec-list">
      {#each specializations as spec}
        <button
          class="spec-item"
          class:active={spec.active}
          onclick={() => requestSwitch(spec.name)}
        >
          <span class="spec-dot"></span>
          <span class="spec-name">{spec.name}</span>
          {#if spec.active}
            <span class="spec-tag">active</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="panel-card">
    <div class="panel-header">
      <span class="panel-title">Flake Inputs</span>
    </div>
    <div class="input-list">
      {#each flakeInputs as input}
        <button
          class="input-item"
          class:selected={selectedInput === input.name}
          class:updating={isUpdatingInput && selectedInput === input.name}
          onclick={() => selectInput(input.name)}
          disabled={isUpdatingInput}
        >
          <span class="input-left">
            <span class="input-name">{input.name}</span>
            {#if input.hasUpdate}
              <span class="update-pill">↑ update</span>
            {/if}
          </span>
          <span class="input-status {input.status}"><Icon name="Circle" size={8} /> {input.age}</span>
          {#if selectedInput === input.name && !isUpdatingInput}
            <button
              class="input-update-btn"
              onclick={(e) => { e.stopPropagation(); updateSingleInput(input.name); }}
              title="Update {input.name}"
            >
              <Icon name="RefreshCw" size={12} />
            </button>
          {/if}
          {#if isUpdatingInput && selectedInput === input.name}
            <span class="input-spinner"></span>
          {/if}
        </button>
      {/each}
    </div>
    <button class="update-btn" onclick={updateAllInputs} disabled={isUpdatingInput}>
      {#if isUpdatingInput && !selectedInput}
        <span class="btn-spinner"></span>
        Updating...
      {:else}
        Update All
      {/if}
    </button>
  </div>
</div>

{#if showConfirmDialog}
  <div class="modal-overlay" onclick={cancelSwitch}>
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">Switch Specialization</div>
      <div class="modal-body">
        <p>Switch from <strong>{getCurrentSpecName()}</strong> to <strong>{pendingSwitch}</strong>?</p>
        <p class="modal-note">This will require administrator privileges.</p>
      </div>
      <div class="modal-actions">
        <button class="modal-btn cancel" onclick={cancelSwitch}>Cancel</button>
        <button class="modal-btn confirm" onclick={confirmSwitch}>Switch</button>
      </div>
    </div>
  </div>
{/if}

{#if isSwitching}
  <div class="loading-overlay">
    <div class="loading-content">
      <div class="spinner"></div>
      <p>Switching to {pendingSwitch || 'specialization'}...</p>
    </div>
  </div>
{/if}

{#if switchError}
  <div class="error-toast">
    <span class="error-icon">!</span>
    <span class="error-message">{switchError}</span>
    <button class="error-dismiss" onclick={() => switchError = null}>×</button>
  </div>
{/if}

<style>
  .side-panel {
    grid-row: 1 / 3;
    grid-column: 2;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .panel-card {
    background: rgba(24, 24, 37, 0.9);
    border: 1px solid rgba(49, 50, 68, 0.5);
    border-radius: 16px;
    padding: 20px;
    transition: all 0.3s;
  }

  .panel-card:hover {
    border-color: rgba(69, 71, 90, 0.8);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .panel-title {
    font-size: 13px;
    font-weight: 600;
    color: #cdd6f4;
  }

  .panel-badge {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 6px;
    font-weight: 500;
  }

  .badge-active {
    background: rgba(166, 227, 161, 0.15);
    color: #a6e3a1;
    border: 1px solid rgba(166, 227, 161, 0.25);
  }

  .spec-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .spec-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(30, 30, 46, 0.8);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border: 1px solid transparent;
    color: inherit;
    width: 100%;
    text-align: left;
  }

  .spec-item:hover {
    background: rgba(49, 50, 68, 0.6);
    transform: translateX(4px);
  }

  .spec-item.active {
    border-color: rgba(137, 180, 250, 0.5);
    background: rgba(137, 180, 250, 0.1);
    box-shadow: 0 0 16px rgba(137, 180, 250, 0.1);
  }

  .spec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #45475a;
    transition: all 0.3s;
  }

  .spec-item.active .spec-dot {
    background: #a6e3a1;
    box-shadow: 0 0 10px rgba(166, 227, 161, 0.6);
  }

  .spec-name {
    font-size: 13px;
    color: #cdd6f4;
  }

  .spec-tag {
    margin-left: auto;
    font-size: 9px;
    color: #a6e3a1;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .input-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .input-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: rgba(30, 30, 46, 0.8);
    border-radius: 8px;
    transition: all 0.2s;
    border: 1px solid transparent;
    cursor: pointer;
    width: 100%;
    text-align: left;
    color: inherit;
  }

  .input-item:hover:not(:disabled) {
    background: rgba(49, 50, 68, 0.5);
  }

  .input-item.selected {
    border-color: rgba(137, 180, 250, 0.5);
    background: rgba(137, 180, 250, 0.1);
  }

  .input-item.updating {
    opacity: 0.7;
  }

  .input-item:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .input-name {
    font-size: 12px;
    color: #cdd6f4;
  }

  .input-left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .update-pill {
    font-size: 9px;
    font-weight: 600;
    color: #89b4fa;
    background: rgba(137, 180, 250, 0.15);
    border: 1px solid rgba(137, 180, 250, 0.35);
    border-radius: 4px;
    padding: 1px 5px;
    white-space: nowrap;
    flex-shrink: 0;
    letter-spacing: 0.2px;
  }

  .input-status {
    font-size: 10px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .input-status.fresh {
    color: #a6e3a1;
  }

  .input-status.stale {
    color: #f9e2af;
  }

  .input-update-btn {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: none;
    background: rgba(137, 180, 250, 0.2);
    color: #89b4fa;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    margin-left: 8px;
  }

  .input-update-btn:hover {
    background: rgba(137, 180, 250, 0.4);
    transform: rotate(180deg);
  }

  .input-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-left: 8px;
  }

  .btn-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(30, 30, 46, 0.3);
    border-top-color: #1e1e2e;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 8px;
  }

  .update-btn {
    background: linear-gradient(
      135deg,
      #89b4fa 0%,
      #b4befe 100%
    );
    border: 1px solid rgba(137, 180, 250, 0.3);
    border-radius: 10px;
    padding: 12px;
    color: #1e1e2e;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    margin-top: 12px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .update-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .update-btn::before {
    content: "";
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.2) 50%,
      transparent 100%
    );
    transition: left 0.5s;
  }

  .update-btn:hover:not(:disabled)::before {
    left: 100%;
  }

  .update-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(137, 180, 250, 0.4),
      0 0 40px rgba(137, 180, 250, 0.2);
  }

  /* Modal styles */
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

  .modal-content {
    background: #1e1e2e;
    border: 1px solid rgba(137, 180, 250, 0.3);
    border-radius: 16px;
    padding: 24px;
    min-width: 320px;
    max-width: 400px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  }

  .modal-header {
    font-size: 16px;
    font-weight: 600;
    color: #cdd6f4;
    margin-bottom: 16px;
  }

  .modal-body {
    color: #a6adc8;
    font-size: 14px;
    line-height: 1.5;
  }

  .modal-body strong {
    color: #89b4fa;
  }

  .modal-note {
    margin-top: 12px;
    font-size: 12px;
    color: #6c7086;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    margin-top: 24px;
    justify-content: flex-end;
  }

  .modal-btn {
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .modal-btn.cancel {
    background: rgba(49, 50, 68, 0.8);
    color: #cdd6f4;
  }

  .modal-btn.cancel:hover {
    background: rgba(69, 71, 90, 0.8);
  }

  .modal-btn.confirm {
    background: linear-gradient(135deg, #89b4fa 0%, #b4befe 100%);
    color: #1e1e2e;
  }

  .modal-btn.confirm:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(137, 180, 250, 0.4);
  }

  /* Loading overlay */
  .loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1001;
    backdrop-filter: blur(4px);
  }

  .loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    color: #cdd6f4;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(137, 180, 250, 0.2);
    border-top-color: #89b4fa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Error toast */
  .error-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(243, 139, 168, 0.15);
    border: 1px solid rgba(243, 139, 168, 0.4);
    border-radius: 10px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 1002;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .error-icon {
    width: 24px;
    height: 24px;
    background: #f38ba8;
    color: #1e1e2e;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 14px;
  }

  .error-message {
    color: #f38ba8;
    font-size: 13px;
    max-width: 300px;
  }

  .error-dismiss {
    background: none;
    border: none;
    color: #6c7086;
    font-size: 18px;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
  }

  .error-dismiss:hover {
    color: #cdd6f4;
  }
</style>
